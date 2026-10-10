import React, { useState } from 'react';
import './App.css';
import './interview/interview.css';
import InterviewContainer from './interview/components/InterviewContainer';
import EmotionDemo from './components/EmotionDemo';

function App() {
  const [activeTab, setActiveTab] = useState('interview'); // 'interview' | 'demo'

  return (
    <div className="app-container">
      <div className="glow-sphere" />

      <header className="header">
        <div className="brand-badge">
          <span>AI Interview Suite</span>
        </div>
        <h1 className="brand-title">MockMate</h1>
        <p className="brand-subtitle">
          Real-time AI Interview Intelligence &amp; Emotion Analytics running locally in-browser
        </p>

        {/* Top Navigation Tabs */}
        <nav className="app-top-tabs">
          <button
            type="button"
            className={`tab-btn ${activeTab === 'interview' ? 'active' : ''}`}
            onClick={() => setActiveTab('interview')}
          >
            🎯 AI Mock Interview
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'demo' ? 'active' : ''}`}
            onClick={() => setActiveTab('demo')}
          >
            👁️ Emotion Analytics Demo
          </button>
        </nav>
      </header>

      <main className="main-content">
        {activeTab === 'interview' ? (
          <InterviewContainer />
        ) : (
          <EmotionDemo />
        )}
      </main>

      <footer className="footer">
        <p>MockMate &bull; Vite + React + FastAPI + TensorFlow.js In-Browser Inference</p>
      </footer>
    </div>
  );
}

export default App;
