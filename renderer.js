const { ipcRenderer } = require('electron');
const { Hands } = require('@mediapipe/hands');
const { Camera } = require('@mediapipe/camera_utils');
const fs = require('fs');
const path = require('path');

// --- DOM ELEMENTS ---
const videoElement = document.getElementsByClassName('input_video')[0];
const canvasElement = document.getElementsByClassName('output_canvas')[0];
const canvasCtx = canvasElement.getContext('2d');
const statusDiv = document.getElementById('status');
const vizContainer = document.getElementById('viz-container');
const conditionBadge = document.getElementById('condition-badge');

// Offscreen canvas for lightweight lighting analysis
const lightCanvas = document.createElement('canvas');
lightCanvas.width = 64;
lightCanvas.height = 48;
const lightCtx = lightCanvas.getContext('2d', { willReadFrequently: true });

// --- CONFIGURATION ---
const CONFIG = {
  holdDelayMs: 1000,          // Steady palm hold duration to unpause
  stabilityThreshold: 0.015,  // Max movement allowed while holding palm
  swipeCooldownMs: 1000,      // Cooldown between swipe triggers
  swipeRatio: 0.4,            // Swipe delta relative to hand width
  // Normalized hand size (wrist landmark 0 to middle MCP landmark 9)
  minHandSize: 0.08,          // Too far if smaller
  maxHandSize: 0.55,          // Too close if larger
  // Lighting (average luminance 0 - 255)
  lowLightThreshold: 55,
  lightingCheckIntervalMs: 500,
};

// --- RUNTIME STATE ---
const state = {
  isPaused: false,
  cooldown: false,
  lastX: null,
  lastPos: { x: 0, y: 0 },
  palmHoldStartTime: null,
  lastLightingCheck: 0,
  isLowLight: false,
  distanceStatus: 'ok', // 'ok' | 'too_far' | 'too_close'
};

// --- HELPERS ---
function setStatus(text, color = 'rgba(255, 255, 255, 0.85)') {
  statusDiv.innerText = text;
  statusDiv.style.color = color;
}

function updateConditionBadge() {
  const warnings = [];
  if (state.isLowLight) warnings.push('LOW LIGHT');
  if (state.distanceStatus === 'too_far') warnings.push('MOVE CLOSER');
  if (state.distanceStatus === 'too_close') warnings.push('MOVE BACK');

  if (warnings.length === 0) {
    conditionBadge.textContent = '';
    conditionBadge.classList.add('hidden');
  } else {
    conditionBadge.textContent = warnings.join(' • ');
    conditionBadge.classList.remove('hidden');
  }
}

function getHandSize(hand) {
  const dx = hand[9].x - hand[0].x;
  const dy = hand[9].y - hand[0].y;
  return Math.hypot(dx, dy);
}

function checkDistanceLimit(hand) {
  const handSize = getHandSize(hand);
  if (handSize < CONFIG.minHandSize) {
    state.distanceStatus = 'too_far';
  } else if (handSize > CONFIG.maxHandSize) {
    state.distanceStatus = 'too_close';
  } else {
    state.distanceStatus = 'ok';
  }
  updateConditionBadge();
  return state.distanceStatus === 'ok';
}

function checkLightingConditions(sourceImage) {
  const now = Date.now();
  if (now - state.lastLightingCheck < CONFIG.lightingCheckIntervalMs) {
    return;
  }
  state.lastLightingCheck = now;

  try {
    lightCtx.drawImage(sourceImage, 0, 0, lightCanvas.width, lightCanvas.height);
    const { data } = lightCtx.getImageData(0, 0, lightCanvas.width, lightCanvas.height);

    let lumaSum = 0;
    const pixelCount = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      // Rec. 601 perceived brightness
      lumaSum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    const avgLuma = lumaSum / pixelCount;
    state.isLowLight = avgLuma < CONFIG.lowLightThreshold;
    updateConditionBadge();
  } catch (err) {
    console.warn('Lighting check skipped:', err.message);
  }
}

function getHandState(hand) {
  const tips = [8, 12, 16, 20];
  const bases = [5, 9, 13, 17];
  let extendedFingers = 0;

  for (let i = 0; i < tips.length; i++) {
    if (hand[tips[i]].y < hand[bases[i]].y) {
      extendedFingers++;
    }
  }

  if (extendedFingers <= 1) return 'fist';
  if (extendedFingers >= 4) return 'palm';
  return 'neutral';
}

function triggerSwipe(direction) {
  state.cooldown = true;
  setStatus(`SENT: ${direction.toUpperCase()}`, '#00ffcc');
  vizContainer.classList.add('active-swipe');

  ipcRenderer.send('gesture-swipe', direction);

  setTimeout(() => {
    state.cooldown = false;
    if (!state.isPaused) {
      setStatus('READY');
    }
    vizContainer.classList.remove('active-swipe');
  }, CONFIG.swipeCooldownMs);
}

// --- GESTURE HANDLERS ---
function handlePauseAndUnpause(hand, gestureState, currentPos) {
  if (gestureState === 'fist' && !state.isPaused) {
    state.isPaused = true;
    state.palmHoldStartTime = null;
    setStatus('PAUSED (Fist)', '#ff4444');
    vizContainer.style.borderColor = '#ff4444';
    return;
  }

  if (gestureState === 'palm' && state.isPaused) {
    const movement = Math.hypot(currentPos.x - state.lastPos.x, currentPos.y - state.lastPos.y);

    if (movement < CONFIG.stabilityThreshold) {
      if (!state.palmHoldStartTime) {
        state.palmHoldStartTime = Date.now();
      }

      const elapsed = Date.now() - state.palmHoldStartTime;
      const progress = Math.min((elapsed / CONFIG.holdDelayMs) * 100, 100);
      setStatus(`HOLDING... ${Math.floor(progress)}%`, '#ffcc00');

      if (elapsed >= CONFIG.holdDelayMs) {
        state.isPaused = false;
        state.palmHoldStartTime = null;
        setStatus('READY (Active)', '#00ffcc');
        vizContainer.style.borderColor = '#333';
      }
    } else {
      state.palmHoldStartTime = null;
      setStatus('PAUSED (Keep Steady)', '#ff4444');
    }
    return;
  }

  state.palmHoldStartTime = null;
}

function handleSwipe(hand, currentPos) {
  if (state.isPaused) return;

  const isWithinDistance = checkDistanceLimit(hand);
  if (!isWithinDistance) {
    state.lastX = null;
    return;
  }

  const dx = hand[5].x - hand[17].x;
  const dy = hand[5].y - hand[17].y;
  const handWidth = Math.hypot(dx, dy);
  const dynamicThreshold = handWidth * CONFIG.swipeRatio;

  if (state.lastX !== null && !state.cooldown) {
    const deltaX = currentPos.x - state.lastX;
    if (deltaX > dynamicThreshold) {
      triggerSwipe('right');
    } else if (deltaX < -dynamicThreshold) {
      triggerSwipe('left');
    }
  }

  state.lastX = currentPos.x;
}

// --- MEDIAPIPE CALLBACK ---
function onResults(results) {
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  if (results.image) {
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    checkLightingConditions(results.image);
  }

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const hand = results.multiHandLandmarks[0];
    const gestureState = getHandState(hand);
    const currentPos = { x: hand[9].x, y: hand[9].y };

    handlePauseAndUnpause(hand, gestureState, currentPos);
    handleSwipe(hand, currentPos);

    state.lastPos = currentPos;
  } else {
    state.distanceStatus = 'ok';
    updateConditionBadge();
    setStatus(state.isPaused ? 'PAUSED' : 'Waiting...');
    state.palmHoldStartTime = null;
    state.lastX = null;
  }

  canvasCtx.restore();
}

// --- INITIALIZATION ---
function resolveMediaPipeFile(file) {
  const packagedPath = process.resourcesPath
    ? path.join(process.resourcesPath, 'mediapipe-hands', file)
    : null;
  if (packagedPath && fs.existsSync(packagedPath)) {
    return packagedPath;
  }
  return path.join(__dirname, 'node_modules/@mediapipe/hands', file);
}

const hands = new Hands({
  locateFile: resolveMediaPipeFile,
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
});

hands.onResults(onResults);

const camera = new Camera(videoElement, {
  onFrame: async () => {
    await hands.send({ image: videoElement });
  },
  width: 640,
  height: 480,
});

camera.start();

document.getElementById('close-app').addEventListener('click', () => {
  window.close();
});