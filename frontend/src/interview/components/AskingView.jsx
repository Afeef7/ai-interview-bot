import React, { useEffect, useRef } from 'react';

export default function AskingView({
  question,
  turnIndex,
  totalQuestions,
  useSpeechHook,
  onReadyToAnswer
}) {
  const { speak, stopSpeaking, isSpeaking } = useSpeechHook;
  const spokenOnceRef = useRef(false);

  useEffect(() => {
    if (!question?.question) return;

    // Speak question aloud once on mount/new question
    spokenOnceRef.current = true;
    speak(question.question, () => {
      // Once speaking ends, candidate can proceed or auto-advance
      // We give a brief 500ms pause and auto-advance, or wait for them
      onReadyToAnswer();
    });

    return () => {
      stopSpeaking();
    };
  }, [question, speak, stopSpeaking, onReadyToAnswer]);

  const handleRepeat = () => {
    if (question?.question) {
      speak(question.question);
    }
  };

  const difficultyColors = {
    easy: '#10b981',
    medium: '#f59e0b',
    hard: '#ef4444'
  };

  return (
    <div className="interview-card asking-card">
      <div className="asking-header">
        <div className="question-meta-chips">
          <span className="meta-chip question-counter">
            Question {turnIndex + 1} of {totalQuestions}
          </span>
          {question?.topic && (
            <span className="meta-chip topic-chip">
              Topic: {question.topic}
            </span>
          )}
          {question?.difficulty && (
            <span
              className="meta-chip diff-chip"
              style={{ borderColor: difficultyColors[question.difficulty] || '#6366f1' }}
            >
              {question.difficulty.toUpperCase()}
            </span>
          )}
          {question?.is_follow_up && (
            <span className="meta-chip followup-chip">
              Follow-up Question
            </span>
          )}
        </div>
      </div>

      <div className="question-content-box">
        <div className="avatar-speech-indicator">
          <div className={`ai-avatar ${isSpeaking ? 'pulsing' : ''}`}>
            🤖
          </div>
          <div className="speech-status">
            {isSpeaking ? 'Interviewer is speaking...' : 'Question presented'}
          </div>
        </div>

        <h3 className="question-text">
          "{question?.question}"
        </h3>
      </div>

      <div className="asking-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleRepeat}
        >
          🔄 Repeat Question
        </button>
        <button
          type="button"
          className="btn btn-primary btn-large ready-btn"
          onClick={() => {
            stopSpeaking();
            onReadyToAnswer();
          }}
        >
          🎙️ I'm Ready to Answer &rarr;
        </button>
      </div>
    </div>
  );
}
