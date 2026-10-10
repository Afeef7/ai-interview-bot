/**
 * emotion.js — MockMate facial emotion pipeline (v2)
 *
 * What changed from v1:
 * - MediaPipe FaceLandmarker (VIDEO mode, blendshapes + transformation matrices)
 *   replaces FaceDetector (IMAGE mode)
 * - requestAnimationFrame loop capped at 15 FPS (was setInterval ≈ 2.9 FPS)
 * - Emotion model runs every 4th successful detection
 * - Time-based EMA: α = 1 − exp(−dt/τ), τ = 2 s (was fixed-α)
 * - No face / face < 80 px wide  →  {face:false}; no center-crop fallback
 * - Labels loaded once from labels.json; throws on failure, no silent fallback
 * - Blendshape signals: smileScore, eyeBlink, headYaw, headPitch, irisOffset
 * - All tensors disposed via tf.tidy + explicit finally blocks
 * - Public tracker API is backwards-compatible with v1
 */
import * as tf from '@tensorflow/tfjs';
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

// ─── Configuration ─────────────────────────────────────────────────────────────
const MODEL_URL      = '/web_model/model.json';
const LABELS_URL     = '/web_model/labels.json';
const WASM_CDN       = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const LANDMARK_ASSET =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const DETECT_FPS_CAP = 15;               // max face detections per second
const INFER_EVERY_N  = 4;                // run emotion model every Nth detection
const MIN_FACE_PX    = 80;              // skip inference if face narrower than this
const FACE_MARGIN    = 0.20;            // 20 % padding around bounding box
const EMA_TAU_MS     = 2000;            // EMA time constant in milliseconds
const MIN_DETECT_MS  = 1000 / DETECT_FPS_CAP; // ≈ 66.7 ms

// ─── Exported emotion groups ───────────────────────────────────────────────────
export const EMOTION_GROUPS = {
  positive: ['happy', 'surprise'],
  neutral:  ['neutral'],
  negative: ['angry', 'disgust', 'fear', 'sad'],
};

// ─── Module-level singletons ───────────────────────────────────────────────────
let cachedModel      = null;
let cachedLabels     = null;   // loaded from labels.json; null until loaded
let cachedLandmarker = null;
let landmarkerBusy   = false;  // prevents concurrent init calls

// ─── Labels ───────────────────────────────────────────────────────────────────

/**
 * Loads class labels from /web_model/labels.json.
 * Throws a descriptive Error if the file is missing or malformed.
 * No DEFAULT_LABELS silent fallback — caller must handle the error.
 */
export async function loadLabels() {
  if (cachedLabels) return cachedLabels;
  const res = await fetch(LABELS_URL);
  if (!res.ok) throw new Error(`labels.json fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0)
    throw new Error('labels.json must be a non-empty JSON array');
  cachedLabels = data;
  console.log('[emotion] Labels loaded:', cachedLabels);
  return cachedLabels;
}

// ─── Model ────────────────────────────────────────────────────────────────────

/** Loads the TF.js emotion model (GraphModel with LayersModel fallback). */
export async function loadEmotionModel() {
  if (cachedModel) return cachedModel;
  console.log('[emotion] Loading TF.js model …');
  try {
    cachedModel = await tf.loadGraphModel(MODEL_URL);
    console.log('[emotion] GraphModel ready.');
  } catch {
    console.warn('[emotion] GraphModel failed — trying LayersModel …');
    cachedModel = await tf.loadLayersModel(MODEL_URL);
    console.log('[emotion] LayersModel ready.');
  }
  return cachedModel;
}

// ─── FaceLandmarker ───────────────────────────────────────────────────────────

/**
 * Initialises MediaPipe FaceLandmarker in VIDEO mode.
 * Blendshapes and facial transformation matrices are enabled for signals.
 * Returns the cached instance on subsequent calls.
 */
export async function initFaceLandmarker() {
  if (cachedLandmarker) return cachedLandmarker;
  // Serialise concurrent calls
  if (landmarkerBusy) {
    await new Promise(r => {
      const t = setInterval(() => {
        if (!landmarkerBusy) { clearInterval(t); r(); }
      }, 50);
    });
    return cachedLandmarker;
  }
  landmarkerBusy = true;
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
    cachedLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: LANDMARK_ASSET, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    console.log('[emotion] FaceLandmarker ready (VIDEO mode, blendshapes ON).');
    return cachedLandmarker;
  } catch (err) {
    console.error('[emotion] FaceLandmarker init failed:', err);
    return null;
  } finally {
    landmarkerBusy = false;
  }
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/** Returns a blendshape score by category name (0 if absent). */
function bs(blendshapes, name) {
  return blendshapes?.[0]?.categories?.find(c => c.categoryName === name)?.score ?? 0;
}

/**
 * Computes the axis-aligned bounding box of all face mesh landmarks.
 * Returns pixel-space { originX, originY, width, height } or null.
 */
function landmarkBox(landmarks, W, H) {
  if (!landmarks?.length) return null;
  let mnX = 1, mxX = 0, mnY = 1, mxY = 0;
  for (const lm of landmarks[0]) {
    if (lm.x < mnX) mnX = lm.x;
    if (lm.x > mxX) mxX = lm.x;
    if (lm.y < mnY) mnY = lm.y;
    if (lm.y > mxY) mxY = lm.y;
  }
  return {
    originX: mnX * W,
    originY: mnY * H,
    width:   (mxX - mnX) * W,
    height:  (mxY - mnY) * H,
  };
}

/**
 * Extracts blendshape-based signals and head pose from a FaceLandmarker result.
 *
 * Returns:
 *   smileScore  — avg mouthSmileLeft/Right blendshape  [0..1]
 *   eyeBlink    — avg eyeBlinkLeft/Right               [0..1]
 *   headYaw     — left/right head turn in degrees  (ZYX Euler from 4×4 matrix)
 *   headPitch   — up/down nod in degrees           (ZYX Euler from 4×4 matrix)
 *   irisOffset  — horizontal iris displacement from eye centre
 *                 (−0.5 = far left, 0 = camera, +0.5 = far right)
 *
 * The 4×4 transformation matrix is row-major:
 *   yaw   = atan2(m[4],  m[0])
 *   pitch = atan2(−m[8], √(m[9]²+m[10]²))
 *
 * Iris landmarks: 468 (L-iris centre), 473 (R-iris centre).
 * Eye corners:    L outer=33, L inner=133 | R inner=362, R outer=263.
 */
function extractSignals(result) {
  const bss = result.faceBlendshapes;
  const smileScore = (bs(bss, 'mouthSmileLeft') + bs(bss, 'mouthSmileRight')) / 2;
  const eyeBlink   = (bs(bss, 'eyeBlinkLeft')  + bs(bss, 'eyeBlinkRight'))  / 2;

  // Head pose from row-major 4×4 transformation matrix
  let headYaw = 0, headPitch = 0;
  const mats = result.facialTransformationMatrixes;
  if (mats?.length) {
    const m = mats[0].data; // Float32Array[16]
    headYaw   = Math.atan2(m[4], m[0]) * (180 / Math.PI);
    headPitch = Math.atan2(-m[8], Math.sqrt(m[9] * m[9] + m[10] * m[10])) * (180 / Math.PI);
  }

  // Iris offset (eye-contact proxy)
  let irisOffset = 0;
  const lms = result.faceLandmarks?.[0];
  if (lms && lms.length > 473) {
    const lW = Math.abs(lms[133].x - lms[33].x)  || 1;
    const rW = Math.abs(lms[263].x - lms[362].x) || 1;
    const lPos = (lms[468].x - lms[33].x)  / lW;
    const rPos = (lms[473].x - lms[362].x) / rW;
    irisOffset = (lPos + rPos) / 2 - 0.5;
  }

  return {
    smileScore: +smileScore.toFixed(3),
    eyeBlink:   +eyeBlink.toFixed(3),
    headYaw:    +headYaw.toFixed(1),
    headPitch:  +headPitch.toFixed(1),
    irisOffset: +irisOffset.toFixed(3),
  };
}

// ─── Preprocessing ─────────────────────────────────────────────────────────────

/**
 * Crops the face region from the source video element, draws it to a 96×96
 * offscreen canvas with high-quality antialias smoothing (matching PIL bilinear
 * for downsampling), converts to luma grayscale copied across all 3 channels,
 * and returns:
 *
 *   tensor  — float32 [1, 96, 96, 3], range [0, 255], NO division by 255
 *   canvas  — the 96×96 HTMLCanvasElement (for debug display only)
 *
 * The display video is CSS-mirrored (scaleX −1); the canvas fed to the model
 * is drawn directly from the unmirrored video source — never flipped.
 *
 * @param {HTMLVideoElement} src
 * @param {{ originX, originY, width, height }} bbox  Pixel bounding box
 */
export function extractAndPreprocessFace(src, bbox) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 96;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const W = src.videoWidth  || src.naturalWidth  || src.width  || 640;
  const H = src.videoHeight || src.naturalHeight || src.height || 480;

  // Expand bbox by FACE_MARGIN, clamped to frame boundaries
  const mx = bbox.width  * FACE_MARGIN;
  const my = bbox.height * FACE_MARGIN;
  const sx = Math.max(0, bbox.originX - mx);
  const sy = Math.max(0, bbox.originY - my);
  const sw = Math.min(W - sx, bbox.width  + 2 * mx);
  const sh = Math.min(H - sy, bbox.height + 2 * my);

  // Antialias downscale to 96×96
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, 96, 96);

  // Luma grayscale → copy to R G B channels
  const img = ctx.getImageData(0, 0, 96, 96);
  for (let i = 0; i < img.data.length; i += 4) {
    const g = Math.round(
      0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]
    );
    img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);

  // [1, 96, 96, 3] float32, range [0, 255] — NO external rescaling
  const tensor = tf.tidy(() =>
    tf.browser.fromPixels(canvas, 3).expandDims(0).toFloat()
  );

  return { tensor, canvas };
}

// ─── Grouped scores ────────────────────────────────────────────────────────────

/** Maps per-class probabilities to positive / neutral / negative group sums. */
export function calculateGroupedScores(p) {
  const pos = (p.happy   || 0) + (p.surprise || 0);
  const neu =  p.neutral || 0;
  const neg = (p.angry   || 0) + (p.disgust  || 0) + (p.fear || 0) + (p.sad || 0);
  return {
    positive:     +pos.toFixed(4),
    neutral:      +neu.toFixed(4),
    negative:     +neg.toFixed(4),
    dominantGroup: pos >= neu && pos >= neg ? 'positive'
                 : neg >= neu              ? 'negative'
                 : 'neutral',
  };
}

// ─── Emotion Tracker ───────────────────────────────────────────────────────────

/**
 * Creates an emotion tracker with a requestAnimationFrame detection loop.
 *
 * Options (v1 options sampleIntervalMs / alpha are accepted but ignored):
 *   tau: number  — EMA time constant in ms (default 2000)
 *
 * Public API (backwards-compatible with v1):
 *   .start(videoElement, onUpdate)
 *   .stop()
 *   .reset()
 *   .getSummary()   — same shape as v1
 *   .getHistory()   — array of samples
 *   .getPerf()      — { detectionFPS, inferenceFPS, elapsedSeconds }  ← new
 *
 * Sample delivered to onUpdate(sample, summary):
 * {
 *   face:        boolean,
 *   timestamp:   number,
 *   raw:         { label, confidence, probabilities, grouped } | null,
 *   smoothed:    { label, confidence, probabilities, grouped } | null,
 *   signals:     { smileScore, eyeBlink, headYaw, headPitch, irisOffset } | null,
 *   debugCanvas: HTMLCanvasElement | null,  // 96×96 model input — debug display only
 * }
 */
export function createEmotionTracker(options = {}) {
  const tau = options.tau ?? EMA_TAU_MS;
  // Accept legacy v1 options without error (silently ignore)
  void options.sampleIntervalMs;
  void options.alpha;

  let isTracking        = false;
  let rafId             = null;
  let isProcessing      = false;   // serialises async inference calls
  let lastDetectMs      = 0;       // rAF timestamp of last detection
  let detectionFrame    = 0;       // count of face-present frames (drives INFER_EVERY_N)
  let emaProbabilities  = null;
  let lastEmaTs         = null;    // Date.now() when EMA was last updated
  let lastEmotionResult = null;    // cached between every-N inferences
  let lastThumbnail     = null;    // HTMLCanvasElement for debug display
  let lastSignals       = null;
  const history         = [];

  // Performance counters
  let detectionCount = 0;
  let inferenceCount = 0;
  let startPerf      = 0;

  // Callback references (set by start())
  let _video    = null;
  let _onUpdate = null;

  // ── rAF loop ────────────────────────────────────────────────────────────────
  const loop = (now) => {
    if (!isTracking) return;
    rafId = requestAnimationFrame(loop);           // always re-schedule first
    if (now - lastDetectMs < MIN_DETECT_MS) return; // FPS cap
    if (isProcessing) return;                      // serialise async work
    lastDetectMs = now;
    isProcessing = true;
    doFrame(now).finally(() => { isProcessing = false; });
  };

  // ── Per-frame async work ─────────────────────────────────────────────────────
  const doFrame = async (rafNow) => {
    const landmarker = cachedLandmarker;
    const video      = _video;
    if (!landmarker || !video || video.readyState < 2) return;

    // Detect face landmarks (synchronous in MediaPipe VIDEO mode)
    let result;
    try {
      result = landmarker.detectForVideo(video, rafNow);
    } catch (err) {
      console.warn('[emotion] detectForVideo error:', err);
      return;
    }

    detectionCount++;
    const hasLms = result.faceLandmarks?.length > 0;

    // ── No face detected ──────────────────────────────────────────────────────
    if (!hasLms) {
      _notify({ face: false, timestamp: Date.now(), raw: null, smoothed: null, signals: null, debugCanvas: null });
      return;
    }

    const W    = video.videoWidth  || 640;
    const H    = video.videoHeight || 480;
    const bbox = landmarkBox(result.faceLandmarks, W, H);

    // ── Face too small — skip ─────────────────────────────────────────────────
    if (!bbox || bbox.width < MIN_FACE_PX) {
      _notify({ face: false, timestamp: Date.now(), raw: null, smoothed: null, signals: null, debugCanvas: null });
      return;
    }

    detectionFrame++;
    lastSignals = extractSignals(result);

    // ── Emotion inference (every INFER_EVERY_N face frames) ───────────────────
    if (detectionFrame % INFER_EVERY_N === 0) {
      let tensor    = null;
      let outTensor = null;
      try {
        const prep = extractAndPreprocessFace(video, bbox);
        tensor         = prep.tensor;
        lastThumbnail  = prep.canvas;  // keep for debug display

        const model  = cachedModel;
        const labels = cachedLabels;
        if (model && labels) {
          // Run prediction; wrap in tidy to dispose any intermediates
          outTensor = tf.tidy(() => {
            const out = model.predict(tensor);
            return Array.isArray(out) ? out[0] : out;
          });

          const arr = await outTensor.data();  // async read from GPU
          const probs = {};
          let mi = 0, mv = -1;
          for (let i = 0; i < arr.length; i++) {
            const p = +Number(arr[i]).toFixed(4);
            probs[labels[i] ?? `cls_${i}`] = p;
            if (arr[i] > mv) { mv = arr[i]; mi = i; }
          }

          lastEmotionResult = {
            label:         labels[mi] ?? `cls_${mi}`,
            confidence:    +mv.toFixed(4),
            probabilities: probs,
            grouped:       calculateGroupedScores(probs),
          };
          inferenceCount++;
        }
      } catch (err) {
        console.warn('[emotion] inference error:', err);
      } finally {
        // Always dispose both tensors, even on error
        tensor?.dispose();
        outTensor?.dispose();
      }
    }

    // ── Waiting for first inference ───────────────────────────────────────────
    if (!lastEmotionResult) {
      _notify({
        face: true, timestamp: Date.now(),
        raw: null, smoothed: null,
        signals: lastSignals, debugCanvas: lastThumbnail,
      });
      return;
    }

    // ── Time-based EMA: α = 1 − exp(−dt/τ) ──────────────────────────────────
    const nowMs = Date.now();
    if (!emaProbabilities || !lastEmaTs) {
      // First sample — seed EMA with raw values
      emaProbabilities = { ...lastEmotionResult.probabilities };
      lastEmaTs        = nowMs;
    } else {
      const alpha = 1 - Math.exp(-(nowMs - lastEmaTs) / tau);
      lastEmaTs   = nowMs;
      for (const [lbl, p] of Object.entries(lastEmotionResult.probabilities)) {
        emaProbabilities[lbl] = +(
          alpha * p + (1 - alpha) * (emaProbabilities[lbl] ?? 0)
        ).toFixed(4);
      }
    }

    // Dominant smoothed emotion
    let sLabel = lastEmotionResult.label, sConf = -1;
    for (const [lbl, v] of Object.entries(emaProbabilities)) {
      if (v > sConf) { sConf = v; sLabel = lbl; }
    }

    const smoothed = {
      label:         sLabel,
      confidence:    +sConf.toFixed(4),
      probabilities: { ...emaProbabilities },
      grouped:       calculateGroupedScores(emaProbabilities),
    };

    const sample = {
      face:        true,
      timestamp:   nowMs,
      raw:         lastEmotionResult,
      smoothed,
      signals:     lastSignals,
      debugCanvas: lastThumbnail,
    };

    history.push(sample);
    _notify(sample);
  };

  const _notify = (sample) => _onUpdate?.(sample, getSummary());

  // ── Public API ───────────────────────────────────────────────────────────────

  /** Start tracking. videoElement must be a playing HTMLVideoElement. */
  const start = (videoElement, onUpdate = null) => {
    if (isTracking) return;
    _video    = videoElement;
    _onUpdate = onUpdate;
    isTracking = true;
    startPerf  = performance.now();
    rafId = requestAnimationFrame(loop);
  };

  /** Pause the tracking loop (does not reset accumulated data). */
  const stop = () => {
    isTracking = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  };

  /** Stop and clear all accumulated state. */
  const reset = () => {
    stop();
    emaProbabilities  = null;
    lastEmaTs         = null;
    lastEmotionResult = null;
    lastThumbnail     = null;
    lastSignals       = null;
    detectionFrame    = 0;
    detectionCount    = 0;
    inferenceCount    = 0;
    startPerf         = performance.now();
    history.length    = 0;
  };

  /** Session summary over all history samples (same shape as v1). */
  const getSummary = () => {
    if (!history.length) return {
      totalSamples: 0, dominantEmotion: 'neutral',
      distribution: {}, groupedSummary: { positive: 0, neutral: 0, negative: 0 },
      averageConfidence: 0,
    };
    const counts  = {};
    const gCounts = { positive: 0, neutral: 0, negative: 0 };
    let totalConf = 0;
    for (const s of history) {
      const lbl = s.smoothed.label;
      counts[lbl] = (counts[lbl] || 0) + 1;
      totalConf  += s.smoothed.confidence;
      const g     = s.smoothed.grouped.dominantGroup;
      if (g in gCounts) gCounts[g]++;
    }
    let dom = 'neutral', maxC = -1;
    const dist = {};
    for (const [lbl, c] of Object.entries(counts)) {
      dist[lbl] = +((c / history.length) * 100).toFixed(1);
      if (c > maxC) { maxC = c; dom = lbl; }
    }
    return {
      totalSamples:     history.length,
      dominantEmotion:  dom,
      distribution:     dist,
      groupedSummary: {
        positive: +((gCounts.positive / history.length) * 100).toFixed(1),
        neutral:  +((gCounts.neutral  / history.length) * 100).toFixed(1),
        negative: +((gCounts.negative / history.length) * 100).toFixed(1),
      },
      averageConfidence: +(totalConf / history.length).toFixed(2),
    };
  };

  /** Real-time performance metrics (new in v2). */
  const getPerf = () => {
    const secs = (performance.now() - startPerf) / 1000;
    return {
      detectionFPS:   secs > 0 ? +(detectionCount / secs).toFixed(1) : 0,
      inferenceFPS:   secs > 0 ? +(inferenceCount / secs).toFixed(2) : 0,
      elapsedSeconds: +secs.toFixed(1),
    };
  };

  return { start, stop, reset, getSummary, getHistory: () => [...history], getPerf };
}
