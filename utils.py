import base64
import os
import shutil
import tempfile
import zipfile

def get_readable_size(size_bytes):
    """Convert bytes to human-readable format"""
    if size_bytes == 0:
        return "0B"
    size_name = ("B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB")
    i = 0
    while size_bytes >= 1024 and i < len(size_name) - 1:
        size_bytes /= 1024
        i += 1
    return f"{size_bytes:.2f} {size_name[i]}"

def get_eta(download_rate, bytes_left):
    """Calculate estimated time of arrival (ETA)"""
    if download_rate == 0:
        return "∞"
    
    seconds = bytes_left / download_rate
    
    if seconds < 60:
        return f"{int(seconds)}s"
    elif seconds < 3600:
        return f"{int(seconds / 60)}m {int(seconds % 60)}s"
    elif seconds < 86400:
        return f"{int(seconds / 3600)}h {int((seconds % 3600) / 60)}m"
    else:
        return f"{int(seconds / 86400)}d {int((seconds % 86400) / 3600)}h"

def create_zip_file(file_paths, base_dir, zip_filename):
    """Create a zip file from a list of file paths"""
    temp_dir = tempfile.mkdtemp()
    zip_path = os.path.join(temp_dir, zip_filename)
    
    with zipfile.ZipFile(zip_path, 'w') as zipf:
        for file_path in file_paths:
            full_path = os.path.join(base_dir, file_path)
            if os.path.exists(full_path) and os.path.isfile(full_path):
                # Add file to zip with its relative path
                zipf.write(full_path, file_path)
    
    return zip_path, temp_dir

def encode_path_for_url(path):
    """Encode a file path to be safe in URL"""
    return base64.urlsafe_b64encode(path.encode()).decode()

def decode_path_from_url(encoded_path):
    """Decode a file path from URL-safe encoding"""
    return base64.urlsafe_b64decode(encoded_path.encode()).decode()

def cleanup_dir(directory):
    """Remove a directory and all its contents"""
    try:
        shutil.rmtree(directory, ignore_errors=True)
    except Exception as e:
        print(f"Error cleaning up directory: {e}")