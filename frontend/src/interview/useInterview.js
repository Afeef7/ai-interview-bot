import { useReducer, useRef, useCallback, useEffect } from 'react';
import { startInterview, nextQuestion } from './api';
import { AnswerSignalCollector } from './signals';

export const PHASES = {
  SETUP: 'setup',
  DEVICE_CHECK: 'deviceCheck',
  ASKING: 'asking',
  LISTENING: 'listening',
  THINKING: 'thinking',
  DONE: 'done',
  ERROR: 'error'
};

const initialState = {
  phase: PHASES.SETUP,
  setup: {
    role: 'Python developer',
    level: 'fresher',
    interview_type: 'mixed',
    max_questions: 6
  },
  currentQuestion: null,
  history: [],
  feedback: null,
  isPaused: false,
  emptyAnswerAttempts: 0,
  error: null // { message: string, retryAction: Function }
};

function interviewReducer(state, action) {
  switch (action.type) {
    case 'UPDATE_SETUP':
      return {
        ...state,
        setup: { ...state.setup, ...action.payload }
      };

    case 'GO_TO_DEVICE_CHECK':
      return {
        ...state,
        phase: PHASES.DEVICE_CHECK,
        error: null
      };

    case 'START_REQUEST':
      return {
        ...state,
        phase: PHASES.THINKING,
        error: null
      };

    case 'START_SUCCESS':
      return {
        ...state,
        phase: PHASES.ASKING,
        currentQuestion: action.payload,
        emptyAnswerAttempts: 0,
        error: null
      };

    case 'START_LISTENING':
      return {
        ...state,
        phase: PHASES.LISTENING,
        error: null
      };

    case 'INCREMENT_EMPTY_ATTEMPTS':
      return {
        ...state,
        emptyAnswerAttempts: state.emptyAnswerAttempts + 1
      };

    case 'NEXT_REQUEST':
      return {
        ...state,
        phase: PHASES.THINKING,
        history: [...state.history, action.payload.turn],
        error: null
      };

    case 'NEXT_SUCCESS_QUESTION':
      return {
        ...state,
        phase: PHASES.ASKING,
        currentQuestion: action.payload,
        emptyAnswerAttempts: 0,
        error: null
      };

    case 'NEXT_SUCCESS_DONE':
      return {
        ...state,
        phase: PHASES.DONE,
        feedback: action.payload,
        error: null
      };

    case 'SET_ERROR':
      return {
        ...state,
        phase: PHASES.ERROR,
        error: action.payload
      };

    case 'TOGGLE_PAUSE':
      return {
        ...state,
        isPaused: !state.isPaused
      };

    case 'RESET_ALL':
      return {
        ...initialState,
        setup: state.setup // retain selected setup preferences
      };

    default:
      return state;
  }
}

export function useInterview({ emotionTrackerRef }) {
  const [state, dispatch] = useReducer(interviewReducer, initialState);
  const signalCollectorRef = useRef(new AnswerSignalCollector());
  const retryRef = useRef(null);

  // Set setup options
  const updateSetup = useCallback((fields) => {
    dispatch({ type: 'UPDATE_SETUP', payload: fields });
  }, []);

  const proceedToDeviceCheck = useCallback(() => {
    dispatch({ type: 'GO_TO_DEVICE_CHECK' });
  }, []);

  // Hook emotion tracker samples into signal collector during answer window
  const handleEmotionSample = useCallback((sample) => {
    if (signalCollectorRef.current) {
      signalCollectorRef.current.addEmotionSample(sample);
    }
  }, []);

  // Begin interview by calling backend /interview/start
  const beginInterview = useCallback(async () => {
    dispatch({ type: 'START_REQUEST' });
    const execute = async () => {
      try {
        const questionData = await startInterview(state.setup);
        dispatch({ type: 'START_SUCCESS', payload: questionData });
      } catch (err) {
        dispatch({
          type: 'SET_ERROR',
          payload: {
            message: err.message || 'Unable to connect to interview service.',
            retryAction: execute
          }
        });
      }
    };
    retryRef.current = execute;
    await execute();
  }, [state.setup]);

  // Transition from asking to listening
  const startAnswering = useCallback(() => {
    signalCollectorRef.current.start();
    dispatch({ type: 'START_LISTENING' });
  }, []);

  // Submit current answer and move to next question or finish
  const submitAnswer = useCallback(async (answerText, isSkip = false) => {
    const trimmed = (answerText || '').trim();

    // Edge case: empty answer
    if (!trimmed && !isSkip) {
      if (state.emptyAnswerAttempts === 0) {
        dispatch({ type: 'INCREMENT_EMPTY_ATTEMPTS' });
        return { needsPrompt: true };
      }
    }

    const currentTurnAnswer = trimmed || '(Skipped)';
    const signals = signalCollectorRef.current.finish(currentTurnAnswer);

    const turnRecord = {
      question: state.currentQuestion?.question || '',
      answer: currentTurnAnswer,
      topic: state.currentQuestion?.topic || '',
      difficulty: state.currentQuestion?.difficulty || 'medium',
      signals
    };

    dispatch({
      type: 'NEXT_REQUEST',
      payload: { turn: turnRecord }
    });

    const execute = async () => {
      try {
        // Send history including the new turn
        const newHistory = [...state.history, turnRecord];
        const res = await nextQuestion({
          role: state.setup.role,
          level: state.setup.level,
          interview_type: state.setup.interview_type,
          history: newHistory,
          signals: {
            confidence: signals.confidence,
            dominant_emotion: signals.dominant_emotion,
            filler_count: signals.filler_count,
            wpm: signals.wpm
          },
          max_questions: state.setup.max_questions
        });

        if (res.done) {
          dispatch({ type: 'NEXT_SUCCESS_DONE', payload: res.feedback });
        } else {
          dispatch({ type: 'NEXT_SUCCESS_QUESTION', payload: res.question });
        }
      } catch (err) {
        dispatch({
          type: 'SET_ERROR',
          payload: {
            message: err.message || 'Failed to generate next interview turn.',
            retryAction: execute
          }
        });
      }
    };

    retryRef.current = execute;
    await execute();
    return { needsPrompt: false };
  }, [state.currentQuestion, state.history, state.setup, state.emptyAnswerAttempts]);

  const retryLastAction = useCallback(() => {
    if (retryRef.current) {
      retryRef.current();
    }
  }, []);

  const togglePause = useCallback(() => {
    dispatch({ type: 'TOGGLE_PAUSE' });
  }, []);

  const resetInterview = useCallback(() => {
    dispatch({ type: 'RESET_ALL' });
  }, []);

  // Prevent accidental navigation mid-interview
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (
        state.phase === PHASES.ASKING ||
        state.phase === PHASES.LISTENING ||
        state.phase === PHASES.THINKING
      ) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state.phase]);

  return {
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
  };
}
