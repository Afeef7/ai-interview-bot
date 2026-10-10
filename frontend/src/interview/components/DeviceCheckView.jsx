import React, { useState, useEffect, useRef } from 'react';

export default function DeviceCheckView({
  onStart,
  onBack,
  useSpeechHook,
  streamRef,
  videoRef
}) {
  const [consentGiven, setConsentGiven] = useState(false);
  const [camReady, setCamReady] = useState(false);
  const [camError, setCamError] = useState(null);

  const {
    testVoice,
    isSpeaking,
    micVolume,
    startMicMeter,
    stopMicMeter
  } = useSpeechHook;

  // Initialize camera and mic for preview
  useEffect(() => {
    let active = true;

    async function initDevices() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: true
        });

        if (!active) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }

        setCamReady(true);
        startMicMeter(stream);
      } catch (err) {
        if (!active) return;
        console.warn('[DeviceCheck] Camera/mic access issue:', err);
        setCamError(err.message || 'Could not access camera or microphone.');
      }
    }

    initDevices();

    return () => {
      active = false;
      stopMicMeter();
    };
  }, [startMicMeter, stopMicMeter, streamRef, videoRef]);

  return (
    <div className="interview-card device-check-card">
      <div className="card-badge">Step 2 of 2</div>
      <h2 className="setup-title">Verify Audio & Video Setup</h2>
      <p className="setup-desc">
        Make sure your camera is framed comfortably and your microphone picks up your voice before beginning.
      </p>

      <div className="device-check-grid">
        {/* Camera Preview */}
        <div className="device-col">
          <div className="cam-preview-box">
            <video
              ref={videoRef}
              className="device-preview-video"
              playsInline
              muted
              autoPlay
            />
            {!camReady && !camError && (
              <div className="cam-placeholder">Requesting camera access...</div>
            )}
            {camError && (
              <div className="cam-placeholder error-text">
                ⚠️ {camError}
                <div className="cam-subtext">You can still type your answers if needed.</div>
              </div>
            )}
            <div className="cam-badge">
              <span className={`status-dot ${camReady ? 'green' : 'amber'}`} />
              {camReady ? 'Camera Online (640x480)' : 'Camera Inactive'}
            </div>
          </div>
        </div>

        {/* Audio & Controls */}
        <div className="device-col device-controls-col">
          <div className="check-item">
            <label className="check-label">Microphone Input Level</label>
            <div className="mic-meter-bar-wrapper">
              <div
                className="mic-meter-bar"
                style={{
                  width: `${Math.max(4, micVolume)}%`,
                  backgroundColor: micVolume > 60 ? '#10b981' : micVolume > 15 ? '#6366f1' : '#475569'
                }}
              />
            </div>
            <div className="mic-hint">
              {micVolume > 15 ? '🎤 Mic detecting audio cleanly' : 'Speak to test microphone activity'}
            </div>
          </div>

          <div className="check-item">
            <label className="check-label">Audio Output (AI Voice)</label>
            <button
              type="button"
              className="btn btn-secondary voice-test-btn"
              onClick={testVoice}
              disabled={isSpeaking}
            >
              {isSpeaking ? '🔊 Speaking...' : '🔊 Test AI Voice'}
            </button>
          </div>

          {/* Privacy Consent Notice */}
          <div className="consent-box">
            <div className="consent-header">
              <span className="shield-icon">🛡️</span>
              <strong>Privacy & Local Processing Guarantee</strong>
            </div>
            <p className="consent-text">
              Video and facial landmark analysis run 100% locally on your computer inside your browser.
              No video frames, biometric data, or camera feeds are ever stored or uploaded to any server.
            </p>
            <label className="consent-checkbox-label">
              <input
                type="checkbox"
                checked={consentGiven}
                onChange={(e) => setConsentGiven(e.target.checked)}
              />
              <span>I understand and consent to in-browser local audio/visual analysis.</span>
            </label>
          </div>
        </div>
      </div>

      <div className="device-check-actions">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          &larr; Back to Setup
        </button>
        <button
          type="button"
          className="btn btn-primary btn-large"
          disabled={!consentGiven}
          onClick={onStart}
        >
          Begin Interview &rarr;
        </button>
      </div>
    </div>
  );
}
