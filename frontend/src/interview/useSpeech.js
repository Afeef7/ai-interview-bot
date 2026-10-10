import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Custom hook providing Text-to-Speech (TTS), Speech-to-Text (STT),
 * silence detection, and microphone audio level monitoring.
 */
export function useSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [micBlocked, setMicBlocked] = useState(false);
  const [micVolume, setMicVolume] = useState(0); // 0 - 100 for level meter

  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const finalTranscriptRef = useRef('');
  const intentionalStopRef = useRef(false);

  // AudioContext & Analyser refs for volume metering
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const micStreamRef = useRef(null);
  const animFrameRef = useRef(null);

  const isSttSupported = typeof window !== 'undefined' &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  const isTtsSupported = typeof window !== 'undefined' &&
    Boolean(window.speechSynthesis);

  // -------------------------------------------------------------------------
  // Text-to-Speech (TTS)
  // -------------------------------------------------------------------------
  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  /** Returns a promise resolving to the list of available voices. */
  const getVoicesAsync = useCallback(() => {
    return new Promise((resolve) => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        resolve(voices);
        return;
      }
      // Chrome loads voices asynchronously — wait for the event
      const onVoicesChanged = () => {
        window.removeEventListener('voiceschanged', onVoicesChanged);
        resolve(window.speechSynthesis.getVoices());
      };
      window.speechSynthesis.addEventListener
        ? window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged)
        : window.addEventListener('voiceschanged', onVoicesChanged);
      // Fallback: resolve after 1.5s even if event never fires
      setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1500);
    });
  }, []);

  const speak = useCallback(async (text, onEnd = null) => {
    if (!text || !isTtsSupported) {
      if (onEnd) onEnd();
      return;
    }

    stopSpeaking();

    // Chrome bug workaround: resume if paused
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    // Pick a natural English voice if available
    const voices = await getVoicesAsync();
    const preferredVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha')));
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.onstart = () => {
      setIsSpeaking(true);
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      if (onEnd) onEnd();
    };

    utterance.onerror = (err) => {
      console.warn('[useSpeech] TTS error:', err);
      setIsSpeaking(false);
      if (onEnd) onEnd();
    };

    window.speechSynthesis.speak(utterance);
  }, [isTtsSupported, stopSpeaking]);

  const testVoice = useCallback(() => {
    speak('Welcome to MockMate. Your audio is loud and clear.');
  }, [speak]);

  // -------------------------------------------------------------------------
  // Speech-to-Text (STT) + 3s Silence Detector
  // -------------------------------------------------------------------------
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    intentionalStopRef.current = true;
    clearSilenceTimer();

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore already stopped
      }
      recognitionRef.current = null;
    }

    setIsListening(false);
    setInterimTranscript('');
  }, [clearSilenceTimer]);

  const startListening = useCallback(({ onSilenceTimeout, initialText = '' } = {}) => {
    if (!isSttSupported) {
      console.warn('[useSpeech] Web Speech API not supported in this browser.');
      return;
    }

    stopListening();
    intentionalStopRef.current = false;
    finalTranscriptRef.current = initialText;
    setTranscript(initialText);
    setInterimTranscript('');
    setMicBlocked(false);

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      let currentFinal = finalTranscriptRef.current;
      let currentInterim = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        if (item.isFinal) {
          currentFinal += (currentFinal ? ' ' : '') + item[0].transcript.trim();
        } else {
          currentInterim += item[0].transcript;
        }
      }

      finalTranscriptRef.current = currentFinal;
      const combined = currentFinal + (currentInterim ? ' ' + currentInterim : '');
      setTranscript(combined.trim());
      setInterimTranscript(currentInterim);

      // Silence detection: reset timer whenever new speech is heard
      clearSilenceTimer();
      const words = combined.trim().split(/\s+/).filter(Boolean).length;
      if (words >= 3 && onSilenceTimeout) {
        silenceTimerRef.current = setTimeout(() => {
          console.log('[useSpeech] 3s silence detected after sufficient words spoken.');
          onSilenceTimeout(combined.trim());
        }, 3000);
      }
    };

    recognition.onerror = (event) => {
      console.warn('[useSpeech] Recognition error:', event.error);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setMicBlocked(true);
      }
      if (event.error !== 'no-speech') {
        // no-speech is transient and normal
      }
    };

    recognition.onend = () => {
      if (!intentionalStopRef.current) {
        // Attempt restart if connection dropped unintentionally while still in listening state
        try {
          recognition.start();
        } catch {
          setIsListening(false);
        }
      } else {
        setIsListening(false);
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      console.error('[useSpeech] Failed to start recognition:', err);
      setIsListening(false);
    }
  }, [isSttSupported, stopListening, clearSilenceTimer]);

  // -------------------------------------------------------------------------
  // Mic Volume Meter
  // -------------------------------------------------------------------------
  const startMicMeter = useCallback((stream) => {
    try {
      stopMicMeter();
      micStreamRef.current = stream;

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;

      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateMeter = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        // Map 0-128 to 0-100%
        const normalized = Math.min(100, Math.round((avg / 64) * 100));
        setMicVolume(normalized);

        animFrameRef.current = requestAnimationFrame(updateMeter);
      };

      updateMeter();
    } catch (err) {
      console.warn('[useSpeech] Could not start mic meter:', err);
    }
  }, []);

  const stopMicMeter = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setMicVolume(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSpeaking();
      stopListening();
      stopMicMeter();
    };
  }, [stopSpeaking, stopListening, stopMicMeter]);

  return {
    isSpeaking,
    speak,
    stopSpeaking,
    testVoice,
    isListening,
    transcript,
    setTranscript,
    interimTranscript,
    startListening,
    stopListening,
    clearSilenceTimer,
    micBlocked,
    micVolume,
    startMicMeter,
    stopMicMeter,
    isSttSupported,
    isTtsSupported
  };
}
