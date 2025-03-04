# torrent_manager.py - Torrent handling logic
import libtorrent as lt
import os
import time
import threading
import socket
from flask_socketio import SocketIO

import config
from utils import get_readable_size, get_eta

socketio = None

# Global variables to keep track of downloads
active_torrents = {}
completed_torrents = {}
torrent_meta = {}
active_sessions = {}  # Store sessions for active torrents
active_handles = {}   # Store handles for active torrents

def init_app(app_socketio):
    """Initialize the torrent manager with the app's SocketIO instance"""
    global socketio
    socketio = app_socketio

def emit_torrent_update(torrent_id, data):
    """Emit a socket.io event with torrent status update"""
    socketio.emit('torrent_update', {'torrent_id': torrent_id, 'data': data})

def download_torrent(torrent_id, magnet_link=None, torrent_file=None, selected_files=None):
    """Function to handle the torrent download process"""
    print(f"Starting download process for {torrent_id}")
    
    # If we're selecting files for an existing torrent, use the stored session
    if selected_files is not None and torrent_id in active_sessions and torrent_id in active_handles:
        print(f"Continuing download with selected files for {torrent_id}")
        session = active_sessions[torrent_id]
        handle = active_handles[torrent_id]
        start_actual_download(session, handle, torrent_id, selected_files)
        return
    
    # Configure session with more aggressive settings for metadata retrieval
    settings = dict(config.DEFAULT_TORRENT_SETTINGS)
    settings['alert_mask'] = lt.alert.category_t.all_categories
    
    session = lt.session(settings)
    session.start_dht()
    session.start_lsd()
    session.start_upnp()
    session.start_natpmp()
    
    # Add DHT nodes directly for better connectivity
    for hostname, port in config.DHT_NODES:
        try:
            ip = socket.gethostbyname(hostname)
            print(f"Adding DHT node: {hostname} ({ip}:{port})")
            session.add_dht_node((ip, port))
        except Exception as e:
            print(f"Failed to add DHT node {hostname}: {e}")
    
    # Add the torrent
    params = None
    if magnet_link:
        params = lt.parse_magnet_uri(magnet_link)
    elif torrent_file:
        info = lt.torrent_info(torrent_file)
        params = lt.add_torrent_params()
        params.ti = info
    
    if not params:
        status_data = {'status': 'error', 'message': 'Invalid torrent source'}
        active_torrents[torrent_id] = status_data
        emit_torrent_update(torrent_id, status_data)
        return
    
    # Set the save path directly on params
    params.save_path = os.path.abspath(config.UPLOAD_FOLDER)
    
    # Add torrent to session
    handle = session.add_torrent(params)
    
    # Store the session and handle for later use
    active_sessions[torrent_id] = session
    active_handles[torrent_id] = handle
    
    # Wait for metadata if it's a magnet link
    if magnet_link:
        print(f"Magnet link provided. Downloading metadata for {torrent_id}")
        status_data = {'status': 'metadata', 'progress': 0}
        active_torrents[torrent_id] = status_data
        emit_torrent_update(torrent_id, status_data)
        
        # More robust metadata waiting with timeout and alert processing
        metadata_timeout = time.time() + config.METADATA_TIMEOUT
        last_log_time = time.time()
        last_emit_time = time.time()
        
        while True:
            # Process alerts to get metadata faster
            alerts = session.pop_alerts()
            for alert in alerts:
                alert_type = type(alert).__name__
                # Only log important alerts to avoid console spam
                if isinstance(alert, lt.metadata_received_alert) or "error" in alert_type.lower():
                    print(f"Alert: {alert_type} - {alert.message()}")
                    if isinstance(alert, lt.metadata_received_alert):
                        print(f"Metadata received for {torrent_id}")
            
            # Check if we have metadata
            status = handle.status()
            
            # Log status periodically
            current_time = time.time()
            if current_time - last_log_time > 5:
                print(f"Waiting for metadata: State={status.state}, Peers={status.num_peers}")
                last_log_time = current_time
            
            # Emit status update every second
            if current_time - last_emit_time > 1:
                status_data = {
                    'status': 'metadata', 
                    'progress': 0,
                    'peers': status.num_peers,
                    'state': str(status.state)
                }
                active_torrents[torrent_id] = status_data
                emit_torrent_update(torrent_id, status_data)
                last_emit_time = current_time
            
            # Check for metadata in a way that works across different libtorrent versions
            has_metadata = False
            try:
                if hasattr(status, 'has_metadata'):
                    has_metadata = status.has_metadata
                elif hasattr(handle, 'has_metadata') and callable(handle.has_metadata):
                    has_metadata = handle.has_metadata()
                elif status.name and len(status.name) > 0:
                    has_metadata = True
                    
                if has_metadata:
                    # Extra verification that we can actually access the torrent_file
                    torrent_info = handle.torrent_file()
                    if torrent_info:
                        name = torrent_info.name()
                        file_storage = torrent_info.files()
                        
                        # Store metadata for file selection
                        torrent_meta[torrent_id] = {
                            'name': name,
                            'total_size': get_readable_size(torrent_info.total_size()),
                            'files': [{
                                'path': file.path,
                                'size': file.size,
                                'size_readable': get_readable_size(file.size)
                            } for file in file_storage]
                        }
                        
                        print(f"Metadata successfully retrieved for {torrent_id}")
                        
                        # Move to file selection or start download
                        if selected_files is None and len(torrent_meta[torrent_id]['files']) > 1:
                            # If there are multiple files and no selection made, move to selection state
                            status_data = {'status': 'selection', 'meta': torrent_meta[torrent_id]}
                            active_torrents[torrent_id] = status_data
                            emit_torrent_update(torrent_id, status_data)
                            # Keep session and handle in memory to avoid redownloading metadata
                            # We'll return here and wait for the user to select files
                            return
                        else:
                            # If files were pre-selected or there's only one file, start downloading
                            start_actual_download(session, handle, torrent_id, selected_files)
                            return
                    else:
                        print(f"Failed to access torrent_file() for {torrent_id}")
            except Exception as e:
                print(f"Error checking metadata: {str(e)}")
                
            time.sleep(0.1)  # Shorter sleep time for more responsive UI
            
            if torrent_id not in active_torrents:
                # Download was cancelled
                print(f"Download cancelled for {torrent_id}")
                session.remove_torrent(handle, True)
                return
                
            # Check for timeout
            if time.time() > metadata_timeout:
                print(f"Metadata download timed out for {torrent_id}")
                status_data = {'status': 'error', 'message': 'Metadata download timed out. Please try again or use a different torrent.'}
                active_torrents[torrent_id] = status_data
                emit_torrent_update(torrent_id, status_data)
                session.remove_torrent(handle, True)
                return
    else:
        # For torrent files that already have metadata
        torrent_info = handle.torrent_file()
        name = torrent_info.name()
        file_storage = torrent_info.files()
        
        # Store metadata for file selection
        torrent_meta[torrent_id] = {
            'name': name,
            'total_size': get_readable_size(torrent_info.total_size()),
            'files': [{
                'path': file.path,
                'size': file.size,
                'size_readable': get_readable_size(file.size)
            } for file in file_storage]
        }
        
        # Move to file selection or start download
        if selected_files is None and len(torrent_meta[torrent_id]['files']) > 1:
            # If there are multiple files and no selection made, move to selection state
            status_data = {'status': 'selection', 'meta': torrent_meta[torrent_id]}
            active_torrents[torrent_id] = status_data
            emit_torrent_update(torrent_id, status_data)
            return
        else:
            # If files were pre-selected or there's only one file, start downloading
            start_actual_download(session, handle, torrent_id, selected_files)
            return

def start_actual_download(session, handle, torrent_id, selected_files=None):
    """Start the actual download using the existing session and handle"""
    try:
        # Set file priorities if provided
        if selected_files is not None:
            torrent_info = handle.torrent_file()
            if torrent_info:
                file_count = torrent_info.files().num_files()
                file_priorities = [0] * file_count
                for file_idx in selected_files:
                    if file_idx < file_count:
                        file_priorities[file_idx] = 1
                handle.prioritize_files(file_priorities)
                print(f"Set file priorities for {torrent_id}: {file_priorities}")
        
        # Start downloading
        status_data = {
            'status': 'downloading',
            'progress': 0,
            'download_rate': 0,
            'upload_rate': 0,
            'peers': 0,
            'state': 'starting',
            'meta': torrent_meta.get(torrent_id, {'name': 'Unknown'})
        }
        active_torrents[torrent_id] = status_data
        emit_torrent_update(torrent_id, status_data)
        
        print(f"Starting download for {torrent_id}")
        
        # Download loop
        last_emit_time = time.time()
        
        while True:
            s = handle.status()
            
            current_time = time.time()
            # Emit status update every 0.5 seconds for more responsive UI
            if current_time - last_emit_time > 0.5:
                status_data = {
                    'status': 'downloading',
                    'progress': s.progress * 100,
                    'download_rate': get_readable_size(s.download_rate),
                    'upload_rate': get_readable_size(s.upload_rate),
                    'peers': s.num_peers,
                    'state': str(s.state),
                    'meta': torrent_meta.get(torrent_id, {'name': 'Unknown'}),
                    'bytes_downloaded': s.total_done,
                    'total_bytes': s.total_wanted,
                    'bytes_downloaded_readable': get_readable_size(s.total_done),
                    'total_bytes_readable': get_readable_size(s.total_wanted),
                    'eta': get_eta(s.download_rate, s.total_wanted - s.total_done) if s.download_rate > 0 else "∞"
                }
                active_torrents[torrent_id] = status_data
                emit_torrent_update(torrent_id, status_data)
                last_emit_time = current_time
            
            # Check if download was cancelled
            if torrent_id not in active_torrents:
                print(f"Download cancelled for {torrent_id}")
                session.remove_torrent(handle, True)
                # Clean up stored session and handle
                if torrent_id in active_sessions:
                    del active_sessions[torrent_id]
                if torrent_id in active_handles:
                    del active_handles[torrent_id]
                return
            
            # Check if download is completed
            if s.progress >= 1.0:
                print(f"Download completed for {torrent_id}")
                
                # Add to completed torrents list
                torrent_info = handle.torrent_file()
                if torrent_info:
                    file_storage = torrent_info.files()
                    completed_torrents[torrent_id] = {
                        'name': torrent_info.name(),
                        'files': []
                    }
                    
                    for i in range(file_storage.num_files()):
                        if selected_files is None or i in selected_files:
                            file_info = file_storage.at(i)
                            completed_torrents[torrent_id]['files'].append({
                                'path': file_info.path,
                                'size': file_info.size,
                                'size_readable': get_readable_size(file_info.size)
                            })
                
                status_data = {'status': 'completed'}
                active_torrents[torrent_id] = status_data
                emit_torrent_update(torrent_id, status_data)
                
                # Also emit a completed_torrents_update event to refresh the completed torrents list
                socketio.emit('completed_torrents_update', {'torrents': completed_torrents})
                
                # Clean up stored session and handle
                if torrent_id in active_sessions:
                    del active_sessions[torrent_id]
                if torrent_id in active_handles:
                    del active_handles[torrent_id]
                break
            
            time.sleep(0.1)  # Shorter sleep time for more responsive UI
    
    except Exception as e:
        error_msg = str(e)
        print(f"Error in download process: {error_msg}")
        status_data = {'status': 'error', 'message': error_msg}
        active_torrents[torrent_id] = status_data
        emit_torrent_update(torrent_id, status_data)
    finally:
        # Cleanup
        try:
            if torrent_id in active_sessions and torrent_id in active_handles:
                session.remove_torrent(handle)
                print(f"Torrent removed from session for {torrent_id}")
        except Exception as e:
            print(f"Error removing torrent: {e}")