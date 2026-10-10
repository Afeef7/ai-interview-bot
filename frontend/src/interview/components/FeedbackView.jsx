import React, { useState } from 'react';

export default function FeedbackView({
  feedback,
  history,
  setup,
  onRestart
}) {
  const [expandedTurn, setExpandedTurn] = useState(null);

  const score = feedback?.score ?? 0;
  const scoreColor = score >= 80 ? '#10b981' : score >= 60 ? '#6366f1' : '#f59e0b';

  const downloadSessionJson = () => {
    const sessionData = {
      timestamp: new Date().toISOString(),
      setup,
      feedback,
      history
    };

    const blob = new Blob([JSON.stringify(sessionData, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mockmate-session-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const toggleTurn = (idx) => {
    setExpandedTurn(expandedTurn === idx ? null : idx);
  };

  return (
    <div className="interview-card feedback-card">
      <div className="feedback-hero">
        <div className="score-circle-wrapper">
          <div
            className="score-circle"
            style={{ borderColor: scoreColor, color: scoreColor }}
          >
            <span className="score-num">{score}</span>
            <span className="score-label">/ 100</span>
          </div>
        </div>

        <div className="feedback-intro">
          <div className="feedback-badge">Interview Complete</div>
          <h2 className="feedback-title">Performance Evaluation</h2>
          <p className="feedback-summary">{feedback?.summary}</p>
        </div>
      </div>

      {/* Strengths & Improvements */}
      <div className="feedback-grid">
        <div className="feedback-box strengths-box">
          <h3 className="box-title">
            <span>✨ Key Strengths</span>
          </h3>
          <ul className="feedback-list">
            {(feedback?.strengths || []).map((str, i) => (
              <li key={i} className="feedback-item positive">
                <span className="bullet">✓</span>
                <span>{str}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="feedback-box improvements-box">
          <h3 className="box-title">
            <span>🎯 Areas for Growth</span>
          </h3>
          <ul className="feedback-list">
            {(feedback?.improvements || []).map((imp, i) => (
              <li key={i} className="feedback-item improvement">
                <span className="bullet">→</span>
                <span>{imp}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Per-Question Breakdown */}
      <div className="turns-review-section">
        <h3 className="section-title">Per-Question Breakdown & Signals</h3>
        <p className="section-subtitle">
          Review your answers and delivery signals recorded during each turn:
        </p>

        <div className="turns-accordion">
          {history.map((turn, idx) => (
            <div
              key={idx}
              className={`turn-accordion-item ${expandedTurn === idx ? 'expanded' : ''}`}
            >
              <div className="turn-header" onClick={() => toggleTurn(idx)}>
                <div className="turn-header-left">
                  <span className="turn-num">Q{idx + 1}</span>
                  <span className="turn-topic-badge">{turn.topic || 'General'}</span>
                  <span className="turn-snippet">
                    {turn.question.length > 60
                      ? turn.question.slice(0, 60) + '...'
                      : turn.question}
                  </span>
                </div>
                <div className="turn-header-right">
                  {turn.signals?.dominant_emotion && (
                    <span className="signal-pill emotion-pill">
                      😊 {turn.signals.dominant_emotion}
                    </span>
                  )}
                  {turn.signals?.wpm && (
                    <span className="signal-pill wpm-pill">
                      ⚡ {turn.signals.wpm} WPM
                    </span>
                  )}
                  <span className="accordion-arrow">
                    {expandedTurn === idx ? '▲' : '▼'}
                  </span>
                </div>
              </div>

              {expandedTurn === idx && (
                <div className="turn-body">
                  <div className="turn-q-block">
                    <strong>Question:</strong>
                    <p>{turn.question}</p>
                  </div>

                  <div className="turn-a-block">
                    <strong>Your Response:</strong>
                    <p className="turn-answer-text">{turn.answer}</p>
                  </div>

                  <div className="turn-signals-grid">
                    <div className="signal-stat">
                      <span className="stat-label">Pacing</span>
                      <span className="stat-val">{turn.signals?.wpm ? `${turn.signals.wpm} WPM` : 'N/A'}</span>
                    </div>
                    <div className="signal-stat">
                      <span className="stat-label">Filler Words</span>
                      <span className="stat-val">{turn.signals?.filler_count ?? 0}</span>
                    </div>
                    <div className="signal-stat">
                      <span className="stat-label">Dominant Emotion</span>
                      <span className="stat-val">{turn.signals?.dominant_emotion || 'Neutral / Uncalibrated'}</span>
                    </div>
                    <div className="signal-stat">
                      <span className="stat-label">Difficulty</span>
                      <span className="stat-val">{turn.difficulty || 'Medium'}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="feedback-actions">
        <button
          type="button"
          className="btn btn-secondary download-btn"
          onClick={downloadSessionJson}
        >
          📥 Download Session Report (JSON)
        </button>
        <button
          type="button"
          className="btn btn-primary btn-large"
          onClick={onRestart}
        >
          🔄 Start New Interview
        </button>
      </div>
    </div>
  );
}
