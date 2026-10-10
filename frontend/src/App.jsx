import { useState, useEffect } from 'react';
import './App.css';

const API_BASE_URL = 'http://localhost:8000';

function App() {
  const [healthData, setHealthData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
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
      setError(err.message || 'Failed to connect to backend server');
      setHealthData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  return (
    <div className="app-container">
      <div className="glow-sphere" />

      <header className="header">
        <div className="brand-badge">
          <span>AI Interview Suite</span>
        </div>
        <h1 className="brand-title">MockMate</h1>
        <p className="brand-subtitle">
          Intelligent real-time interview preparation platform with AI feedback & emotion analytics
        </p>
      </header>

      <main className="main-content">
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <span>Backend Connection</span>
            </h2>
            <button
              id="refresh-health-btn"
              className="refresh-btn"
              onClick={fetchHealth}
              disabled={loading}
              title="Re-check backend status"
            >
              {loading ? 'Checking...' : 'Refresh'}
            </button>
          </div>

          {error && (
            <div className="error-banner">
              <strong>Unable to reach backend:</strong> {error}
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
                    loading ? 'loading' : healthData?.status === 'ok' ? 'online' : 'offline'
                  }`}
                />
                <span>
                  {loading
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
                {loading ? (
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
              {loading
                ? '{\n  "status": "loading..."\n}'
                : JSON.stringify(healthData ?? { error: error ?? 'Offline' }, null, 2)}
            </pre>
          </div>
        </div>
      </main>

      <footer className="footer">
        <p>MockMate &bull; Scaffolded with Vite + React + FastAPI</p>
      </footer>
    </div>
  );
}

export default App;
