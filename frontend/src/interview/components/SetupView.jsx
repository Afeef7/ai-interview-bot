import React from 'react';

const ROLE_SUGGESTIONS = [
  'Python Developer',
  'Frontend React Engineer',
  'Full Stack Developer',
  'Data Scientist',
  'DevOps Engineer',
  'Product Manager'
];

export default function SetupView({ setup, onChange, onNext }) {
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!setup.role.trim()) return;
    onNext();
  };

  return (
    <div className="interview-card setup-card">
      <div className="card-badge">Step 1 of 2</div>
      <h2 className="setup-title">Configure Your Interview Session</h2>
      <p className="setup-desc">
        Customize your role, seniority, and interview format. MockMate will tailor questions and evaluate your responses dynamically.
      </p>

      <form onSubmit={handleSubmit} className="setup-form">
        <div className="form-group">
          <label className="form-label" htmlFor="role-input">Target Role</label>
          <input
            id="role-input"
            type="text"
            className="text-input"
            placeholder="e.g. Senior Backend Engineer"
            value={setup.role}
            onChange={(e) => onChange({ role: e.target.value })}
            required
          />
          <div className="role-pills">
            {ROLE_SUGGESTIONS.map((sug) => (
              <button
                key={sug}
                type="button"
                className={`pill-btn ${setup.role === sug ? 'active' : ''}`}
                onClick={() => onChange({ role: sug })}
              >
                {sug}
              </button>
            ))}
          </div>
        </div>

        <div className="form-row">
          <div className="form-group flex-1">
            <label className="form-label" htmlFor="level-select">Experience Level</label>
            <select
              id="level-select"
              className="select-input"
              value={setup.level}
              onChange={(e) => onChange({ level: e.target.value })}
            >
              <option value="fresher">Fresher (0 - 1 yrs)</option>
              <option value="junior">Junior (1 - 3 yrs)</option>
              <option value="senior">Senior (4+ yrs)</option>
            </select>
          </div>

          <div className="form-group flex-1">
            <label className="form-label" htmlFor="type-select">Interview Type</label>
            <select
              id="type-select"
              className="select-input"
              value={setup.interview_type}
              onChange={(e) => onChange({ interview_type: e.target.value })}
            >
              <option value="mixed">Mixed (Technical + Behavioral)</option>
              <option value="technical">Technical Only</option>
              <option value="HR">HR / Behavioral Only</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <div className="slider-header">
            <label className="form-label" htmlFor="questions-slider">Number of Questions</label>
            <span className="slider-value-pill">{setup.max_questions} Questions</span>
          </div>
          <input
            id="questions-slider"
            type="range"
            min="3"
            max="10"
            step="1"
            className="range-slider"
            value={setup.max_questions}
            onChange={(e) => onChange({ max_questions: parseInt(e.target.value, 10) })}
          />
          <div className="slider-labels">
            <span>3 (Quick)</span>
            <span>6 (Standard)</span>
            <span>10 (Comprehensive)</span>
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-large">
            Continue to Device Check &rarr;
          </button>
        </div>
      </form>
    </div>
  );
}
