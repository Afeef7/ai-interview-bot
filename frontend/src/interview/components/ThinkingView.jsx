import React from 'react';

export default function ThinkingView({ isStart = false, turnIndex, totalQuestions }) {
  return (
    <div className="interview-card thinking-card">
      <div className="thinking-content">
        <div className="thinking-orb">
          <div className="orb-ring ring-1" />
          <div className="orb-ring ring-2" />
          <div className="orb-core">🤖</div>
        </div>

        <h3 className="thinking-title">
          {isStart
            ? 'Preparing Your Personalized Interview Session...'
            : 'Analyzing Response & Formulating Next Question...'}
        </h3>

        <p className="thinking-subtitle">
          {isStart
            ? 'Calibrating interview difficulty and topic agenda...'
            : `Evaluating delivery, pacing, and answers for Question ${turnIndex} of ${totalQuestions}.`}
        </p>

        <div className="thinking-progress-bar">
          <div className="thinking-progress-glow" />
        </div>
      </div>
    </div>
  );
}
