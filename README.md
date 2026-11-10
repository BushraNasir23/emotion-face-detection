# Emotion-Controlled Adaptive UI Game

A browser-based project for the **Advanced Chapters in Human-Computer Interaction** assignment.

It uses webcam input to detect:
- face location,
- facial landmarks (key points),
- facial expressions (emotions) in real time,

and adapts both the avatar and interface based on detected emotion.

## Implemented Requirements

- Real-time webcam feed in the page.
- Real-time avatar shown in parallel with user image.
- Emotion recognition for 6 required emotions:
  - anger,
  - fear,
  - happiness,
  - sadness,
  - surprise,
  - disgust.
- UI adaptation for each emotion (background/theme changes).
- Avatar changes expression and color per emotion.
- Smooth transitions via CSS transitions.
- **Theme cross-fade:** full-screen backdrop fades out, swaps palette, then fades in (less jarring than an instant cut).
- **Adaptive background sound:** Web Audio–based ambient layers per emotion (no external files), started after **Start Camera** (browser autoplay rules). Use **Sound: On / Off** in the header to mute.
- Emotion-triggered changes only when confidence is at least 80%.
- A simple mini-game ("mimic target emotion") for interactive evaluation.

## Technology Choice (Best-Practice Justification)

- **Vite**: fast dev server and clean modern build setup.
- **face-api.js (TensorFlow.js in browser)**:
  - robust real-time face detection,
  - face landmarks (key points),
  - expression probabilities with direct emotion classes.
- **Vanilla JS + CSS**:
  - minimal complexity,
  - easy to understand and present in class,
  - no framework lock-in.

This stack is practical for this assignment because it is browser-native, easy to demo, and directly supports the required emotional classes with confidence values.

## Run

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite, allow camera access, and click:
1. **Start Camera**
2. **Start Game**

## Notes

- Model files are loaded from a CDN (`@vladmandic/face-api/model`) at runtime.
- Good lighting and frontal face position significantly improve confidence and stability.
