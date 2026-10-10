import React, { useRef, useState, useEffect } from 'react';
import { useInterview, PHASES } from '../useInterview';
import { useSpeech } from '../useSpeech';
import { createEmotionTracker } from '../../emotion';

import SetupView from './SetupView';
import DeviceCheckView from './DeviceCheckView';
import AskingView from './AskingView';
import ListeningView from './ListeningView';
import ThinkingView from './ThinkingView';
import FeedbackView from './FeedbackView';

export default function InterviewContainer() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const trackerRef = useRef(null);

  const [faceDetected, setFaceDetected] = useState(false);
  const [currentEmotionLabel, setCurrentEmotionLabel] = useState(null);

  const useSpeechHook = useSpeech();
  const {
    state,
    updateSetup,
    proceedToDeviceCheck,
    beginInterview,
    startAnswering,
    submitAnswer,
    retryLastAction,
    togglePause,
    resetInterview,
    handleEmotionSample
  } = useInterview({ emotionTrackerRef: trackerRef });

  // Stop camera tracks and tracking helper
  const shutdownMedia = () => {
    if (trackerRef.current) {
      trackerRef.current.stop();
      trackerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    useSpeechHook.stopSpeaking();
    useSpeechHook.stopListening();
  };

  // Start emotion tracker when interview enters asking / listening phases
  useEffect(() => {
    if (
      (state.phase === PHASES.ASKING || state.phase === PHASES.LISTENING) &&
      videoRef.current &&
      streamRef.current
    ) {
      if (!trackerRef.current) {
        trackerRef.current = createEmotionTracker({ tau: 2000 });
        trackerRef.current.start(videoRef.current, (sample) => {
          setFaceDetected(sample.face);
          if (sample.face && sample.smoothed?.label) {
            setCurrentEmotionLabel(sample.smoothed.label);
          }
          handleEmotionSample(sample);
        });
      }
    }
  }, [state.phase, handleEmotionSample]);

  // Clean up media when unmounting or returning to setup
  useEffect(() => {
    if (state.phase === PHASES.SETUP || state.phase === PHASES.DONE) {
      shutdownMedia();
    }
  }, [state.phase]);

  const handleExit = () => {
    if (
      state.phase !== PHASES.SETUP &&
      state.phase !== PHASES.DONE
    ) {
      const confirmExit = window.confirm(
        'Are you sure you want to exit the interview? Your current progress will be lost.'
      );
      if (!confirmExit) return;
    }
    shutdownMedia();
    resetInterview();
  };

  const progressPercent = Math.min(
    100,
    Math.round((state.history.length / state.setup.max_questions) * 100)
  );

  return (
    <div className="interview-session-container">
      {/* Top Header / Progress Bar */}
      {state.phase !== PHASES.SETUP && (
        <header className="interview-top-nav">
          <div className="nav-left">
            <span className="role-badge">
              {state.setup.role} &bull; {state.setup.level}
            </span>
            <span className="nav-type-badge">{state.setup.interview_type}</span>
          </div>

          <div className="nav-center">
            <div className="interview-progress-wrapper">
              <div className="progress-info">
                <span>Progress: {state.history.length} / {state.setup.max_questions} Questions</span>
                <span>{progressPercent}%</span>
              </div>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          </div>

          <div className="nav-right">
            {(state.phase === PHASES.ASKING || state.phase === PHASES.LISTENING) && (
              <button
                type="button"
                className="btn btn-sm btn-secondary pause-btn"
                onClick={togglePause}
              >
                {state.isPaused ? '▶️ Resume' : '⏸️ Pause'}
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm btn-danger exit-btn"
              onClick={handleExit}
            >
              ✕ Exit Session
            </button>
          </div>
        </header>
      )}

      {/* Paused Overlay */}
      {state.isPaused && (
        <div className="pause-overlay">
          <div className="pause-modal">
            <h3>⏸️ Interview Paused</h3>
            <p>Take your time. When you are ready to continue, click resume.</p>
            <button
              type="button"
              className="btn btn-primary btn-large"
              onClick={togglePause}
            >
              Resume Interview
            </button>
          </div>
        </div>
      )}

      {/* Camera PiP Monitor (during asking/listening/thinking) */}
      {(state.phase === PHASES.ASKING ||
        state.phase === PHASES.LISTENING ||
        state.phase === PHASES.THINKING) && (
        <div className="camera-pip-widget">
          <video
            ref={videoRef}
            className="camera-pip-video"
            playsInline
            muted
            autoPlay
          />
          <div className="pip-status-overlay">
            <span className={`face-status-dot ${faceDetected ? 'green' : 'amber'}`} />
            <span className="pip-label">
              {faceDetected
                ? `Face active ${currentEmotionLabel ? `(${currentEmotionLabel})` : ''}`
                : 'No face detected'}
            </span>
          </div>
        </div>
      )}

      {/* Main Phase View Area */}
      <div className="interview-view-viewport">
        {state.phase === PHASES.SETUP && (
          <SetupView
            setup={state.setup}
            onChange={updateSetup}
            onNext={proceedToDeviceCheck}
          />
        )}

        {state.phase === PHASES.DEVICE_CHECK && (
          <DeviceCheckView
            onStart={beginInterview}
            onBack={resetInterview}
            useSpeechHook={useSpeechHook}
            streamRef={streamRef}
            videoRef={videoRef}
          />
        )}

        {state.phase === PHASES.THINKING && (
          <ThinkingView
            isStart={state.history.length === 0}
            turnIndex={state.history.length + 1}
            totalQuestions={state.setup.max_questions}
          />
        )}

        {state.phase === PHASES.ASKING && (
          <AskingView
            question={state.currentQuestion}
            turnIndex={state.history.length}
            totalQuestions={state.setup.max_questions}
            useSpeechHook={useSpeechHook}
            onReadyToAnswer={startAnswering}
          />
        )}

        {state.phase === PHASES.LISTENING && (
          <ListeningView
            question={state.currentQuestion}
            turnIndex={state.history.length}
            totalQuestions={state.setup.max_questions}
            emptyAnswerAttempts={state.emptyAnswerAttempts}
            useSpeechHook={useSpeechHook}
            onSubmitAnswer={submitAnswer}
          />
        )}

        {state.phase === PHASES.DONE && (
          <FeedbackView
            feedback={state.feedback}
            history={state.history}
            setup={state.setup}
            onRestart={resetInterview}
          />
        )}

        {state.phase === PHASES.ERROR && (
          <div className="interview-card error-card">
            <div className="error-icon">⚠️</div>
            <h3 className="error-title">Interview Service Interrupted</h3>
            <p className="error-message">{state.error?.message || 'An unexpected error occurred.'}</p>
            <div className="error-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={retryLastAction}
              >
                🔄 Retry Operation
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={resetInterview}
              >
                Return to Setup
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
