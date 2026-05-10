const { app, BrowserWindow, ipcMain } = require('electron');
const { keyboard, Key } = require("@nut-tree-fork/nut-js");
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 250,
    height: 250,
    alwaysOnTop: true,
    resizable: false,
    focusable: false,
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, 'assets/presentra-icon.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    }
  });
  
  win.loadFile('index.html');
}

// Listen for gesture events from the renderer
ipcMain.on('gesture-swipe', async (event, direction) => {
  try {
    if (direction === 'left') {
      await keyboard.type(Key.Left);
      console.log('Executed: Left Arrow');
    } else if (direction === 'right') {
      await keyboard.type(Key.Right);
      console.log('Executed: Right Arrow');
    }
  } catch (err) {
    console.error("Keyboard simulation failed:", err);
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});