import os

# App configuration
SECRET_KEY = 'your_secret_key_here'
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'downloads')
MAX_CONTENT_LENGTH = 16 * 1024 * 1024 

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

DEFAULT_TORRENT_SETTINGS = {
    'listen_interfaces': '0.0.0.0:6881',
    'alert_mask': None, 
    'enable_dht': True,
    'enable_lsd': True,
    'enable_natpmp': True,
    'enable_upnp': True,
    'download_rate_limit': 0,
    'upload_rate_limit': 0,
    'auto_manage_startup': 10,
    'dht_bootstrap_nodes': 'router.bittorrent.com:6881,router.utorrent.com:6881,dht.transmissionbt.com:6881'
}

# DHT Nodes
DHT_NODES = [
    ("router.bittorrent.com", 6881),
    ("dht.transmissionbt.com", 6881),
    ("router.utorrent.com", 6881)
]

# Timeouts
METADATA_TIMEOUT = 60  