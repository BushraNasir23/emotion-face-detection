import {
  FaceLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EmotionAmbientAudio } from "./emotionAudio.js";

/** CONSTANTS & DOM */
const CONFIDENCE_THRESHOLD = 0.8;
const STABLE_FRAMES_REQUIRED = 5;
const GAME_DURATION_SECONDS = 60;
const LANDMARKER_TASK_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const AVATAR_MODEL_URL = "https://assets.codepen.io/9177687/raccoon_head.glb";

const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const startBtn = document.getElementById("startBtn");
const statusEl = document.getElementById("status");
const avatarContainer = document.getElementById("avatarContainer");
const emojiFace = document.getElementById("emojiFace");
const avatarLabel = document.getElementById("avatarLabel");
const confidenceEl = document.getElementById("confidence");
const targetEmotionEl = document.getElementById("targetEmotion");
const scoreEl = document.getElementById("score");
const timeLeftEl = document.getElementById("timeLeft");
const startGameBtn = document.getElementById("startGameBtn");
const themeBackdrop = document.getElementById("themeBackdrop");
const muteAudioBtn = document.getElementById("muteAudioBtn");

/** STATE */
let faceLandmarker;
let scene, camera, renderer, avatarMesh;
const ambient = new EmotionAmbientAudio();

let lastStableEmotion = "neutral";
let stableCounter = 0;
let lastCandidate = "neutral";
let cameraReady = false;
let animationHandle = null;
let lastVideoTime = -1;

let gameRunning = false;
let gameScore = 0;
let gameTarget = "happy";
let gameTimer = GAME_DURATION_SECONDS;
let gameInterval = null;
let holdCounter = 0;

const emotionPool = ["happy", "sad", "angry", "fearful", "surprised", "disgusted"];

const emotionToEmoji = {
  happy: "😄",
  sad: "😢",
  angry: "😠",
  fearful: "😨",
  surprised: "😲",
  disgusted: "🤢",
  neutral: "🙂"
};

/** 3D SETUP */
function initThreeJS() {
  scene = new THREE.Scene();
  const width = avatarContainer.clientWidth || 300;
  const height = 240;

  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  camera.position.set(0, 0, 1.5);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);
  avatarContainer.appendChild(renderer.domElement);

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
  directionalLight.position.set(0, 1, 2);
  scene.add(directionalLight);
}

async function loadAvatar() {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(AVATAR_MODEL_URL, (gltf) => {
      avatarMesh = gltf.scene;
      avatarMesh.position.y = -0.5;
      avatarMesh.scale.set(1.5, 1.5, 1.5);
      scene.add(avatarMesh);
      resolve();
    }, undefined, reject);
  });
}

/** MEDIAPIPE SETUP */
async function initMediaPipe() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: LANDMARKER_TASK_URL,
      delegate: "GPU",
    },
    outputFaceBlendshapes: true,
    runningMode: "VIDEO",
    numFaces: 1,
  });
}

/** LOGIC */
function setStatus(text) {
  statusEl.textContent = text;
}

function applyTheme(emotion, options = {}) {
  const immediate = options.immediate === true;
  const cls = `theme-${emotion}`;

  const applyClassesAndSound = () => {
    document.body.className = cls;
    ambient.syncEmotion(emotion);

    // Adapt Avatar Lighting based on theme accent
    if (avatarMesh) {
      const color = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--accent'));
      if (!scene.getObjectByName("emotionLight")) {
        const light = new THREE.PointLight(0xffffff, 2, 5);
        light.name = "emotionLight";
        light.position.set(0, 0, 1);
        scene.add(light);
      }
      const emotionLight = scene.getObjectByName("emotionLight");
      if (emotionLight) emotionLight.color.set(color);
    }
  };

  if (immediate || !themeBackdrop) {
    applyClassesAndSound();
    return;
  }

  themeBackdrop.style.opacity = "0";
  setTimeout(() => {
    applyClassesAndSound();
    themeBackdrop.style.opacity = "1";
  }, 450);
}

function detectEmotionFromBlendshapes(blendshapes) {
  if (!blendshapes || blendshapes.length === 0) return { emotion: "neutral", score: 0 };

  const weights = {};
  blendshapes[0].categories.forEach((c) => {
    weights[c.categoryName] = c.score;
  });

  /**
   * Sensitivity Calibration:
   * We use Math.max for key indicators to ensure the signal isn't lost in averages.
   * We also apply multipliers to balance emotions that naturally have lower weights.
   */
  const rawScores = {
    happy: Math.max(weights.mouthSmileLeft, weights.mouthSmileRight) * 1.2,

    sad: Math.max(
      (weights.mouthFrownLeft + weights.mouthFrownRight) / 2,
      weights.browInnerUp,
      (weights.browDownLeft + weights.browDownRight) / 2
    ) * 1.4,

    angry: Math.max(
      (weights.browDownLeft + weights.browDownRight) / 2,
      (weights.mouthPressLeft + weights.mouthPressRight) / 2,
      (weights.noseSneerLeft + weights.noseSneerRight) / 2
    ) * 1.5,

    surprised: Math.max(
      (weights.eyeWideLeft + weights.eyeWideRight) / 2,
      weights.jawOpen,
      (weights.browOuterUpLeft + weights.browOuterUpRight) / 2
    ) * 1.3,

    fearful: Math.max(
      weights.browInnerUp,
      (weights.eyeWideLeft + weights.eyeWideRight) / 2
    ) * 1.4,

    disgusted: Math.max(
      (weights.noseSneerLeft + weights.noseSneerRight) / 2,
      (weights.mouthUpperUpLeft + weights.mouthUpperUpRight) / 2,
      (weights.mouthRollLower + weights.mouthRollUpper) / 2
    ) * 1.6
  };

  let top = { emotion: "neutral", score: 0 };

  for (const [e, s] of Object.entries(rawScores)) {
    // Cap at 1.0
    const finalScore = Math.min(s, 1.0);
    if (finalScore > top.score) {
      top = { emotion: e, score: finalScore };
    }
  }

  // If no emotion is strong enough (threshold 0.3 for feedback), return neutral
  if (top.score < 0.3) {
    return { emotion: "neutral", score: 1.0 };
  }

  return top;
}



function updateAvatar(blendshapes) {
  if (!blendshapes || blendshapes.length === 0) return;

  const weights = blendshapes[0].categories;

  // Update 3D Avatar
  if (avatarMesh) {
    avatarMesh.traverse((child) => {
      if (child.isMesh && child.morphTargetInfluences) {
        weights.forEach((w) => {
          const index = child.morphTargetDictionary[w.categoryName];
          if (index !== undefined) {
            // For the raccoon, some blendshapes need amplification or specific mapping
            child.morphTargetInfluences[index] = w.score;
          }
        });
      }
    });
  }

  // Update 2D Emoji
  const top = detectEmotionFromBlendshapes(blendshapes);
  emojiFace.textContent = emotionToEmoji[top.score >= 0.5 ? top.emotion : "neutral"];
}

function drawLandmarks(result) {
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!result.faceLandmarks || result.faceLandmarks.length === 0) return;

  ctx.fillStyle = "rgba(255,255,255,0.5)";
  result.faceLandmarks[0].forEach((pt) => {
    ctx.fillRect(pt.x * overlay.width, pt.y * overlay.height, 1.5, 1.5);
  });
}

function updateGameWithEmotion(emotion, confidence) {
  if (!gameRunning) return;

  if (emotion === gameTarget && confidence >= CONFIDENCE_THRESHOLD) {
    holdCounter += 1;
    targetEmotionEl.classList.add('holding');
  } else {
    holdCounter = 0;
    targetEmotionEl.classList.remove('holding');
  }

  if (holdCounter >= STABLE_FRAMES_REQUIRED) {
    gameScore += 10;
    scoreEl.textContent = String(gameScore);

    // Quick visual feedback on score
    scoreEl.style.transform = "scale(1.5)";
    scoreEl.style.color = "var(--accent)";
    setTimeout(() => {
      scoreEl.style.transform = "scale(1)";
      scoreEl.style.color = "";
    }, 300);

    holdCounter = 0;
    targetEmotionEl.classList.remove('holding');
    pickTargetEmotion();
  }
}


function pickTargetEmotion() {
  const randomIndex = Math.floor(Math.random() * emotionPool.length);
  gameTarget = emotionPool[randomIndex];
  targetEmotionEl.textContent = gameTarget;
}

function syncOverlaySize() {
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
}

async function loop() {
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = faceLandmarker.detectForVideo(video, performance.now());

    if (result) {
      drawLandmarks(result);
      updateAvatar(result.faceBlendshapes);

      const top = detectEmotionFromBlendshapes(result.faceBlendshapes);

      if (top.score >= 0.3) { // Lower threshold for "feedback" labeling
        if (top.score >= CONFIDENCE_THRESHOLD) {
          if (lastCandidate === top.emotion) {
            stableCounter++;
          } else {
            lastCandidate = top.emotion;
            stableCounter = 0;
          }

          if (stableCounter >= STABLE_FRAMES_REQUIRED && lastStableEmotion !== top.emotion) {
            lastStableEmotion = top.emotion;
            applyTheme(top.emotion);
          }
        } else {
          stableCounter = 0;
        }

        avatarLabel.textContent = top.emotion;
        confidenceEl.textContent = `Confidence: ${(top.score * 100).toFixed(1)}%`;
        updateGameWithEmotion(top.emotion, top.score);
      } else {
        stableCounter = 0;
        avatarLabel.textContent = "Neutral";
        confidenceEl.textContent = "Confidence: -";
      }
    }
  }

  if (renderer) renderer.render(scene, camera);
  animationHandle = requestAnimationFrame(loop);
}

/** BOOTSTRAP */
async function startApp() {
  startBtn.disabled = true;
  setStatus("Initializing AI & 3D...");
  try {
    initThreeJS();
    await Promise.all([initMediaPipe(), loadAvatar()]);

    setStatus("Opening Camera...");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 640, height: 480 },
    });
    video.srcObject = stream;
    video.addEventListener("loadeddata", () => {
      syncOverlaySize();
      cameraReady = true;
      startGameBtn.disabled = false;
      setStatus("Tracking Face Expressions");
      ambient.unlockFromUserGesture();
      loop();
    });
  } catch (err) {
    setStatus("Error: " + err.message);
    startBtn.disabled = false;
  }
}

startBtn.addEventListener("click", startApp);
startGameBtn.addEventListener("click", () => {
  gameRunning = true;
  gameScore = 0;
  gameTimer = GAME_DURATION_SECONDS;
  scoreEl.textContent = "0";
  pickTargetEmotion();
  startGameBtn.disabled = true;
  gameInterval = setInterval(() => {
    gameTimer--;
    timeLeftEl.textContent = String(gameTimer);
    if (gameTimer <= 0) {
      clearInterval(gameInterval);
      gameRunning = false;
      startGameBtn.disabled = false;
      startGameBtn.textContent = "Play Again";
      setStatus("Game Over!");
      alert(`Final Score: ${gameScore}`);
    }
  }, 1000);

});

muteAudioBtn.addEventListener("click", () => {
  const next = !ambient.muted;
  ambient.setMuted(next);
  muteAudioBtn.textContent = next ? "Sound: Off" : "Sound: On";
});

applyTheme("neutral", { immediate: true });
window.addEventListener("resize", () => {
  if (renderer && camera && avatarContainer) {
    const w = avatarContainer.clientWidth || 300;
    const h = 240;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
});
