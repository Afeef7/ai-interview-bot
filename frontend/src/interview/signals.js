/**
 * signals.js - Answer delivery signals: WPM, filler word count,
 * and emotion aggregation over the duration of a single answer.
 */

const FILLER_PATTERNS = [
  /\bum\b/gi,
  /\buh\b/gi,
  /\blike\b/gi,
  /\byou know\b/gi,
  /\bbasically\b/gi,
  /\bactually\b/gi
];

/**
 * Counts filler occurrences in the text.
 * @param {string} text 
 * @returns {number}
 */
export function countFillerWords(text) {
  if (!text || typeof text !== 'string') return 0;
  let count = 0;
  for (const regex of FILLER_PATTERNS) {
    const matches = text.match(regex);
    if (matches) {
      count += matches.length;
    }
  }
  return count;
}

/**
 * Calculates words-per-minute (WPM) given text and duration in milliseconds.
 * @param {string} text 
 * @param {number} durationMs 
 * @returns {number}
 */
export function calculateWpm(text, durationMs) {
  if (!text || durationMs <= 1000) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  const minutes = durationMs / 60000;
  return Math.round(words / minutes);
}

/**
 * Aggregates emotion samples and delivery metrics during an answer.
 */
export class AnswerSignalCollector {
  constructor() {
    this.reset();
  }

  reset() {
    this.startTime = null;
    this.endTime = null;
    this.emotionCounts = {};
    this.sampleCount = 0;
    this.active = false;
  }

  start() {
    this.reset();
    this.startTime = performance.now();
    this.active = true;
  }

  /**
   * Feed a sample from createEmotionTracker update callback.
   * @param {Object} sample 
   */
  addEmotionSample(sample) {
    if (!this.active || !sample || !sample.face || !sample.smoothed) return;

    const label = sample.smoothed.label;
    if (label) {
      this.emotionCounts[label] = (this.emotionCounts[label] || 0) + 1;
      this.sampleCount++;
    }
  }

  /**
   * Finalize metrics for the given answer text.
   * @param {string} answerText 
   * @returns {Object} Signals object conforming to backend schema
   */
  finish(answerText = '') {
    this.endTime = performance.now();
    this.active = false;

    const durationMs = this.startTime ? Math.max(0, this.endTime - this.startTime) : 0;
    const fillerCount = countFillerWords(answerText);
    const wpm = calculateWpm(answerText, durationMs);

    // Determine dominant emotion
    let dominantEmotion = null;
    let maxCount = 0;
    for (const [emotion, count] of Object.entries(this.emotionCounts)) {
      if (count > maxCount) {
        maxCount = count;
        dominantEmotion = emotion;
      }
    }

    return {
      confidence: null,
      dominant_emotion: dominantEmotion,
      filler_count: fillerCount,
      wpm: wpm || null,
      // Metadata for frontend UI inspection:
      durationSeconds: Math.round(durationMs / 1000),
      wordCount: answerText.trim().split(/\s+/).filter(Boolean).length,
      sampleCount: this.sampleCount
    };
  }
}
