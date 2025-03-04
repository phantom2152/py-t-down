# routes.py - API endpoints
import os
import tempfile
import threading
import time
from urllib.parse import unquote
from flask import jsonify, render_template, request, send_file, abort

import config
import torrent_manager
from utils import create_zip_file, encode_path_for_url, decode_path_from_url, cleanup_dir

def init_routes(app, socketio):
    """Initialize all route handlers"""
    
    @app.route('/')
    def index():
        """Render the main page"""
        return render_template('index.html')

    @app.route('/api/add_torrent', methods=['POST'])
    def add_torrent():
        """API endpoint to add a new torrent"""
        try:
            # Generate a unique ID for this torrent
            torrent_id = f"torrent_{int(time.time())}"
            
            if 'magnet' in request.form and request.form['magnet']:
                # Handle magnet link
                magnet_link = request.form['magnet']
                threading.Thread(target=torrent_manager.download_torrent, args=(torrent_id, magnet_link)).start()
                return jsonify({'status': 'success', 'torrent_id': torrent_id})
            
            elif 'torrent_file' in request.files:
                # Handle torrent file upload
                torrent_file = request.files['torrent_file']
                if torrent_file.filename == '':
                    return jsonify({'status': 'error', 'message': 'No file selected'})
                
                if torrent_file:
                    temp_path = os.path.join(tempfile.gettempdir(), f"{torrent_id}.torrent")
                    torrent_file.save(temp_path)
                    threading.Thread(target=torrent_manager.download_torrent, args=(torrent_id, None, temp_path)).start()
                    return jsonify({'status': 'success', 'torrent_id': torrent_id})
            
            return jsonify({'status': 'error', 'message': 'No valid torrent source provided'})
        
        except Exception as e:
            return jsonify({'status': 'error', 'message': str(e)})

    @app.route('/api/torrent_status/<torrent_id>', methods=['GET'])
    def get_torrent_status(torrent_id):
        """API endpoint to get the status of a torrent"""
        if torrent_id in torrent_manager.active_torrents:
            return jsonify({'status': 'active', 'data': torrent_manager.active_torrents[torrent_id]})
        elif torrent_id in torrent_manager.completed_torrents:
            return jsonify({'status': 'completed', 'data': torrent_manager.completed_torrents[torrent_id]})
        else:
            return jsonify({'status': 'not_found'})

    @app.route('/api/select_files/<torrent_id>', methods=['POST'])
    def select_files(torrent_id):
        """API endpoint to select which files to download"""
        if torrent_id not in torrent_manager.active_torrents or torrent_manager.active_torrents[torrent_id]['status'] != 'selection':
            return jsonify({'status': 'error', 'message': 'Torrent not in selection state'})
        
        try:
            selected_files = request.json.get('selected_files', [])
            selected_files = [int(idx) for idx in selected_files]  # Ensure all are integers

            print(f"Selected files for {torrent_id}: {selected_files}")
            
            # Start the actual download with selected files
            # We need to make sure we have a session and handle
            if torrent_id in torrent_manager.active_sessions and torrent_id in torrent_manager.active_handles:
                session = torrent_manager.active_sessions[torrent_id]
                handle = torrent_manager.active_handles[torrent_id]
                
                # Start a thread to do the actual download
                threading.Thread(
                    target=torrent_manager.start_actual_download, 
                    args=(session, handle, torrent_id, selected_files)
                ).start()
                
                return jsonify({'status': 'success'})
            else:
                # Fallback to the old method if session or handle is missing
                print(f"Warning: No active session or handle found for {torrent_id}, creating new thread")
                threading.Thread(
                    target=torrent_manager.download_torrent, 
                    args=(torrent_id, None, None, selected_files)
                ).start()
                return jsonify({'status': 'success'})
        
        except Exception as e:
            print(f"Error in select_files: {str(e)}")
            return jsonify({'status': 'error', 'message': str(e)})

    @app.route('/api/cancel_torrent/<torrent_id>', methods=['POST'])
    def cancel_torrent(torrent_id):
        """API endpoint to cancel a torrent download"""
        if torrent_id in torrent_manager.active_torrents:
            # Clean up the session and handle if they exist
            if torrent_id in torrent_manager.active_sessions and torrent_id in torrent_manager.active_handles:
                try:
                    session = torrent_manager.active_sessions[torrent_id]
                    handle = torrent_manager.active_handles[torrent_id]
                    session.remove_torrent(handle, True)
                    del torrent_manager.active_sessions[torrent_id]
                    del torrent_manager.active_handles[torrent_id]
                    print(f"Cleaned up session and handle for {torrent_id}")
                except Exception as e:
                    print(f"Error cleaning up session: {e}")
            
            del torrent_manager.active_torrents[torrent_id]
            # Emit update to all clients
            socketio.emit('torrent_removed', {'torrent_id': torrent_id})
            return jsonify({'status': 'success'})
        return jsonify({'status': 'error', 'message': 'Torrent not found'})

    @app.route('/api/download_file', methods=['GET'])
    def download_file():
        """API endpoint to download a single file"""
        try:
            torrent_id = request.args.get('torrent_id')
            file_path = unquote(request.args.get('file_path'))
            
            if not torrent_id or not file_path or torrent_id not in torrent_manager.completed_torrents:
                abort(404)
            
            full_path = os.path.join(config.UPLOAD_FOLDER, file_path)
            
            if not os.path.exists(full_path) or not os.path.isfile(full_path):
                abort(404)
            
            return send_file(full_path, as_attachment=True)
        
        except Exception as e:
            return jsonify({'status': 'error', 'message': str(e)})

    @app.route('/api/download_zip', methods=['POST'])
    def download_zip():
        """API endpoint to download multiple files as a zip"""
        try:
            torrent_id = request.json.get('torrent_id')
            file_paths = request.json.get('file_paths', [])
            
            if not torrent_id or torrent_id not in torrent_manager.completed_torrents:
                return jsonify({'status': 'error', 'message': 'Invalid torrent ID'})
            
            zip_filename = f"{torrent_manager.completed_torrents[torrent_id]['name']}.zip"
            zip_path, temp_dir = create_zip_file(file_paths, config.UPLOAD_FOLDER, zip_filename)
            
            # Encode the path to be safe in URL
            encoded_path = encode_path_for_url(zip_path)
            return jsonify({
                'status': 'success',
                'download_url': f"/api/download_zip_file?path={encoded_path}"
            })
        
        except Exception as e:
            return jsonify({'status': 'error', 'message': str(e)})

    @app.route('/api/download_zip_file', methods=['GET'])
    def download_zip_file():
        """API endpoint to download the generated zip file"""
        try:
            encoded_path = request.args.get('path')
            if not encoded_path:
                abort(404)
            
            # Decode the path
            zip_path = decode_path_from_url(encoded_path)
            
            if not os.path.exists(zip_path) or not os.path.isfile(zip_path):
                abort(404)
            
            # Get the temp directory for cleanup
            temp_dir = os.path.dirname(zip_path)
            
            @app.after_request
            def cleanup(response):
                try:
                    # Clean up the temporary directory after sending the file
                    cleanup_dir(temp_dir)
                except:
                    pass
                return response
            
            return send_file(zip_path, as_attachment=True)
        
        except Exception as e:
            return jsonify({'status': 'error', 'message': str(e)})

    @app.route('/api/list_completed', methods=['GET'])
    def list_completed():
        """API endpoint to list all completed torrents"""
        return jsonify({'status': 'success', 'torrents': torrent_manager.completed_torrents})

    @app.route('/api/delete_file', methods=['POST'])
    def delete_file():
        """API endpoint to delete a single file"""
        try:
            data = request.json
            torrent_id = data.get('torrent_id')
            file_path = data.get('file_path')
            
            if not torrent_id or not file_path or torrent_id not in torrent_manager.completed_torrents:
                return jsonify({'status': 'error', 'message': 'Invalid torrent ID or file path'})
            
            full_path = os.path.join(config.UPLOAD_FOLDER, file_path)
            
            if not os.path.exists(full_path) or not os.path.isfile(full_path):
                return jsonify({'status': 'error', 'message': 'File not found'})
            
            # Delete the file
            os.remove(full_path)
            
            # Update the completed torrents data
            updated_files = []
            for file_info in torrent_manager.completed_torrents[torrent_id]['files']:
                if file_info['path'] != file_path:
                    updated_files.append(file_info)
            
            torrent_manager.completed_torrents[torrent_id]['files'] = updated_files
            
            # If no files left, remove the torrent from completed list
            if not updated_files:
                del torrent_manager.completed_torrents[torrent_id]
            
            # Emit event to update all clients
            socketio.emit('completed_torrents_update', {'torrents': torrent_manager.completed_torrents})
            
            return jsonify({'status': 'success'})
        
        except Exception as e:
            print(f"Error deleting file: {str(e)}")
            return jsonify({'status': 'error', 'message': str(e)})

    @app.route('/api/delete_folder', methods=['POST'])
    def delete_folder():
        """API endpoint to delete a folder and all its contents"""
        try:
            data = request.json
            torrent_id = data.get('torrent_id')
            folder_path = data.get('folder_path')
            
            if not torrent_id or not folder_path or torrent_id not in torrent_manager.completed_torrents:
                return jsonify({'status': 'error', 'message': 'Invalid torrent ID or folder path'})
            
            full_path = os.path.join(config.UPLOAD_FOLDER, folder_path)
            
            if not os.path.exists(full_path) or not os.path.isdir(full_path):
                return jsonify({'status': 'error', 'message': 'Folder not found'})
            
            # Delete the folder and all its contents
            cleanup_dir(full_path)
            
            # Update the completed torrents data by removing files in that folder
            updated_files = []
            for file_info in torrent_manager.completed_torrents[torrent_id]['files']:
                # Keep files that don't start with the folder path
                if not file_info['path'].startswith(folder_path + '/'):
                    updated_files.append(file_info)
            
            torrent_manager.completed_torrents[torrent_id]['files'] = updated_files
            
            # If no files left, remove the torrent from completed list
            if not updated_files:
                del torrent_manager.completed_torrents[torrent_id]
            
            # Emit event to update all clients
            socketio.emit('completed_torrents_update', {'torrents': torrent_manager.completed_torrents})
            
            return jsonify({'status': 'success'})
        
        except Exception as e:
            print(f"Error deleting folder: {str(e)}")
            return jsonify({'status': 'error', 'message': str(e)})

    @app.route('/api/delete_torrent', methods=['POST'])
    def delete_torrent():
        """API endpoint to delete an entire torrent and all its files"""
        try:
            data = request.json
            torrent_id = data.get('torrent_id')
            
            if not torrent_id or torrent_id not in torrent_manager.completed_torrents:
                return jsonify({'status': 'error', 'message': 'Invalid torrent ID'})
            
            # Get the list of file paths
            file_paths = [file_info['path'] for file_info in torrent_manager.completed_torrents[torrent_id]['files']]
            
            # Delete all files
            for file_path in file_paths:
                full_path = os.path.join(config.UPLOAD_FOLDER, file_path)
                if os.path.exists(full_path) and os.path.isfile(full_path):
                    os.remove(full_path)
            
            # Delete empty directories
            for file_path in file_paths:
                directory = os.path.dirname(file_path)
                if directory:
                    directory_full_path = os.path.join(config.UPLOAD_FOLDER, directory)
                    try:
                        # Try to delete the directory, will only succeed if empty
                        if os.path.exists(directory_full_path):
                            os.rmdir(directory_full_path)
                    except OSError:
                        # Directory not empty, that's fine
                        pass
            
            # Remove the torrent from completed list
            del torrent_manager.completed_torrents[torrent_id]
            
            # Emit event to update all clients
            socketio.emit('completed_torrents_update', {'torrents': torrent_manager.completed_torrents})
            
            return jsonify({'status': 'success'})
        
        except Exception as e:
            print(f"Error deleting torrent: {str(e)}")
            return jsonify({'status': 'error', 'message': str(e)})