import React, { useState, useEffect, useRef } from 'react';

export default function ListeningView({
  question,
  turnIndex,
  totalQuestions,
  emptyAnswerAttempts,
  useSpeechHook,
  onSubmitAnswer
}) {
  const {
    startListening,
    stopListening,
    transcript,
    setTranscript,
    interimTranscript,
    isListening,
    micBlocked,
    isSttSupported
  } = useSpeechHook;

  const [typedMode, setTypedMode] = useState(!isSttSupported || micBlocked);
  const [emptyWarning, setEmptyWarning] = useState(false);
  const answerSubmittedRef = useRef(false);

  // Start speech recognition when entering listening phase
  useEffect(() => {
    answerSubmittedRef.current = false;
    setEmptyWarning(false);

    if (isSttSupported && !micBlocked && !typedMode) {
      startListening({
        onSilenceTimeout: (spokenText) => {
          if (!answerSubmittedRef.current) {
            handleComplete(spokenText);
          }
        }
      });
    }

    return () => {
      stopListening();
    };
  }, [isSttSupported, micBlocked, typedMode, startListening, stopListening]);

  // If mic becomes blocked mid-listen, flip to typed mode automatically
  useEffect(() => {
    if (micBlocked || !isSttSupported) {
      setTypedMode(true);
    }
  }, [micBlocked, isSttSupported]);

  const handleComplete = async (textToSubmit) => {
    const text = (textToSubmit !== undefined ? textToSubmit : transcript).trim();
    if (!text) {
      setEmptyWarning(true);
      return;
    }
    answerSubmittedRef.current = true;
    stopListening();
    const result = await onSubmitAnswer(text, false);
    if (result?.needsPrompt) {
      setEmptyWarning(true);
      answerSubmittedRef.current = false;
    }
  };

  const handleSkip = async () => {
    answerSubmittedRef.current = true;
    stopListening();
    await onSubmitAnswer('', true);
  };

  return (
    <div className="interview-card listening-card">
      <div className="listening-header">
        <span className="meta-chip question-counter">
          Question {turnIndex + 1} of {totalQuestions}
        </span>
        <span className="listening-badge">
          <span className="recording-dot" />
          Listening to your response...
        </span>
      </div>

      <div className="active-question-banner">
        <strong>Question:</strong> {question?.question}
      </div>

      {emptyWarning && (
        <div className="warning-callout">
          ⚠️ <strong>Empty Answer Detected:</strong> Please speak into your microphone or type your response below before proceeding.
          {emptyAnswerAttempts >= 1 && (
            <span className="skip-tip"> You may also skip this question if you prefer.</span>
          )}
        </div>
      )}

      {/* Transcript Area / Speech Captions */}
      <div className="transcript-box">
        <div className="transcript-box-header">
          <span className="transcript-label">Live Captions & Response Draft</span>
          <button
            type="button"
            className="toggle-typed-btn"
            onClick={() => setTypedMode(!typedMode)}
          >
            {typedMode ? '🎙️ Switch to Voice Dictation' : '⌨️ Switch to Typed Mode'}
          </button>
        </div>

        {typedMode ? (
          <textarea
            className="typed-textarea"
            placeholder="Type your response here..."
            rows={5}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            autoFocus
          />
        ) : (
          <div className="captions-container">
            {transcript || interimTranscript ? (
              <p className="caption-text">
                {transcript}
                {interimTranscript && (
                  <span className="interim-text"> {interimTranscript}</span>
                )}
              </p>
            ) : (
              <p className="caption-placeholder">
                Speak naturally. Your words will appear here in real-time...
              </p>
            )}
          </div>
        )}

        <div className="transcript-footer">
          <span className="word-count">
            Words: {transcript.trim().split(/\s+/).filter(Boolean).length}
          </span>
          <span className="silence-hint">
            Auto-submits after 3s of silence once you finish speaking
          </span>
        </div>
      </div>

      <div className="listening-actions">
        {emptyAnswerAttempts >= 1 && (
          <button
            type="button"
            className="btn btn-secondary skip-btn"
            onClick={handleSkip}
          >
            ⏭️ Skip Question
          </button>
        )}

        <button
          type="button"
          className="btn btn-primary btn-large done-answering-btn"
          onClick={() => handleComplete(transcript)}
        >
          ✅ Done Answering &rarr;
        </button>
      </div>
    </div>
  );
}
