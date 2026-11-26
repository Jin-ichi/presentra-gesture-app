const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { keyboard, mouse, Key, Button, Point } = require('@nut-tree-fork/nut-js');
const path = require('path');

// Keep mouse movement responsive in pointer mode
mouse.config.autoDelayMs = 5;
mouse.config.mouseSpeed = 2000;

function createWindow() {
  const win = new BrowserWindow({
    width: 260,
    height: 290,
    alwaysOnTop: true,
    resizable: false,
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, 'assets/presentra-icon.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile('index.html');
}

// Helper to safely trigger a key if it exists on nut.js Key enum
async function safePressKey(...keys) {
  const validKeys = keys.filter((k) => k !== undefined && k !== null);
  if (validKeys.length === 0) return false;
  await keyboard.type(...validKeys);
  return true;
}

ipcMain.on('gesture-action', async (_event, action) => {
  try {
    switch (action) {
      case 'prev_slide':
      case 'left':
        await keyboard.type(Key.Left);
        break;

      case 'next_slide':
      case 'right':
        await keyboard.type(Key.Right);
        break;

      case 'zoom_in': {
        // Ctrl + Plus (falls back to mouse scroll up if needed)
        const plusKey = Key.Add ?? Key.Equal;
        const sent = await safePressKey(Key.LeftControl, plusKey);
        if (!sent && typeof mouse.scrollUp === 'function') {
          await mouse.scrollUp(120);
        }
        break;
      }

      case 'zoom_out': {
        const minusKey = Key.Subtract ?? Key.Minus;
        const sent = await safePressKey(Key.LeftControl, minusKey);
        if (!sent && typeof mouse.scrollDown === 'function') {
          await mouse.scrollDown(120);
        }
        break;
      }

      case 'media_play_pause': {
        // Tries nut.js media key names if exposed in your installed version
        const mediaKey = Key.MediaPlayPause ?? Key.AudioPlay ?? Key.Play;
        if (mediaKey) {
          await keyboard.type(mediaKey);
        }
        break;
      }

      case 'volume_up': {
        const volUp = Key.AudioVolUp ?? Key.VolumeUp;
        if (volUp) {
          await keyboard.type(volUp);
        } else if (typeof mouse.scrollUp === 'function') {
          await mouse.scrollUp(80);
        }
        break;
      }

      case 'volume_down': {
        const volDown = Key.AudioVolDown ?? Key.VolumeDown;
        if (volDown) {
          await keyboard.type(volDown);
        } else if (typeof mouse.scrollDown === 'function') {
          await mouse.scrollDown(80);
        }
        break;
      }

      case 'pointer_click':
        await mouse.click(Button.LEFT);
        break;

      default:
        break;
    }
  } catch (err) {
    console.error(`Action "${action}" failed:`, err);
  }
});

// Normalized coordinates (x, y in [0..1]) -> primary display screen coordinates
ipcMain.on('pointer-move', async (_event, { x, y }) => {
  try {
    const { width, height } = screen.getPrimaryDisplay().bounds;
    // Mirror X to match the flipped webcam preview
    const clampedX = Math.max(0, Math.min(1, 1 - x));
    const clampedY = Math.max(0, Math.min(1, y));
    const targetX = Math.round(clampedX * width);
    const targetY = Math.round(clampedY * height);
    await mouse.setPosition(new Point(targetX, targetY));
  } catch (err) {
    console.error('Pointer move failed:', err);
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});