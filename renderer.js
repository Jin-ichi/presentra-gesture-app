const { ipcRenderer } = require('electron');
const { Hands } = require('@mediapipe/hands');
const { Camera } = require('@mediapipe/camera_utils');
const fs = require('fs');
const path = require('path');

const STORAGE_KEY = 'presentra_settings_v1';

// --- DOM ELEMENTS ---
const appContainer = document.getElementById('app-container');
const hudView = document.getElementById('hud-view');
const tutorialPanel = document.getElementById('tutorial-panel');
const settingsPanel = document.getElementById('settings-panel');
const openTutorialBtn = document.getElementById('open-tutorial');
const openSettingsBtn = document.getElementById('open-settings');

const videoElement = document.getElementsByClassName('input_video')[0];
const canvasElement = document.getElementsByClassName('output_canvas')[0];
const canvasCtx = canvasElement.getContext('2d');
const statusDiv = document.getElementById('status');
const vizContainer = document.getElementById('viz-container');
const conditionBadge = document.getElementById('condition-badge');
const togglePointerBtn = document.getElementById('toggle-pointer');

// Settings controls
const minHandInput = document.getElementById('cfg-min-hand');
const maxHandInput = document.getElementById('cfg-max-hand');
const lowLightInput = document.getElementById('cfg-low-light');
const valMinHand = document.getElementById('val-min-hand');
const valMaxHand = document.getElementById('val-max-hand');
const valLowLight = document.getElementById('val-low-light');

const enableSwipeCheckbox = document.getElementById('cfg-enable-swipe');
const enableZoomCheckbox = document.getElementById('cfg-enable-zoom');
const enablePointerCheckbox = document.getElementById('cfg-enable-pointer');
const enableMediaCheckbox = document.getElementById('cfg-enable-media');

const mappingListEl = document.getElementById('gesture-mapping-list');
const mappingForm = document.getElementById('gesture-mapping-form');
const editMappingIndexInput = document.getElementById('edit-mapping-index');
const mapGestureSelect = document.getElementById('map-gesture-key');
const mapActionSelect = document.getElementById('map-action-value');
const saveMappingBtn = document.getElementById('save-mapping-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const resetSettingsBtn = document.getElementById('reset-settings-btn');

const lightCanvas = document.createElement('canvas');
lightCanvas.width = 64;
lightCanvas.height = 48;
const lightCtx = lightCanvas.getContext('2d', { willReadFrequently: true });

// --- DEFAULT CONFIGURATION ---
const DEFAULT_CONFIG = {
  holdDelayMs: 1000,
  stabilityThreshold: 0.015,
  actionCooldownMs: 900,
  swipeRatio: 0.4,
  minHandSize: 0.08,
  maxHandSize: 0.55,
  lowLightThreshold: 55,
  lightingCheckIntervalMs: 500,
  pointerSmoothing: 0.35,
  pinchClickThreshold: 0.045,
  zoomDeltaThreshold: 0.06,
  features: {
    swipe: true,
    zoom: true,
    pointer: true,
    media: true,
  },
  mappings: [
    { gesture: 'swipe_left', action: 'prev_slide' },
    { gesture: 'swipe_right', action: 'next_slide' },
    { gesture: 'zoom_in', action: 'zoom_in' },
    { gesture: 'zoom_out', action: 'zoom_out' },
    { gesture: 'point_up', action: 'volume_up' },
    { gesture: 'pinky_up', action: 'volume_down' },
  ],
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_CONFIG);
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      features: { ...DEFAULT_CONFIG.features, ...(parsed.features || {}) },
      mappings: Array.isArray(parsed.mappings) ? parsed.mappings : structuredClone(DEFAULT_CONFIG.mappings),
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

let CONFIG = loadSettings();

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(CONFIG));
}

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

// --- UI DRAWER & SETTINGS BINDINGS ---
const WINDOW_SIZES = {
  hud: { width: 260, height: 300 },
  drawer: { width: 360, height: 440 },
};

function openDrawer(drawerId) {
  const isTutorial = drawerId === 'tutorial-panel';
  tutorialPanel.classList.toggle('hidden', !isTutorial);
  settingsPanel.classList.toggle('hidden', isTutorial);
  hudView.classList.add('hidden');
  appContainer.classList.add('expanded');
  ipcRenderer.send('resize-window', WINDOW_SIZES.drawer);

  if (!isTutorial) {
    renderMappings();
  }
}

function closeAllDrawers() {
  tutorialPanel.classList.add('hidden');
  settingsPanel.classList.add('hidden');
  hudView.classList.remove('hidden');
  appContainer.classList.remove('expanded');
  ipcRenderer.send('resize-window', WINDOW_SIZES.hud);
  resetMappingForm();
}

function getMappedAction(gestureName, fallbackAction = null) {
  const match = CONFIG.mappings.find((m) => m.gesture === gestureName);
  if (!match) return fallbackAction;
  if (match.action === 'none') return null;
  return match.action;
}

function syncSettingsUI() {
  minHandInput.value = CONFIG.minHandSize;
  maxHandInput.value = CONFIG.maxHandSize;
  lowLightInput.value = CONFIG.lowLightThreshold;

  valMinHand.textContent = Number(CONFIG.minHandSize).toFixed(2);
  valMaxHand.textContent = Number(CONFIG.maxHandSize).toFixed(2);
  valLowLight.textContent = CONFIG.lowLightThreshold;

  enableSwipeCheckbox.checked = CONFIG.features.swipe;
  enableZoomCheckbox.checked = CONFIG.features.zoom;
  enablePointerCheckbox.checked = CONFIG.features.pointer;
  enableMediaCheckbox.checked = CONFIG.features.media;

  renderMappings();
}

function renderMappings() {
  mappingListEl.innerHTML = '';
  CONFIG.mappings.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'mapping-item';
    row.innerHTML = `
      <span><strong>${item.gesture}</strong> → ${item.action}</span>
      <div class="mapping-actions">
        <button type="button" class="small-btn" data-edit="${idx}">Edit</button>
        <button type="button" class="small-btn" data-delete="${idx}">×</button>
      </div>
    `;
    mappingListEl.appendChild(row);
  });

  mappingListEl.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-edit'));
      const entry = CONFIG.mappings[idx];
      if (!entry) return;
      editMappingIndexInput.value = String(idx);
      mapGestureSelect.value = entry.gesture;
      mapActionSelect.value = entry.action;
      saveMappingBtn.textContent = 'Update Mapping';
      cancelEditBtn.classList.remove('hidden');
    });
  });

  mappingListEl.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-delete'));
      CONFIG.mappings.splice(idx, 1);
      saveSettings();
      renderMappings();
    });
  });
}

function resetMappingForm() {
  editMappingIndexInput.value = '-1';
  saveMappingBtn.textContent = 'Add Mapping';
  cancelEditBtn.classList.add('hidden');
}

mappingForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const gesture = mapGestureSelect.value;
  const action = mapActionSelect.value;
  const editIdx = Number(editMappingIndexInput.value);

  if (editIdx >= 0 && CONFIG.mappings[editIdx]) {
    CONFIG.mappings[editIdx] = { gesture, action };
  } else {
    const existingIdx = CONFIG.mappings.findIndex((m) => m.gesture === gesture);
    if (existingIdx >= 0) {
      CONFIG.mappings[existingIdx].action = action;
    } else {
      CONFIG.mappings.push({ gesture, action });
    }
  }

  saveSettings();
  renderMappings();
  resetMappingForm();
});

cancelEditBtn.addEventListener('click', resetMappingForm);

minHandInput.addEventListener('input', () => {
  CONFIG.minHandSize = Number(minHandInput.value);
  valMinHand.textContent = CONFIG.minHandSize.toFixed(2);
  saveSettings();
});

maxHandInput.addEventListener('input', () => {
  CONFIG.maxHandSize = Number(maxHandInput.value);
  valMaxHand.textContent = CONFIG.maxHandSize.toFixed(2);
  saveSettings();
});

lowLightInput.addEventListener('input', () => {
  CONFIG.lowLightThreshold = Number(lowLightInput.value);
  valLowLight.textContent = CONFIG.lowLightThreshold;
  saveSettings();
});

enableSwipeCheckbox.addEventListener('change', () => {
  CONFIG.features.swipe = enableSwipeCheckbox.checked;
  saveSettings();
});

enableZoomCheckbox.addEventListener('change', () => {
  CONFIG.features.zoom = enableZoomCheckbox.checked;
  saveSettings();
});

enablePointerCheckbox.addEventListener('change', () => {
  CONFIG.features.pointer = enablePointerCheckbox.checked;
  if (!CONFIG.features.pointer && state.pointerMode) {
    setPointerMode(false);
  }
  saveSettings();
});

enableMediaCheckbox.addEventListener('change', () => {
  CONFIG.features.media = enableMediaCheckbox.checked;
  saveSettings();
});

resetSettingsBtn.addEventListener('click', () => {
  CONFIG = structuredClone(DEFAULT_CONFIG);
  saveSettings();
  syncSettingsUI();
  resetMappingForm();
});

openTutorialBtn.addEventListener('click', () => openDrawer('tutorial-panel'));
openSettingsBtn.addEventListener('click', () => openDrawer('settings-panel'));
document.querySelectorAll('.close-drawer').forEach((btn) => {
  btn.addEventListener('click', closeAllDrawers);
});

// --- HUD & GESTURE LOGIC ---
function setStatus(text, color = 'rgba(255, 255, 255, 0.85)') {
  statusDiv.innerText = text;
  statusDiv.style.color = color;
}

function setPointerMode(enabled) {
  if (enabled && !CONFIG.features.pointer) return;
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
  if (!action || state.cooldown) return;
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

  if (CONFIG.features.pointer && gestureState === 'victory' && !state.cooldown) {
    const victoryAction = getMappedAction('victory', null);
    if (victoryAction) {
      triggerAction(victoryAction, 'VICTORY');
    } else {
      state.cooldown = true;
      setPointerMode(!state.pointerMode);
      setTimeout(() => { state.cooldown = false; }, CONFIG.actionCooldownMs);
    }
    return true;
  }

  if (CONFIG.features.pointer && state.pointerMode) {
    state.smoothedPointer.x += (indexTip.x - state.smoothedPointer.x) * CONFIG.pointerSmoothing;
    state.smoothedPointer.y += (indexTip.y - state.smoothedPointer.y) * CONFIG.pointerSmoothing;
    ipcRenderer.send('pointer-move', state.smoothedPointer);

    if (pinchDist < CONFIG.pinchClickThreshold && !state.cooldown) {
      triggerAction('pointer_click', 'CLICK');
    }
    return true;
  }

  if (CONFIG.features.zoom && state.lastPinchDist !== null) {
    const delta = pinchDist - state.lastPinchDist;
    if (delta > CONFIG.zoomDeltaThreshold) {
      triggerAction(getMappedAction('zoom_in', 'zoom_in'), 'ZOOM IN');
      state.lastPinchDist = pinchDist;
      return true;
    }
    if (delta < -CONFIG.zoomDeltaThreshold) {
      triggerAction(getMappedAction('zoom_out', 'zoom_out'), 'ZOOM OUT');
      state.lastPinchDist = pinchDist;
      return true;
    }
  }
  state.lastPinchDist = pinchDist;
  return false;
}

function handleMediaAndSwipe(hand, gestureState, currentPos) {
  if (CONFIG.features.media) {
    if (gestureState === 'point_up') {
      triggerAction(getMappedAction('point_up', 'volume_up'), 'VOL UP');
      return;
    }
    if (gestureState === 'pinky_up') {
      triggerAction(getMappedAction('pinky_up', 'volume_down'), 'VOL DOWN');
      return;
    }
  }

  if (CONFIG.features.swipe && (gestureState === 'palm' || gestureState === 'neutral')) {
    const handWidth = Math.hypot(hand[5].x - hand[17].x, hand[5].y - hand[17].y);
    const dynamicThreshold = handWidth * CONFIG.swipeRatio;

    if (state.lastX !== null && !state.cooldown) {
      const deltaX = currentPos.x - state.lastX;
      if (deltaX > dynamicThreshold) {
        triggerAction(getMappedAction('swipe_right', 'next_slide'), 'RIGHT');
      } else if (deltaX < -dynamicThreshold) {
        triggerAction(getMappedAction('swipe_left', 'prev_slide'), 'LEFT');
      }
    }
    state.lastX = currentPos.x;
  } else {
    state.lastX = null;
  }
}

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

syncSettingsUI();

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