const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFolder: (title) =>
    ipcRenderer.invoke('select-folder', title),

  readTextFile: (filePath) =>
    ipcRenderer.invoke('read-text-file', filePath),

  pathExists: (filePath) =>
    ipcRenderer.invoke('path-exists', filePath),

  findDatabaseFile: (folderPath, volumeNumber) =>
    ipcRenderer.invoke('find-database-file', folderPath, volumeNumber),

  toGalleryUrl: (filePath) =>
    ipcRenderer.invoke('to-gallery-url', filePath),

  resolvePhotoPath: (volumeRoot, cdSubfolder, filename) =>
    ipcRenderer.invoke('resolve-photo-path', volumeRoot, cdSubfolder, filename),

  platform: process.platform
});
