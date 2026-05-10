# Presentra

**Touchless Gesture-Based Presentation Controller**

Presentra is a lightweight Electron-based desktop application that allows users to control digital presentations (PowerPoint, Google Slides, Canva) using simple hand gestures. Powered by Google's MediaPipe and Nut.js, it eliminates the need for physical clickers by turning your webcam into a high-precision input device.

---

## ✨ Features

- **Precision Tracking:** High-speed hand landmark detection using MediaPipe.
- **Intent-Lock System:** Prevents accidental triggers by requiring a "Steady Palm" hold to unpause.
- **Universal Compatibility:** Controls any app that accepts keyboard arrow inputs.
- **Minimalist HUD:** A transparent, always-on-top interface that stays out of your way during pitches.
- **Privacy Focused:** All AI processing is done locally on your machine via WebAssembly.

---

## 🛠️ Tech Stack

- **Framework:** [Electron](https://www.electronjs.org/) (Desktop Environment)
- **AI Engine:** [MediaPipe Hands](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker) (Computer Vision)
- **Input Automation:** [Nut.js](https://nutjs.dev/) (Native Keyboard Control)
- **Frontend:** HTML5, CSS3 (Glassmorphism UI), JavaScript

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v16 or higher)
- A functional Webcam
- Windows 10/11 (Current build target)

### Installation

1. **Clone the repository:**

```bash
   git clone https://github.com/Jin-ichi/presentra-gesture-app.git
   cd presentra
```

2. **Install dependencies:**

```bash
npm install
```

3. **Run in development mode:**

```bash
npm start
```

4. **Build the installer:**

```bash
npm run dist
```

*Note: On Windows, you may need to run your terminal as Administrator to package the app.*

---

## 🎮 How to Use

| Gesture | Command | Description |
| --- | --- | --- |
| **Fist (✊)** | **Pause** | Instantly stops tracking. Safe for natural hand talking. |
| **Steady Palm (✋)** | **Unpause** | Hold still for 1 second to reactivate the controller. |
| **Swipe Left (⬅️)** | **Previous** | Flick hand left to go to the previous slide. |
| **Swipe Right (➡️)** | **Next** | Flick hand right to go to the next slide. |

---

## 🛡️ Security & Privacy

Presentra does **not** record, save, or transmit your video feed. The webcam stream is processed frame-by-frame in volatile memory and is used solely for landmark coordinate calculation.

---

## 📝 License

Distributed under the MIT License.

---

## 🤝 Contact

**Jean Armas** - Computer Science Student @ Gordon College
**Fher Ian Daniel** - Computer Science Student @ Gordon College