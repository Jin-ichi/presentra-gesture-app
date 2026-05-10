const { ipcRenderer } = require('electron');
const { Hands } = require('@mediapipe/hands');
const { Camera } = require('@mediapipe/camera_utils');
const path = require('path');

const videoElement = document.getElementsByClassName('input_video')[0];
const canvasElement = document.getElementsByClassName('output_canvas')[0];
const canvasCtx = canvasElement.getContext('2d');
const statusDiv = document.getElementById('status');
const vizContainer = document.getElementById('viz-container');

let isPaused = false;
let lastX = null;
let cooldown = false;
let palmHoldStartTime = null;
const HOLD_DELAY = 1000; // 1 second hold to unpause
const STABILITY_THRESHOLD = 0.015; // How much movement is allowed during the hold
let lastPos = { x: 0, y: 0 };

function getHandState(hand) {
    const tips = [8, 12, 16, 20];
    const bases = [5, 9, 13, 17];
    let extendedFingers = 0;
    for (let i = 0; i < tips.length; i++) {
        if (hand[tips[i]].y < hand[bases[i]].y) extendedFingers++;
    }
    if (extendedFingers <= 1) return 'fist';
    if (extendedFingers >= 4) return 'palm'; // Require 4 fingers for a clear palm
    return 'neutral';
}

function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const hand = results.multiHandLandmarks[0];
        const state = getHandState(hand);
        const currentPos = { x: hand[9].x, y: hand[9].y };

        // --- PAUSE LOGIC (Instant) ---
        if (state === 'fist' && !isPaused) {
            isPaused = true;
            palmHoldStartTime = null; // Reset hold
            statusDiv.innerText = "PAUSED (Fist)";
            statusDiv.style.color = "#ff4444";
            vizContainer.style.borderColor = "#ff4444";
        } 
        
        // --- UNPAUSE LOGIC (Requires Steady Hold) ---
        else if (state === 'palm' && isPaused) {
            // Calculate how much the hand moved since the last frame
            const movement = Math.sqrt(
                Math.pow(currentPos.x - lastPos.x, 2) + 
                Math.pow(currentPos.y - lastPos.y, 2)
            );

            if (movement < STABILITY_THRESHOLD) {
                if (!palmHoldStartTime) {
                    palmHoldStartTime = Date.now();
                }

                const elapsed = Date.now() - palmHoldStartTime;
                const progress = Math.min((elapsed / HOLD_DELAY) * 100, 100);
                
                statusDiv.innerText = `HOLDING... ${Math.floor(progress)}%`;
                statusDiv.style.color = "#ffcc00";

                if (elapsed >= HOLD_DELAY) {
                    isPaused = false;
                    palmHoldStartTime = null;
                    statusDiv.innerText = "READY (Active)";
                    statusDiv.style.color = "#00ffcc";
                    vizContainer.style.borderColor = "#333";
                }
            } else {
                // Hand is moving too much (waving), reset the timer
                palmHoldStartTime = null;
                statusDiv.innerText = "PAUSED (Keep Steady)";
                statusDiv.style.color = "#ff4444";
            }
        } else {
            // Not a fist or a steady palm
            palmHoldStartTime = null;
        }

        // --- SWIPE LOGIC ---
        if (!isPaused) {
            const currentX = hand[9].x;
            const dx = hand[5].x - hand[17].x;
            const dy = hand[5].y - hand[17].y;
            const handScale = Math.sqrt(dx * dx + dy * dy);
            const dynamicThreshold = handScale * 0.4;

            if (lastX !== null && !cooldown) {
                const deltaX = currentX - lastX;
                if (deltaX > dynamicThreshold) triggerSwipe('right');
                else if (deltaX < -dynamicThreshold) triggerSwipe('left');
            }
            lastX = currentX;
        }
        
        lastPos = currentPos; // Store position for stability check next frame
    } else {
        statusDiv.innerText = isPaused ? "PAUSED" : "Waiting...";
        palmHoldStartTime = null;
        lastX = null;
    }
    canvasCtx.restore();
}

function triggerSwipe(dir) {
  cooldown = true;
  
  // Visual Feedback
  statusDiv.innerText = `SENT: ${dir.toUpperCase()}`;
  vizContainer.classList.add('active-swipe');
  
  ipcRenderer.send('gesture-swipe', dir);
  
  setTimeout(() => { 
    cooldown = false; 
    statusDiv.innerText = "READY";
    vizContainer.classList.remove('active-swipe');
  }, 1000); 
}

const hands = new Hands({
  locateFile: (file) => {
    // This points to the folder created by your npm install
    return path.join(__dirname, 'node_modules/@mediapipe/hands', file);
  }
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

hands.onResults(onResults);

const camera = new Camera(videoElement, {
  onFrame: async () => {
    await hands.send({image: videoElement});
  },
  width: 640,
  height: 480
});
camera.start();

document.getElementById('close-app').addEventListener('click', () => {
  // Direct way to close the current window
  window.close();
});