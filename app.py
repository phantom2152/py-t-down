# app.py - Main Flask application with Socket.IO
from flask import Flask
from flask_socketio import SocketIO

import config
import torrent_manager
import socket_handlers
import routes

def create_app():
    """Create and configure the Flask application"""
    app = Flask(__name__)
    app.config['SECRET_KEY'] = config.SECRET_KEY
    app.config['UPLOAD_FOLDER'] = config.UPLOAD_FOLDER
    app.config['MAX_CONTENT_LENGTH'] = config.MAX_CONTENT_LENGTH
    
    # Initialize Socket.IO
    socketio = SocketIO(app, cors_allowed_origins="*")
    
    # Initialize torrent manager
    torrent_manager.init_app(socketio)
    
    # Initialize Socket.IO event handlers
    socket_handlers.init_socketio(socketio)
    
    # Initialize routes
    routes.init_routes(app, socketio)
    
    return app, socketio

# Create the application
app, socketio = create_app()

if __name__ == '__main__':
    socketio.run(app, debug=True, port=5000, allow_unsafe_werkzeug=True)