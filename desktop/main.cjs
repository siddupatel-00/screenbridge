const { app, BrowserWindow, Menu, Tray, nativeImage, shell, desktopCapturer, session } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const http = require('http');

let mainWindow = null;
let tray = null;
let isQuitting = false;

const SERVER_PORT = process.env.PORT || 8787;
const AGENT_PORT = 8790;

async function startServices() {
  const serverPath = path.join(__dirname, '..', 'server', 'index.js');
  const agentPath = path.join(__dirname, '..', 'agent', 'agent.js');

  try {
    console.log('[Electron] Starting embedded Server...');
    await import(pathToFileURL(serverPath).href);
  } catch (err) {
    console.error('[Electron] Failed to start server:', err);
  }

  try {
    console.log('[Electron] Starting embedded Agent...');
    await import(pathToFileURL(agentPath).href);
  } catch (err) {
    console.error('[Electron] Failed to start agent:', err);
  }
}

function waitForServer(callback, attempts = 30) {
  if (attempts <= 0) {
    callback(null, { url: `http://localhost:${SERVER_PORT}` });
    return;
  }
  const req = http.get(`http://127.0.0.1:${SERVER_PORT}/api/info`, (res) => {
    if (res.statusCode === 200) {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          callback(null, info);
        } catch {
          callback(null, { url: `http://localhost:${SERVER_PORT}` });
        }
      });
    } else {
      setTimeout(() => waitForServer(callback, attempts - 1), 150);
    }
  });
  req.on('error', () => {
    setTimeout(() => waitForServer(callback, attempts - 1), 150);
  });
}

function createTray(serverInfo) {
  try {
    const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
    tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 }));
  } catch {
    tray = new Tray(nativeImage.createEmpty());
  }

  const lanUrl = serverInfo?.url || `http://localhost:${SERVER_PORT}`;
  const contextMenu = Menu.buildFromTemplate([
    { label: `ScreenBridge: ${lanUrl}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Open Window',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Copy LAN Host URL',
      click: () => {
        const { clipboard } = require('electron');
        clipboard.writeText(lanUrl);
      }
    },
    {
      label: 'Open in Default Browser',
      click: () => shell.openExternal(lanUrl)
    },
    { type: 'separator' },
    {
      label: 'Quit ScreenBridge',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip(`ScreenBridge - ${lanUrl}`);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) mainWindow.hide();
      else { mainWindow.show(); mainWindow.focus(); }
    }
  });
}

function createWindow(serverInfo) {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'ScreenBridge',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: '#0f172a'
  });

  // Enable screen / window capture in getDisplayMedia
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      if (sources.length > 0) {
        callback({ video: sources[0] });
      } else {
        callback({});
      }
    }).catch(() => callback({}));
  });

  const url = `http://localhost:${SERVER_PORT}`;
  mainWindow.loadURL(url);

  mainWindow.on('close', (event) => {
    if (!isQuitting && process.platform === 'darwin') {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  createTray(serverInfo);
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    await startServices();
    waitForServer((err, info) => {
      createWindow(info);
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else if (mainWindow) {
        mainWindow.show();
      }
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
