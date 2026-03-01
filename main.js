const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f0f1a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

// Register a custom protocol to serve local image files safely
app.whenReady().then(() => {
  // 'gallery' protocol allows serving local files from user-selected folders
  protocol.handle('gallery', async (request) => {
    const fileUrl = request.url.replace('gallery://', 'file://');
    const filePath = fileURLToPath(fileUrl);
    try {
      const data = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase().slice(1);
      const mimeTypes = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp',
        tif: 'image/tiff', tiff: 'image/tiff'
      };
      return new Response(data, {
        headers: { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' }
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC Handlers ────────────────────────────────────────────────────────────

// Open a folder picker dialog
ipcMain.handle('select-folder', async (event, title) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Select Folder',
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

// Read a text file from disk
ipcMain.handle('read-text-file', async (event, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
});

// Check whether a file/folder exists
ipcMain.handle('path-exists', async (event, filePath) => {
  return fs.existsSync(filePath);
});

// Find the database txt file inside the selected volume folder
ipcMain.handle('find-database-file', async (event, folderPath, volumeNumber) => {
  const names = [
    `database-roncd${volumeNumber}-strings.txt`,
    `database-roncd${volumeNumber}-strings.TXT`,
    `DATABASE-RONCD${volumeNumber}-STRINGS.TXT`
  ];
  for (const name of names) {
    const candidate = path.join(folderPath, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  // Also do a shallow scan for any *strings.txt file
  try {
    const entries = fs.readdirSync(folderPath);
    const found = entries.find(e =>
      e.toLowerCase().includes('strings') && e.toLowerCase().endsWith('.txt')
    );
    if (found) return path.join(folderPath, found);
  } catch {}
  return null;
});

// Convert a native filesystem path to a gallery:// URL for the renderer
ipcMain.handle('to-gallery-url', async (event, filePath) => {
  // pathToFileURL correctly handles all platforms and encodes special characters.
  // We swap the file:// scheme for gallery:// so Electron routes it to our handler.
  return pathToFileURL(filePath).toString().replace('file://', 'gallery://');
});

// Resolve a photo's local path given the volume root and the CD subfolder path
ipcMain.handle('resolve-photo-path', async (event, volumeRoot, cdSubfolder, filename) => {
  // cdSubfolder is something like "a/mono" (already stripped of drive + cdvX)
  const candidatePath = path.join(volumeRoot, cdSubfolder, filename);
  if (fs.existsSync(candidatePath)) return candidatePath;

  // Fallback: case-insensitive search in the subfolder
  try {
    const dir = path.join(volumeRoot, cdSubfolder);
    if (fs.existsSync(dir)) {
      const entries = fs.readdirSync(dir);
      const match = entries.find(e => e.toLowerCase() === filename.toLowerCase());
      if (match) return path.join(dir, match);
    }
  } catch {}

  // Second fallback: search recursively up to 3 levels deep
  const found = findFileRecursive(volumeRoot, filename, 3);
  return found || null;
});

function findFileRecursive(dir, filename, depth) {
  if (depth < 0) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
        return path.join(dir, entry.name);
      }
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const result = findFileRecursive(path.join(dir, entry.name), filename, depth - 1);
        if (result) return result;
      }
    }
  } catch {}
  return null;
}
