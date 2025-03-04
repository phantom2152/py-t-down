from flask_socketio import emit
import torrent_manager

def init_socketio(socketio):
    """Initialize Socket.IO event handlers"""
    
    @socketio.on('connect')
    def handle_connect():
        """Handle client connection"""
        print("Client connected")
        # Send current active and completed torrents
        emit('initial_data', {
            'active_torrents': torrent_manager.active_torrents,
            'completed_torrents': torrent_manager.completed_torrents
        })

    @socketio.on('disconnect')
    def handle_disconnect():
        """Handle client disconnection"""
        print("Client disconnected")