const API_BASE_URL = 'http://localhost:8000';

/**
 * Start an interview session with role, level, and interview type.
 * @param {Object} setup - { role, level, interview_type }
 * @returns {Promise<{ question: string, topic: string, difficulty: string, is_follow_up: boolean }>}
 */
export async function startInterview(setup) {
  const payload = {
    role: setup.role || 'Python developer',
    level: setup.level || 'fresher',
    interview_type: setup.interview_type || 'mixed'
  };

  const res = await fetch(`${API_BASE_URL}/interview/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Failed to start interview (${res.status}): ${errorText || res.statusText}`);
  }

  return await res.json();
}

/**
 * Submit the latest answer along with history and signals, and get the next question or final feedback.
 * @param {Object} params - { role, level, interview_type, history, signals, max_questions }
 * @returns {Promise<{ done: boolean, question?: Object, feedback?: Object }>}
 */
export async function nextQuestion({ role, level, interview_type, history, signals, max_questions }) {
  const payload = {
    role,
    level,
    interview_type,
    history: history.map(h => ({ question: h.question, answer: h.answer })),
    signals: signals || null,
    max_questions: Number(max_questions) || 6
  };

  const res = await fetch(`${API_BASE_URL}/interview/next`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Backend error (${res.status}): ${errorText || res.statusText}`);
  }

  return await res.json();
}
