import React, { useState, useEffect, useRef } from 'react';
import * as tf from '@tensorflow/tfjs';
import {
  loadEmotionModel,
  loadLabels,
  initFaceLandmarker,
  createEmotionTracker
} from '../emotion';

const API_BASE_URL = 'http://localhost:8000';

const EMOTION_ICONS = {
  angry: '😠',
  disgust: '🤢',
  fear: '😨',
  happy: '😄',
  neutral: '😐',
  sad: '😢',
  surprise: '😲'
};

const EMOTION_COLORS = {
  happy: '#10b981',
  surprise: '#06b6d4',
  neutral: '#6366f1',
  sad: '#f59e0b',
  fear: '#ec4899',
  angry: '#ef4444',
  disgust: '#8b5cf6'
};

export default function EmotionDemo() {
  // Backend health state
  const [healthData, setHealthData] = useState(null);
  const [loadingHealth, setLoadingHealth] = useState(true);
  const [healthError, setHealthError] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);

  // Emotion model & webcam state
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelLoading, setModelLoading] = useState(true);
  const [modelError, setModelError] = useState(null);
  const [labels, setLabels] = useState([]);

  const [webcamActive, setWebcamActive] = useState(false);
  const [trackingActive, setTrackingActive] = useState(false);
  const [currentPrediction, setCurrentPrediction] = useState(null);
  const [sessionSummary, setSessionSummary] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const trackerRef = useRef(null);
  const thumbCanvasRef = useRef(null);

  // Face detection state and blendshape signals
  const [faceDetected, setFaceDetected] = useState(false);
  const [facialSignals, setFacialSignals] = useState(null);
  const [perfStats, setPerfStats] = useState(null);

  // Fetch backend health
  const fetchHealth = async () => {
    setLoadingHealth(true);
    setHealthError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setHealthData(data);
      setLastChecked(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Failed to fetch backend health:', err);
      setHealthError(err.message || 'Failed to connect to backend server');
      setHealthData(null);
    } finally {
      setLoadingHealth(false);
    }
  };

  useEffect(() => {
    fetchHealth();

    async function initModel() {
      try {
        setModelLoading(true);
        const [loadedModel, loadedLabels] = await Promise.all([
          loadEmotionModel(),
          loadLabels()
        ]);
        if (loadedModel) {
          setModelLoaded(true);
          setLabels(loadedLabels);
        }
        initFaceLandmarker().catch(err =>
          console.warn('[EmotionDemo] FaceLandmarker init failed:', err)
        );
      } catch (err) {
        console.error('Failed to load model or labels.json:', err);
        setModelError(err.message || 'Failed to load emotion model or labels.json');
      } finally {
        setModelLoading(false);
      }
    }

    initModel();

    return () => {
      stopWebcam();
    };
  }, []);

  // Log TF.js tensor count at tracking start and after 60 s
  useEffect(() => {
    if (!trackingActive) return;
    const t0 = tf.memory().numTensors;
    console.log(`[TF Memory] Tracking start: ${t0} tensors`);
    const timer = setTimeout(() => {
      const t1 = tf.memory().numTensors;
      console.log(`[TF Memory] After 60 s: ${t1} tensors  (Δ ${t1 - t0})`);
    }, 60_000);
    return () => clearTimeout(timer);
  }, [trackingActive]);

  // Start webcam feed
  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play();
          setWebcamActive(true);
        };
      }
    } catch (err) {
      console.error('Error accessing webcam:', err);
      alert('Unable to access webcam: ' + err.message);
    }
  };

  // Stop webcam feed
  const stopWebcam = () => {
    stopTracking();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setWebcamActive(false);
  };

  // Start real-time emotion tracker
  const startTracking = () => {
    if (!videoRef.current || !webcamActive) return;

    if (!trackerRef.current) {
      trackerRef.current = createEmotionTracker({ tau: 2000 });
    }

    trackerRef.current.start(videoRef.current, (sample, summary) => {
      setFaceDetected(sample.face);

      if (sample.face && sample.smoothed) {
        setCurrentPrediction(sample);
        setSessionSummary(summary);
      }

      if (sample.signals) setFacialSignals(sample.signals);

      if (sample.debugCanvas && thumbCanvasRef.current) {
        thumbCanvasRef.current
          .getContext('2d')
          .drawImage(sample.debugCanvas, 0, 0);
      }

      if (trackerRef.current) setPerfStats(trackerRef.current.getPerf());
    });

    setTrackingActive(true);
  };

  // Pause tracking
  const stopTracking = () => {
    if (trackerRef.current) {
      trackerRef.current.stop();
    }
    setTrackingActive(false);
  };

  // Reset stats
  const resetTracking = () => {
    if (trackerRef.current) {
      trackerRef.current.reset();
    }
    setCurrentPrediction(null);
    setSessionSummary(null);
  };

  const smoothed = currentPrediction?.smoothed;
  const grouped = smoothed?.grouped;
  const probabilities = smoothed?.probabilities || {};

  return (
    <div className="dashboard-grid">
      {/* CARD 1: Real-time Emotion Tracker */}
      <div className="card emotion-card">
        <div className="card-header">
          <h2 className="card-title">
            <span>Facial Emotion Analytics</span>
          </h2>
          <div className="header-badges">
            <span
              className={`badge ${
                modelLoading
                  ? 'warning'
                  : modelLoaded
                  ? 'success'
                  : 'danger'
              }`}
            >
              {modelLoading
                ? 'Loading TF.js...'
                : modelLoaded
                ? 'TF.js Ready'
                : 'Model Error'}
            </span>
          </div>
        </div>

        {modelError && (
          <div className="error-banner">
            <strong>Model Loading Error:</strong> {modelError}
          </div>
        )}

        {/* Video Viewport */}
        <div className="video-wrapper">
          <video
            ref={videoRef}
            playsInline
            muted
            className={`webcam-video ${webcamActive ? 'active' : 'placeholder'}`}
          />
          {!webcamActive && (
            <div className="video-overlay-placeholder">
              <span className="placeholder-icon">📷</span>
              <p>Webcam is currently inactive</p>
              <button
                id="enable-webcam-btn"
                className="action-btn primary"
                onClick={startWebcam}
                disabled={modelLoading || !modelLoaded}
              >
                Enable Webcam
              </button>
            </div>
          )}

          {webcamActive && smoothed && (
            <div className="live-emotion-overlay">
              <span className="live-icon">
                {EMOTION_ICONS[smoothed.label] || '😐'}
              </span>
              <div className="live-label-box">
                <span className="live-emotion-name">{smoothed.label}</span>
                <span className="live-emotion-conf">
                  {Math.round(smoothed.confidence * 100)}% (EMA)
                </span>
              </div>
            </div>
          )}

          {webcamActive && trackingActive && !faceDetected && (
            <div className="no-face-banner">👤 No face detected</div>
          )}
        </div>

        {/* Webcam & Tracking Controls */}
        <div className="controls-row">
          {webcamActive ? (
            <>
              {!trackingActive ? (
                <button
                  id="start-tracking-btn"
                  className="action-btn primary"
                  onClick={startTracking}
                >
                  ▶ Start Analytics
                </button>
              ) : (
                <button
                  id="pause-tracking-btn"
                  className="action-btn warning"
                  onClick={stopTracking}
                >
                  ⏸ Pause Analytics
                </button>
              )}
              <button
                id="stop-webcam-btn"
                className="action-btn secondary"
                onClick={stopWebcam}
              >
                Turn Off Camera
              </button>
              <button
                id="reset-stats-btn"
                className="action-btn text"
                onClick={resetTracking}
                title="Reset Session Stats"
              >
                Reset
              </button>
            </>
          ) : null}
        </div>

        {/* Grouped Mood State */}
        <div className="grouped-section">
          <span className="section-label">Grouped Mood State (EMA Smoothed)</span>
          <div className="grouped-pills">
            <div
              className={`group-pill positive ${
                grouped?.dominantGroup === 'positive' ? 'active' : ''
              }`}
            >
              <div className="group-info">
                <span className="group-name">Positive</span>
                <span className="group-sub">(Happy, Surprise)</span>
              </div>
              <span className="group-value">
                {grouped ? Math.round(grouped.positive * 100) : 0}%
              </span>
            </div>

            <div
              className={`group-pill neutral ${
                grouped?.dominantGroup === 'neutral' ? 'active' : ''
              }`}
            >
              <div className="group-info">
                <span className="group-name">Neutral</span>
                <span className="group-sub">(Focused, Composed)</span>
              </div>
              <span className="group-value">
                {grouped ? Math.round(grouped.neutral * 100) : 0}%
              </span>
            </div>

            <div
              className={`group-pill negative ${
                grouped?.dominantGroup === 'negative' ? 'active' : ''
              }`}
            >
              <div className="group-info">
                <span className="group-name">Negative / Stress</span>
                <span className="group-sub">(Angry, Fear, Sad, Disgust)</span>
              </div>
              <span className="group-value">
                {grouped ? Math.round(grouped.negative * 100) : 0}%
              </span>
            </div>
          </div>
        </div>

        {/* 7-Class Distribution */}
        <div className="distribution-section">
          <span className="section-label">7-Class Emotion Probabilities</span>
          <div className="bars-list">
            {labels.map((lbl) => {
              const prob = probabilities[lbl] || 0;
              const pct = Math.round(prob * 100);
              const isDominant = smoothed?.label === lbl;
              const color = EMOTION_COLORS[lbl] || '#6366f1';

              return (
                <div
                  key={lbl}
                  className={`bar-row ${isDominant ? 'dominant-row' : ''}`}
                >
                  <div className="bar-label-wrap">
                    <span className="emotion-icon-sm">
                      {EMOTION_ICONS[lbl] || '•'}
                    </span>
                    <span className="emotion-name-text">{lbl}</span>
                  </div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: color
                      }}
                    />
                  </div>
                  <span className="bar-pct">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Session Analytics Summary */}
        {sessionSummary && sessionSummary.totalSamples > 0 && (
          <div className="session-summary-box">
            <span className="section-label">Session Aggregates</span>
            <div className="summary-stats-grid">
              <div className="summary-tile">
                <span className="summary-val">{sessionSummary.totalSamples}</span>
                <span className="summary-desc">Frames Scored</span>
              </div>
              <div className="summary-tile">
                <span className="summary-val">
                  {sessionSummary.dominantEmotion.toUpperCase()}
                </span>
                <span className="summary-desc">Dominant Emotion</span>
              </div>
              <div className="summary-tile">
                <span className="summary-val">
                  {sessionSummary.groupedSummary.positive}%
                </span>
                <span className="summary-desc">Positive Time</span>
              </div>
              <div className="summary-tile">
                <span className="summary-val">
                  {sessionSummary.groupedSummary.negative}%
                </span>
                <span className="summary-desc">Stress Time</span>
              </div>
            </div>
          </div>
        )}

        {/* Debug Panel */}
        {trackingActive && (
          <div className="debug-panel">
            <span className="section-label">Debug Panel — Model Input &amp; Signals</span>
            <div className="debug-row">
              <div className="thumb-col">
                <span className="debug-sub-label">96×96 Model Input</span>
                <canvas
                  ref={thumbCanvasRef}
                  width={96}
                  height={96}
                  className="thumb-canvas"
                  title="Grayscale face crop fed to the emotion model (unmirrored)"
                />
                {!faceDetected && (
                  <span className="no-face-chip">No face</span>
                )}
              </div>

              {facialSignals && (
                <div className="signals-grid">
                  <div className="signal-row">
                    <span className="sig-label">😊 Smile</span>
                    <span className="sig-val">{(facialSignals.smileScore * 100).toFixed(0)}%</span>
                  </div>
                  <div className="signal-row">
                    <span className="sig-label">👁 Blink</span>
                    <span className="sig-val">{(facialSignals.eyeBlink * 100).toFixed(0)}%</span>
                  </div>
                  <div className="signal-row">
                    <span className="sig-label">↕ Pitch</span>
                    <span className="sig-val">{facialSignals.headPitch.toFixed(0)}°</span>
                  </div>
                  <div className="signal-row">
                    <span className="sig-label">↔ Yaw</span>
                    <span className="sig-val">{facialSignals.headYaw.toFixed(0)}°</span>
                  </div>
                  <div className="signal-row">
                    <span className="sig-label">👀 Iris</span>
                    <span className="sig-val">{facialSignals.irisOffset.toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>

            {perfStats && (
              <div className="perf-row">
                <span>🎯 Detection: <strong>{perfStats.detectionFPS} FPS</strong></span>
                <span>🧠 Inference: <strong>{perfStats.inferenceFPS} FPS</strong></span>
                <span>⏱ Elapsed: <strong>{perfStats.elapsedSeconds} s</strong></span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* CARD 2: Backend Connection & Server Health */}
      <div className="card backend-card">
        <div className="card-header">
          <h2 className="card-title">
            <span>Backend Connection</span>
          </h2>
          <button
            id="refresh-health-btn"
            className="refresh-btn"
            onClick={fetchHealth}
            disabled={loadingHealth}
            title="Re-check backend status"
          >
            {loadingHealth ? 'Checking...' : 'Refresh'}
          </button>
        </div>

        {healthError && (
          <div className="error-banner">
            <strong>Unable to reach backend:</strong> {healthError}
            <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', opacity: 0.9 }}>
              Make sure the FastAPI server is running on <code>http://localhost:8000</code>.
            </div>
          </div>
        )}

        <div className="status-grid">
          <div className="status-tile">
            <span className="status-label">Server Status</span>
            <div className="status-value">
              <span
                className={`indicator-dot ${
                  loadingHealth
                    ? 'loading'
                    : healthData?.status === 'ok'
                    ? 'online'
                    : 'offline'
                }`}
              />
              <span>
                {loadingHealth
                  ? 'Connecting...'
                  : healthData?.status === 'ok'
                  ? 'Online (OK)'
                  : 'Offline'}
              </span>
            </div>
          </div>

          <div className="status-tile">
            <span className="status-label">Gemini API Key</span>
            <div className="status-value">
              {loadingHealth ? (
                <span style={{ color: 'var(--text-muted)' }}>Checking...</span>
              ) : healthData?.gemini_key_loaded ? (
                <span className="badge success">Loaded</span>
              ) : (
                <span className="badge danger">Not Configured</span>
              )}
            </div>
          </div>
        </div>

        <div className="response-viewer">
          <div className="response-header">
            <span>Raw Response (/health)</span>
            {lastChecked && <span>Updated: {lastChecked}</span>}
          </div>
          <pre className="raw-json">
            {loadingHealth
              ? '{\n  "status": "loading..."\n}'
              : JSON.stringify(healthData ?? { error: healthError ?? 'Offline' }, null, 2)}
          </pre>
        </div>

        <div className="specs-card">
          <span className="section-label">Pipeline Specs</span>
          <ul className="specs-list">
            <li><strong>Model Architecture:</strong> MobileNetV2 (96x96x3 RGB)</li>
            <li><strong>Format:</strong> TensorFlow.js GraphModel (8.6 MB)</li>
            <li><strong>Preprocessing:</strong> Canvas Antialiased Downscaling &rarr; Luminance Grayscale 3-ch &rarr; Raw [0, 255]</li>
            <li><strong>Temporal Smoothing:</strong> Time-based EMA (&tau;=2000 ms)</li>
            <li><strong>Face Tracking:</strong> MediaPipe FaceLandmarker Video Mode (15 FPS cap)</li>
            <li><strong>Labels:</strong> Alphabetical FER2013 (7 classes)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
