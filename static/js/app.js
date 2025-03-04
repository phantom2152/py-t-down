document.addEventListener('DOMContentLoaded', function() {
    // Connect to Socket.IO server
    const socket = io();
    
    // Torrent tracking
    const activeTorrents = {};
    const torrentsInSelectionState = {};  // Track torrents in selection state
    const selectedFilesCache = {};  // Cache for selected files
    let currentTorrentId = null;
    
    // Global stats
    let globalDownloadRate = 0;
    let globalUploadRate = 0;
    
    // Socket.IO event handlers
    socket.on('connect', function() {
        console.log("Connected to server");
        showToast("Connected to server", "success");
    });
    
    socket.on('disconnect', function() {
        console.log("Disconnected from server");
        showToast("Connection lost", "error");
    });
    
    socket.on('initial_data', function(data) {
        console.log("Received initial data", data);
        
        // Process active torrents
        for (const [torrentId, torrentData] of Object.entries(data.active_torrents)) {
            activeTorrents[torrentId] = torrentData;
            updateTorrentUI(torrentId, torrentData);
        }
        
        // Process completed torrents
        updateCompletedTorrentsUI(data.completed_torrents);
    });
    
    socket.on('torrent_update', function(data) {
        const torrentId = data.torrent_id;
        const torrentData = data.data;
        
        // Update our local state
        activeTorrents[torrentId] = torrentData;
        
        // Update the UI
        updateTorrentUI(torrentId, torrentData);
        
        // Update global stats
        updateGlobalStats();
    });
    
    socket.on('torrent_removed', function(data) {
        const torrentId = data.torrent_id;
        
        // Remove from our tracking
        if (torrentId in activeTorrents) {
            delete activeTorrents[torrentId];
        }
        
        // Remove from UI
        const torrentElement = document.getElementById(`torrent-${torrentId}`);
        if (torrentElement) {
            torrentElement.remove();
        }
        
        // Update global stats
        updateGlobalStats();
    });
    
    socket.on('completed_torrents_update', function(data) {
        updateCompletedTorrentsUI(data.torrents);
    });
    
    // Update global stats
    function updateGlobalStats() {
        let totalDownloadRate = 0;
        let totalUploadRate = 0;
        
        for (const torrentData of Object.values(activeTorrents)) {
            if (torrentData.status === 'downloading') {
                // Parse the download/upload rates
                const dlRate = parseRateString(torrentData.download_rate);
                const ulRate = parseRateString(torrentData.upload_rate);
                
                if (dlRate) totalDownloadRate += dlRate;
                if (ulRate) totalUploadRate += ulRate;
            }
        }
        
        // Update the UI
        document.getElementById('global-download-speed').textContent = formatRate(totalDownloadRate);
        document.getElementById('global-upload-speed').textContent = formatRate(totalUploadRate);
    }
    
    // Helper function to parse rate strings like "1.25 MB/s" into bytes/second
    function parseRateString(rateStr) {
        try {
            const match = rateStr.match(/^([\d.]+)\s+(B|KB|MB|GB|TB)/);
            if (!match) return 0;
            
            const value = parseFloat(match[1]);
            const unit = match[2];
            
            // Convert to bytes/second
            switch (unit) {
                case 'B': return value;
                case 'KB': return value * 1024;
                case 'MB': return value * 1024 * 1024;
                case 'GB': return value * 1024 * 1024 * 1024;
                case 'TB': return value * 1024 * 1024 * 1024 * 1024;
                default: return 0;
            }
        } catch (e) {
            return 0;
        }
    }
    
    // Helper function to format bytes/second into a readable rate
    function formatRate(bytesPerSecond) {
        if (bytesPerSecond < 1024) {
            return bytesPerSecond.toFixed(0) + " B/s";
        } else if (bytesPerSecond < 1024 * 1024) {
            return (bytesPerSecond / 1024).toFixed(2) + " KB/s";
        } else if (bytesPerSecond < 1024 * 1024 * 1024) {
            return (bytesPerSecond / (1024 * 1024)).toFixed(2) + " MB/s";
        } else {
            return (bytesPerSecond / (1024 * 1024 * 1024)).toFixed(2) + " GB/s";
        }
    }
    
    // Show toast notification
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `custom-toast toast-${type}`;
        toast.innerHTML = `
            <div class="d-flex">
                <div>${message}</div>
                <button type="button" class="btn-close ms-auto" aria-label="Close"></button>
            </div>
        `;
        
        document.getElementById('toastContainer').appendChild(toast);
        
        // Add event listener to close button
        toast.querySelector('.btn-close').addEventListener('click', () => {
            toast.remove();
        });
        
        // Auto hide after 5 seconds
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }
    
    // Drag and drop functionality
    const dropZone = document.getElementById('dropZone');
    const torrentFile = document.getElementById('torrentFile');
    const fileInfo = document.getElementById('fileInfo');
    const fileName = document.getElementById('fileName');
    
    dropZone.addEventListener('click', () => {
        torrentFile.click();
    });
    
    torrentFile.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            showFileInfo(e.target.files[0]);
        }
    });
    
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        
        if (e.dataTransfer.files.length > 0) {
            torrentFile.files = e.dataTransfer.files;
            showFileInfo(e.dataTransfer.files[0]);
        }
    });
    
    function showFileInfo(file) {
        fileName.textContent = file.name;
        fileInfo.classList.remove('d-none');
    }
    
    // Form submissions
    const magnetForm = document.getElementById('magnetForm');
    const fileForm = document.getElementById('fileForm');
    
    magnetForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const magnetLink = document.getElementById('magnetLink').value.trim();
        
        if (magnetLink) {
            addTorrent({ magnet: magnetLink });
            document.getElementById('magnetLink').value = '';
        } else {
            showToast("Please enter a magnet link", "warning");
        }
    });
    
    fileForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const fileInput = document.getElementById('torrentFile');
        
        if (fileInput.files.length > 0) {
            const formData = new FormData();
            formData.append('torrent_file', fileInput.files[0]);
            addTorrent(formData, true);
            
            // Reset file input
            fileInput.value = '';
            fileInfo.classList.add('d-none');
        } else {
            showToast("Please select a torrent file", "warning");
        }
    });
    
    // Add torrent function
    function addTorrent(data, isFormData = false) {
        showToast("Adding torrent...", "info");
        
        const options = {
            method: 'POST',
            headers: isFormData ? {} : {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: isFormData ? data : new URLSearchParams(data)
        };
        
        fetch('/api/add_torrent', options)
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    showToast("Torrent added successfully", "success");
                } else {
                    showToast("Error: " + data.message, "error");
                }
            })
            .catch(error => {
                console.error('Error:', error);
                showToast("An error occurred while adding the torrent", "error");
            });
    }
    
    // Update UI for a torrent - Fixed version to maintain event listeners
    function updateTorrentUI(torrentId, data) {
        let torrentElement = document.getElementById(`torrent-${torrentId}`);
        
        // If element doesn't exist, create it
        if (!torrentElement) {
            torrentElement = document.createElement('div');
            torrentElement.id = `torrent-${torrentId}`;
            torrentElement.className = 'card mb-3';
            document.getElementById('activeTorrents').appendChild(torrentElement);
        }
        
        // Store the current HTML to check if we're actually changing content
        const currentHTML = torrentElement.innerHTML;
        
        // Generate new HTML based on status
        let newHTML = '';
        if (data.status === 'metadata') {
            newHTML = `
                <div class="card-body">
                    <div class="d-flex align-items-center mb-3">
                        <div class="spinner-border text-primary metadata-spinner" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        <h5 class="card-title mb-0">Fetching Torrent Metadata...</h5>
                        <button class="btn btn-sm btn-outline-danger ms-auto cancel-btn" data-torrent-id="${torrentId}">
                            Cancel
                        </button>
                    </div>
                    <div class="progress">
                        <div class="progress-bar progress-bar-striped progress-bar-animated" 
                             role="progressbar" style="width: 100%"></div>
                    </div>
                    <div class="mt-2 text-muted">
                        <small>Connecting to peers... This may take a minute.</small>
                    </div>
                </div>
            `;
            // Reset selection state when in metadata state
            torrentsInSelectionState[torrentId] = false;
        } else if (data.status === 'selection') {
            // Only show file selection UI if not already shown
            if (!torrentsInSelectionState[torrentId]) {
                console.log("Showing file selection modal for torrent: " + torrentId);
                showFileSelectionModal(torrentId, data.meta);
                torrentsInSelectionState[torrentId] = true;
            }
            
            newHTML = `
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h5 class="card-title mb-0">${data.meta.name}</h5>
                        <button class="btn btn-sm btn-outline-danger cancel-btn" data-torrent-id="${torrentId}">
                            Cancel
                        </button>
                    </div>
                    <div class="alert alert-info mb-0">
                        <i class="bi bi-info-circle me-2"></i>
                        Please select files to download. If you don't see a dialog, 
                        <button class="btn btn-sm btn-link p-0 align-baseline" id="reopen-selection-${torrentId}">click here</button>
                        to select files.
                    </div>
                </div>
            `;
        } else if (data.status === 'downloading') {
            // Reset selection state
            torrentsInSelectionState[torrentId] = false;
            
            const progress = data.progress.toFixed(1);
            const isAlmostComplete = progress > 99;
            
            newHTML = `
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h5 class="mb-0">${data.meta?.name || 'Downloading...'}</h5>
                    <button class="btn btn-sm btn-outline-danger cancel-btn" data-torrent-id="${torrentId}">
                        Cancel
                    </button>
                </div>
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <span>${progress}%</span>
                        <span class="eta-badge">
                            <i class="bi bi-clock"></i> ${data.eta || '∞'}
                        </span>
                    </div>
                    <div class="progress ${isAlmostComplete ? 'progress-complete' : ''}">
                        <div class="progress-bar" role="progressbar" 
                             style="width: ${progress}%" aria-valuenow="${progress}" 
                             aria-valuemin="0" aria-valuemax="100"></div>
                    </div>
                    <div class="row mt-3">
                        <div class="col-md-6">
                            <div class="stat-card">
                                <span class="stat-label">Downloaded</span>
                                <span class="stat-value">${data.bytes_downloaded_readable || '0 B'} / ${data.total_bytes_readable || '0 B'}</span>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="stat-card">
                                <span class="stat-label">Speed</span>
                                <span class="stat-value">${data.download_rate || '0 B/s'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="torrent-status mt-2">
                        <div class="torrent-status-item">
                            <i class="bi bi-arrow-down"></i> ${data.download_rate || '0 B/s'}
                        </div>
                        <div class="torrent-status-item">
                            <i class="bi bi-arrow-up"></i> ${data.upload_rate || '0 B/s'}
                        </div>
                        <div class="torrent-status-item">
                            <i class="bi bi-people"></i> ${data.peers || 0} peers
                        </div>
                        <div class="torrent-status-item">
                            <i class="bi bi-info-circle"></i> ${data.state || 'Unknown'}
                        </div>
                    </div>
                </div>
            `;
        } else if (data.status === 'error') {
            // Reset selection state
            torrentsInSelectionState[torrentId] = false;
            
            newHTML = `
                <div class="card-body">
                    <div class="alert alert-danger mb-0">
                        <div class="d-flex align-items-center">
                            <i class="bi bi-exclamation-triangle-fill me-2"></i>
                            <div>
                                <h5 class="alert-heading">Error</h5>
                                <p class="mb-0">${data.message}</p>
                            </div>
                            <button class="btn btn-sm btn-outline-danger ms-auto cancel-btn" data-torrent-id="${torrentId}">
                                Dismiss
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }
        
        // Only update the DOM if the content has actually changed
        // This helps avoid unnecessary re-renders and event listener loss
        if (newHTML !== currentHTML) {
            torrentElement.innerHTML = newHTML;
            
            // Add event listeners after updating content
            const cancelBtn = torrentElement.querySelector('.cancel-btn');
            if (cancelBtn) {
                // Remove any existing event listeners (extra safety)
                cancelBtn.replaceWith(cancelBtn.cloneNode(true));
                
                // Add the event listener to the fresh button
                torrentElement.querySelector('.cancel-btn').addEventListener('click', () => {
                    cancelTorrent(torrentId);
                });
            }
            
            // Add other button event listeners if needed
            if (data.status === 'selection') {
                const reopenBtn = document.getElementById(`reopen-selection-${torrentId}`);
                if (reopenBtn) {
                    reopenBtn.addEventListener('click', () => {
                        showFileSelectionModal(torrentId, data.meta);
                    });
                }
            }
        }
    }
    
    // Cancel a torrent download
    function cancelTorrent(torrentId) {
        fetch(`/api/cancel_torrent/${torrentId}`, { method: 'POST' })
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    delete activeTorrents[torrentId];
                    delete torrentsInSelectionState[torrentId];
                    delete selectedFilesCache[torrentId];
                    const torrentElement = document.getElementById(`torrent-${torrentId}`);
                    if (torrentElement) {
                        torrentElement.remove();
                    }
                    showToast("Torrent cancelled", "info");
                } else {
                    showToast("Error: " + data.message, "error");
                }
            })
            .catch(error => {
                console.error('Error cancelling torrent:', error);
                showToast("Error cancelling torrent", "error");
            });
    }
    
    // File selection modal functionality
    const fileSelectionModal = new bootstrap.Modal(document.getElementById('fileSelectionModal'));
    const selectAllFiles = document.getElementById('selectAllFiles');
    const filesList = document.getElementById('filesList');
    const startDownloadBtn = document.getElementById('startDownloadBtn');
    
    function showFileSelectionModal(torrentId, meta) {
        currentTorrentId = torrentId;
        
        // Set torrent info
        document.getElementById('torrentName').textContent = meta.name;
        document.getElementById('torrentSize').textContent = 'Total size: ' + meta.total_size;
        
        // Clear and populate files list
        filesList.innerHTML = '';
        meta.files.forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'list-group-item';
            fileItem.innerHTML = `
                <div class="form-check">
                    <input class="form-check-input file-checkbox" type="checkbox" value="${index}" 
                           id="file-${index}">
                    <label class="form-check-label w-100" for="file-${index}">
                        <div class="d-flex justify-content-between">
                            <span>${file.path}</span>
                            <span class="text-muted">${file.size_readable}</span>
                        </div>
                    </label>
                </div>
            `;
            filesList.appendChild(fileItem);
        });
        
        // Reset select all checkbox
        selectAllFiles.checked = false;
        
        // Show modal
        fileSelectionModal.show();
    }
    
    // Function to update selected files cache
    function updateSelectedFilesCache() {
        if (!currentTorrentId) return;
        
        const fileCheckboxes = document.querySelectorAll('.file-checkbox');
        const selectedFiles = Array.from(fileCheckboxes)
            .filter(checkbox => checkbox.checked)
            .map(checkbox => parseInt(checkbox.value));
        
        selectedFilesCache[currentTorrentId] = selectedFiles;
    }
    
    // Add event listener for individual file checkboxes
    document.addEventListener('click', function(e) {
        if (e.target && e.target.classList.contains('file-checkbox')) {
            updateSelectedFilesCache();
        }
    });
    
    // Select/deselect all files
    selectAllFiles.addEventListener('change', () => {
        const fileCheckboxes = document.querySelectorAll('.file-checkbox');
        fileCheckboxes.forEach(checkbox => {
            checkbox.checked = selectAllFiles.checked;
        });
        
        // Update cache after changing all checkboxes
        updateSelectedFilesCache();
    });
    
    // Start download with selected files
    startDownloadBtn.addEventListener('click', () => {
        const fileCheckboxes = document.querySelectorAll('.file-checkbox:checked');
        const selectedFiles = Array.from(fileCheckboxes).map(checkbox => parseInt(checkbox.value));
        
        if (selectedFiles.length === 0) {
            showToast("Please select at least one file to download", "warning");
            return;
        }
        
        // Save to cache before sending
        selectedFilesCache[currentTorrentId] = selectedFiles;
        
        // Hide the modal before making the request
        fileSelectionModal.hide();
        
        // Mark torrent as no longer in selection state
        torrentsInSelectionState[currentTorrentId] = false;
        
        // Show loading toast
        showToast("Starting download...", "info");
        
        fetch(`/api/select_files/${currentTorrentId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ selected_files: selectedFiles })
        })
            .then(response => response.json())
            .then(data => {
                if (data.status !== 'success') {
                    showToast("Error: " + data.message, "error");
                }
            })
            .catch(error => {
                console.error('Error selecting files:', error);
                showToast("An error occurred while selecting files", "error");
            });
    });
    
    // Function to organize files into a folder structure
    function organizeFilesIntoFolders(files) {
        const structure = {};
        
        files.forEach(file => {
            const parts = file.path.split('/');
            let current = structure;
            
            // Process each part of the path
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                
                // If this is the file (last part)
                if (i === parts.length - 1) {
                    if (!current._files) current._files = [];
                    current._files.push({
                        name: part,
                        path: file.path,
                        size: file.size,
                        size_readable: file.size_readable
                    });
                } 
                // Otherwise it's a folder
                else {
                    if (!current[part]) current[part] = {};
                    current = current[part];
                }
            }
        });
        
        return structure;
    }

    // Function to build HTML for the folder structure
    function buildFolderStructureHTML(structure, path = '', depth = 0, torrentId) {
        let html = '<ul class="folder-structure">';
        
        // Process folders
        for (const [folderName, contents] of Object.entries(structure)) {
            // Skip the special _files property which we handle separately
            if (folderName === '_files') continue;
            
            const folderPath = path ? `${path}/${folderName}` : folderName;
            const folderId = `folder-${torrentId}-${btoa(folderPath).replace(/=/g, '')}`;
            
            html += `
                <li>
                    <div class="folder-item" data-folder-id="${folderId}">
                        <i class="bi bi-chevron-right folder-toggle"></i>
                        <i class="bi bi-folder"></i>
                        ${folderName}
                        <div class="actions">
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteFolder('${torrentId}', '${folderPath}')">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </div>
                    <div class="folder-contents" id="${folderId}">
                        ${buildFolderStructureHTML(contents, folderPath, depth + 1, torrentId)}
                    </div>
                </li>
            `;
        }
        
        // Process files in the current folder
        if (structure._files) {
            structure._files.forEach(file => {
                const fileName = file.name;
                const filePath = file.path;
                
                html += `
                    <li>
                        <div class="folder-item">
                            <i class="bi bi-file-earmark"></i>
                            ${fileName}
                            <span class="file-size">${file.size_readable}</span>
                            <div class="actions">
                                <a href="/api/download_file?torrent_id=${torrentId}&file_path=${encodeURIComponent(filePath)}" 
                                   class="btn btn-sm btn-outline-primary">
                                    <i class="bi bi-download"></i>
                                </a>
                                <button class="btn btn-sm btn-outline-danger" onclick="deleteFile('${torrentId}', '${filePath}')">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </div>
                        </div>
                    </li>
                `;
            });
        }
        
        html += '</ul>';
        return html;
    }
    
    // Update completed torrents UI with folder structure
    function updateCompletedTorrentsUI(torrents) {
        const completedTorrentsDiv = document.getElementById('completedTorrents');
        const completedTorrentsSection = document.getElementById('completedTorrentsSection');
        
        if (Object.keys(torrents).length > 0) {
            completedTorrentsSection.classList.remove('d-none');
            completedTorrentsDiv.innerHTML = '';
            
            for (const [torrentId, torrent] of Object.entries(torrents)) {
                const torrentCard = document.createElement('div');
                torrentCard.className = 'card mb-3';
                
                // Create the torrent card header
                const cardHeader = document.createElement('div');
                cardHeader.className = 'card-header d-flex justify-content-between align-items-center';
                cardHeader.innerHTML = `
                    <h5 class="mb-0">${torrent.name}</h5>
                    <div class="btn-group">
                        <button class="btn btn-sm btn-primary download-all-btn" data-torrent-id="${torrentId}">
                            <i class="bi bi-download"></i> Download All
                        </button>
                        <button class="btn btn-sm btn-outline-danger delete-torrent-btn" data-torrent-id="${torrentId}">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                `;
                torrentCard.appendChild(cardHeader);
                
                // Create the card body with folder structure
                const cardBody = document.createElement('div');
                cardBody.className = 'card-body';
                
                // Organize files into folders
                const folderStructure = organizeFilesIntoFolders(torrent.files);
                
                // Build HTML for the folder structure
                cardBody.innerHTML = buildFolderStructureHTML(folderStructure, '', 0, torrentId);
                
                torrentCard.appendChild(cardBody);
                completedTorrentsDiv.appendChild(torrentCard);
                
                // Add event listeners for the torrent card
                const downloadAllBtn = torrentCard.querySelector('.download-all-btn');
                downloadAllBtn.addEventListener('click', () => {
                    const filePaths = torrent.files.map(file => file.path);
                    downloadAsZip(torrentId, filePaths);
                });
                
                const deleteTorrentBtn = torrentCard.querySelector('.delete-torrent-btn');
                deleteTorrentBtn.addEventListener('click', () => {
                    deleteTorrent(torrentId);
                });
            }
            
            // Add event listeners for folder toggling
            document.querySelectorAll('.folder-item[data-folder-id]').forEach(folderItem => {
                folderItem.addEventListener('click', (e) => {
                    // Prevent event from propagating if the delete button was clicked
                    if (e.target.closest('.actions')) {
                        e.stopPropagation();
                        return;
                    }
                    
                    const folderId = folderItem.getAttribute('data-folder-id');
                    folderItem.classList.toggle('folder-open');
                    
                    // Toggle the folder contents
                    const folderContents = document.getElementById(folderId);
                    if (folderContents) {
                        if (folderItem.classList.contains('folder-open')) {
                            folderContents.style.maxHeight = '1000px';
                        } else {
                            folderContents.style.maxHeight = '0';
                        }
                    }
                });
            });
        } else {
            completedTorrentsSection.classList.add('d-none');
        }
    }
    
    // Download files as zip
    function downloadAsZip(torrentId, filePaths) {
        showToast("Preparing zip file...", "info");
        
        fetch('/api/download_zip', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                torrent_id: torrentId,
                file_paths: filePaths
            })
        })
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    showToast("Download started", "success");
                    
                    // Create a temporary link to trigger download
                    const link = document.createElement('a');
                    link.href = data.download_url;
                    link.download = '';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                } else {
                    showToast("Error: " + data.message, "error");
                }
            })
            .catch(error => {
                console.error('Error creating zip:', error);
                showToast("An error occurred while creating the zip file", "error");
            });
    }
    
    // File and folder deletion functions
    window.deleteFile = function(torrentId, filePath) {
        if (confirm(`Are you sure you want to delete this file?\n${filePath}`)) {
            fetch(`/api/delete_file`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    torrent_id: torrentId,
                    file_path: filePath
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    showToast("File deleted successfully", "success");
                    // Refresh the completed torrents list
                    fetch('/api/list_completed')
                        .then(response => response.json())
                        .then(data => {
                            if (data.status === 'success') {
                                updateCompletedTorrentsUI(data.torrents);
                            }
                        });
                } else {
                    showToast("Error: " + data.message, "error");
                }
            })
            .catch(error => {
                console.error('Error deleting file:', error);
                showToast("An error occurred while deleting the file", "error");
            });
        }
    };

    window.deleteFolder = function(torrentId, folderPath) {
        if (confirm(`Are you sure you want to delete this folder and all its contents?\n${folderPath}`)) {
            fetch(`/api/delete_folder`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    torrent_id: torrentId,
                    folder_path: folderPath
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    showToast("Folder deleted successfully", "success");
                    // Refresh the completed torrents list
                    fetch('/api/list_completed')
                        .then(response => response.json())
                        .then(data => {
                            if (data.status === 'success') {
                                updateCompletedTorrentsUI(data.torrents);
                            }
                        });
                } else {
                    showToast("Error: " + data.message, "error");
                }
            })
            .catch(error => {
                console.error('Error deleting folder:', error);
                showToast("An error occurred while deleting the folder", "error");
            });
        }
    };

    window.deleteTorrent = function(torrentId) {
        if (confirm("Are you sure you want to delete this entire torrent and all its files?")) {
            fetch(`/api/delete_torrent`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    torrent_id: torrentId
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    showToast("Torrent deleted successfully", "success");
                    // Refresh the completed torrents list
                    fetch('/api/list_completed')
                        .then(response => response.json())
                        .then(data => {
                            if (data.status === 'success') {
                                updateCompletedTorrentsUI(data.torrents);
                            }
                        });
                } else {
                    showToast("Error: " + data.message, "error");
                }
            })
            .catch(error => {
                console.error('Error deleting torrent:', error);
                showToast("An error occurred while deleting the torrent", "error");
            });
        }
    };
    
    // Dark mode toggle
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const htmlElement = document.documentElement;
    
    // Check if dark mode is enabled in local storage
    if (localStorage.getItem('darkMode') === 'enabled') {
        enableDarkMode();
    }
    
    darkModeToggle.addEventListener('click', () => {
        if (htmlElement.classList.contains('dark-mode')) {
            disableDarkMode();
        } else {
            enableDarkMode();
        }
    });
    
    function enableDarkMode() {
        htmlElement.classList.add('dark-mode');
        darkModeToggle.innerHTML = '<i class="bi bi-sun"></i>';
        localStorage.setItem('darkMode', 'enabled');
    }
    
    function disableDarkMode() {
        htmlElement.classList.remove('dark-mode');
        darkModeToggle.innerHTML = '<i class="bi bi-moon"></i>';
        localStorage.setItem('darkMode', 'disabled');
    }
    
    // Check for completed torrents on page load
    fetch('/api/list_completed')
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                updateCompletedTorrentsUI(data.torrents);
            }
        })
        .catch(error => {
            console.error('Error checking completed torrents:', error);
        });
});