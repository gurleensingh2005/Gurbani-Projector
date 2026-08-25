import { useRef, useCallback } from "react";
import { SEARCH_CONFIG } from "@/modules/gurbani/gurbani.constants";

export type Tempo = "slow" | "medium" | "fast";

const { TEMPO_CONFIG } = SEARCH_CONFIG;

/**
 * Measures the Raagi's speaking pace in real-time and returns a stable
 * tempo classification ("slow" | "medium" | "fast").
 *
 * Algorithm:
 *  - On each new STT phrase, record (wordCount, timestamp).
 *  - Compute instantaneous WPS = words / seconds since previous phrase.
 *  - Maintain a capped rolling array of the last ROLLING_PHRASES samples.
 *  - Classify the rolling-average WPS against SLOW_MAX_WPS / FAST_MIN_WPS.
 *
 * This is a pure-logic hook with no React state — callers read tempo via
 * `getTempoTimings()` rather than subscribing to re-renders.
 */
export const useTempoDetector = () => {
    /** Rolling WPS samples */
    const samplesRef = useRef<number[]>([]);
    /** Timestamp of the last phrase that was fed in */
    const lastPhraseAtRef = useRef<number>(0);
    /** Cached classification — recomputed on each feed() call */
    const tempoRef = useRef<Tempo>("medium");

    /**
     * Feed a new transcript phrase into the detector.
     * Call this every time the STT transcript contains a new distinct phrase.
     *
     * @param wordCount Number of words in the current phrase.
     */
    const feed = useCallback((wordCount: number) => {
        const now = Date.now();
        const prev = lastPhraseAtRef.current;

        if (prev > 0 && wordCount > 0) {
            const elapsedSec = (now - prev) / 1000;
            // Clamp to a sane range — ignore super-short gaps (< 0.3 s) which
            // are usually STT chunking artefacts, and huge gaps (> 15 s) which
            // are pauses/alaap, not speaking pace.
            if (elapsedSec >= 0.3 && elapsedSec <= 15) {
                const wps = wordCount / elapsedSec;
                const samples = samplesRef.current;
                samples.push(wps);
                if (samples.length > TEMPO_CONFIG.ROLLING_PHRASES) {
                    samples.shift();
                }
            }
        }

        lastPhraseAtRef.current = now;

        // Recompute classification
        const samples = samplesRef.current;
        if (samples.length === 0) {
            tempoRef.current = "medium";
            return;
        }
        const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
        if (avg < TEMPO_CONFIG.SLOW_MAX_WPS) {
            tempoRef.current = "slow";
        } else if (avg > TEMPO_CONFIG.FAST_MIN_WPS) {
            tempoRef.current = "fast";
        } else {
            tempoRef.current = "medium";
        }
    }, []);

    /**
     * Reset detector state — call when listening stops or a new session begins.
     * Resets to medium so the next session starts with default timings.
     */
    const reset = useCallback(() => {
        samplesRef.current = [];
        lastPhraseAtRef.current = 0;
        tempoRef.current = "medium";
    }, []);

    /**
     * Returns the timing values for the current detected tempo.
     * Read this at the point-of-use (inside timer callbacks) so it always
     * reflects the most recent classification without needing re-renders.
     */
    const getTempoTimings = useCallback((): {
        silenceResetMs: number;
        strayWordClearMs: number;
        tempo: Tempo;
    } => {
        const t = tempoRef.current;
        const cfg =
            t === "slow"
                ? TEMPO_CONFIG.SLOW
                : t === "fast"
                ? TEMPO_CONFIG.FAST
                : TEMPO_CONFIG.MEDIUM;
        return {
            silenceResetMs: cfg.SILENCE_RESET_MS,
            strayWordClearMs: cfg.STRAY_CLEAR_MS,
            tempo: t,
        };
    }, []);

    return { feed, reset, getTempoTimings };
};
