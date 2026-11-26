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
const togglePointerBtn = document.getElementById('toggle-pointer');

const lightCanvas = document.createElement('canvas');
lightCanvas.width = 64;
lightCanvas.height = 48;
const lightCtx = lightCanvas.getContext('2d', { willReadFrequently: true });

// --- CONFIGURATION ---
const CONFIG = {
  holdDelayMs: 1000,
  stabilityThreshold: 0.015,
  actionCooldownMs: 900,
  swipeRatio: 0.4,
  minHandSize: 0.08,
  maxHandSize: 0.55,
  lowLightThreshold: 55,
  lightingCheckIntervalMs: 500,
  // Pointer & Zoom tuning
  pointerSmoothing: 0.35,       // 0..1 (higher = faster response, lower = smoother)
  pinchClickThreshold: 0.045,   // Normalized thumb-to-index distance for click
  zoomDeltaThreshold: 0.06,     // Pinch spread/contract delta for zoom
};

// --- RUNTIME STATE ---
const state = {
  isPaused: false,
  pointerMode: false,
  cooldown: false,
  lastX: null,
  lastPos: { x: 0, y: 0 },
  smoothedPointer: { x: 0.5, y: 0.5 },
  lastPinchDist: null,
  palmHoldStartTime: null,
  lastLightingCheck: 0,
  isLowLight: false,
  distanceStatus: 'ok',
};

// --- HELPERS ---
function setStatus(text, color = 'rgba(255, 255, 255, 0.85)') {
  statusDiv.innerText = text;
  statusDiv.style.color = color;
}

function setPointerMode(enabled) {
  state.pointerMode = enabled;
  state.lastPinchDist = null;
  togglePointerBtn.textContent = enabled ? 'Pointer: ON' : 'Pointer: OFF';
  togglePointerBtn.classList.toggle('active', enabled);
  setStatus(enabled ? 'POINTER MODE' : 'READY', enabled ? '#00ffcc' : 'rgba(255, 255, 255, 0.85)');
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
  return Math.hypot(hand[9].x - hand[0].x, hand[9].y - hand[0].y);
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
  if (now - state.lastLightingCheck < CONFIG.lightingCheckIntervalMs) return;
  state.lastLightingCheck = now;

  try {
    lightCtx.drawImage(sourceImage, 0, 0, lightCanvas.width, lightCanvas.height);
    const { data } = lightCtx.getImageData(0, 0, lightCanvas.width, lightCanvas.height);

    let lumaSum = 0;
    const pixelCount = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      lumaSum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    state.isLowLight = (lumaSum / pixelCount) < CONFIG.lowLightThreshold;
    updateConditionBadge();
  } catch (err) {
    console.warn('Lighting check skipped:', err.message);
  }
}

// Returns an array of boole for [index, middle, ring, pinky] extended states
function getFingerStates(hand) {
  const tips = [8, 12, 16, 20];
  const bases = [5, 9, 13, 17];
  return tips.map((tipIdx, i) => hand[tipIdx].y < hand[bases[i]].y);
}

function getHandState(hand) {
  const [indexUp, middleUp, ringUp, pinkyUp] = getFingerStates(hand);
  const extendedCount = [indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;

  if (extendedCount === 0) return 'fist';
  if (extendedCount >= 4) return 'palm';
  if (indexUp && middleUp && !ringUp && !pinkyUp) return 'victory';
  if (indexUp && !middleUp && !ringUp && !pinkyUp) return 'point_up';
  if (!indexUp && !middleUp && !ringUp && pinkyUp) return 'pinky_up';
  return 'neutral';
}

function triggerAction(action, label = action.toUpperCase()) {
  if (state.cooldown) return;
  state.cooldown = true;
  setStatus(`SENT: ${label}`, '#00ffcc');
  vizContainer.classList.add('active-swipe');

  ipcRenderer.send('gesture-action', action);

  setTimeout(() => {
    state.cooldown = false;
    if (!state.isPaused) {
      setStatus(state.pointerMode ? 'POINTER MODE' : 'READY');
    }
    vizContainer.classList.remove('active-swipe');
  }, CONFIG.actionCooldownMs);
}

// --- GESTURE HANDLERS ---
function handlePauseAndUnpause(gestureState, currentPos) {
  if (gestureState === 'fist' && !state.isPaused) {
    state.isPaused = true;
    state.palmHoldStartTime = null;
    setStatus('PAUSED (Fist)', '#ff4444');
    vizContainer.style.borderColor = '#ff4444';
    return true;
  }

  if (gestureState === 'palm' && state.isPaused) {
    const movement = Math.hypot(currentPos.x - state.lastPos.x, currentPos.y - state.lastPos.y);

    if (movement < CONFIG.stabilityThreshold) {
      if (!state.palmHoldStartTime) state.palmHoldStartTime = Date.now();
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
    return true;
  }

  state.palmHoldStartTime = null;
  return state.isPaused;
}

function handlePointerAndZoom(hand, gestureState) {
  const indexTip = hand[8];
  const thumbTip = hand[4];
  const pinchDist = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);

  // Victory gesture toggles pointer mode
  if (gestureState === 'victory' && !state.cooldown) {
    state.cooldown = true;
    setPointerMode(!state.pointerMode);
    setTimeout(() => { state.cooldown = false; }, CONFIG.actionCooldownMs);
    return true;
  }

  if (state.pointerMode) {
    state.smoothedPointer.x += (indexTip.x - state.smoothedPointer.x) * CONFIG.pointerSmoothing;
    state.smoothedPointer.y += (indexTip.y - state.smoothedPointer.y) * CONFIG.pointerSmoothing;
    ipcRenderer.send('pointer-move', state.smoothedPointer);

    if (pinchDist < CONFIG.pinchClickThreshold && !state.cooldown) {
      triggerAction('pointer_click', 'CLICK');
    }
    return true;
  }

  // Zoom in/out via thumb-to-index spread or pinch
  if (state.lastPinchDist !== null) {
    const delta = pinchDist - state.lastPinchDist;
    if (delta > CONFIG.zoomDeltaThreshold) {
      triggerAction('zoom_in', 'ZOOM IN');
      state.lastPinchDist = pinchDist;
      return true;
    }
    if (delta < -CONFIG.zoomDeltaThreshold) {
      triggerAction('zoom_out', 'ZOOM OUT');
      state.lastPinchDist = pinchDist;
      return true;
    }
  }
  state.lastPinchDist = pinchDist;
  return false;
}

function handleMediaAndSwipe(hand, gestureState, currentPos) {
  if (gestureState === 'point_up') {
    triggerAction('volume_up', 'VOL UP');
    return;
  }
  if (gestureState === 'pinky_up') {
    triggerAction('volume_down', 'VOL DOWN');
    return;
  }

  // Swipe left/right on open palm / neutral hand
  if (gestureState === 'palm' || gestureState === 'neutral') {
    const handWidth = Math.hypot(hand[5].x - hand[17].x, hand[5].y - hand[17].y);
    const dynamicThreshold = handWidth * CONFIG.swipeRatio;

    if (state.lastX !== null && !state.cooldown) {
      const deltaX = currentPos.x - state.lastX;
      if (deltaX > dynamicThreshold) {
        triggerAction('next_slide', 'RIGHT');
      } else if (deltaX < -dynamicThreshold) {
        triggerAction('prev_slide', 'LEFT');
      }
    }
    state.lastX = currentPos.x;
  } else {
    state.lastX = null;
  }
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

    const pausedOrHandled = handlePauseAndUnpause(gestureState, currentPos);
    if (!pausedOrHandled) {
      if (!checkDistanceLimit(hand)) {
        state.lastX = null;
        state.lastPinchDist = null;
      } else {
        const handledPointerOrZoom = handlePointerAndZoom(hand, gestureState);
        if (!handledPointerOrZoom) {
          handleMediaAndSwipe(hand, gestureState, currentPos);
        }
      }
    }

    state.lastPos = currentPos;
  } else {
    state.distanceStatus = 'ok';
    state.lastPinchDist = null;
    updateConditionBadge();
    setStatus(state.isPaused ? 'PAUSED' : (state.pointerMode ? 'POINTER MODE' : 'Waiting...'));
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

const hands = new Hands({ locateFile: resolveMediaPipeFile });
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

togglePointerBtn.addEventListener('click', () => {
  setPointerMode(!state.pointerMode);
});

document.querySelectorAll('[data-action]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.getAttribute('data-action');
    ipcRenderer.send('gesture-action', action);
    setStatus(`SENT: ${action.toUpperCase()}`, '#00ffcc');
  });
});

document.getElementById('close-app').addEventListener('click', () => {
  window.close();
});