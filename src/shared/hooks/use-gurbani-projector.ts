import { useEffect, useRef, useCallback } from "react";
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';
import { cleanTranscript, isProbableNoise, toGurmukhi, attemptLocalMatch } from "@/modules/gurbani/gurbani.helper";
import { SEARCH_CONFIG } from "@/modules/gurbani/gurbani.constants";
import { useAppDispatch, useAppSelector } from "@/store/store.hooks";
import { setShabadResult } from "@/store/slices/shabad.slice";
import { setActiveLineId } from "@/store/slices/projector.slice";
import { setCurrentSpeech, setLastSearch, setSearchError } from "@/store/slices/search.slice";

export const useGurbaniProjector = () => {
    const dispatch = useAppDispatch();
    const activeShabad = useAppSelector((state) => state.shabad.activeShabad);
    const matchedLine = useAppSelector((state) => state.shabad.matchedLine);
    const currentSpeech = useAppSelector((state) => state.search.currentSpeech);
    const lastSearch = useAppSelector((state) => state.search.lastSearch);
    const errorMessage = useAppSelector((state) => state.search.errorMessage);

    const activeLineRef = useRef<HTMLDivElement>(null);
    const previousTranscriptRef = useRef("");
    const abortControllerRef = useRef<AbortController | null>(null);
    const resultRef = useRef<{ shabad: any; match: any } | null>(null);
    const ignoreUntilRef = useRef<number>(0);
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastSearchTimeRef = useRef<number>(0);
    const isSearchingRef = useRef(false);
    /** Rolling STT phrases for 2–3 line discovery context. */
    const contextBufferRef = useRef<string[]>([]);
    const lastShabadIdRef = useRef<string | number | null>(null);
    const lastSpeechAtRef = useRef<number>(0);
    /**
     * Confirmation buffer: counts how many consecutive STT phrases have matched
     * the same candidate line. Only dispatch when count >= MIN_LINE_MATCH_CONFIRMATIONS.
     * Resets when a different line is matched or the shabad changes.
     */
    const pendingLineMatchRef = useRef<{
        lineId: string;
        line: any;
        shabad: any;
        count: number;
    } | null>(null);

    const result = activeShabad && matchedLine ? { shabad: activeShabad, match: matchedLine } : null;

    useEffect(() => {
        resultRef.current = result;
    }, [result]);

    // Clear context buffer and pending confirmation when shabad changes
    useEffect(() => {
        const id = activeShabad?.id ?? null;
        if (id !== lastShabadIdRef.current) {
            lastShabadIdRef.current = id;
            contextBufferRef.current = [];
            pendingLineMatchRef.current = null;
        }
    }, [activeShabad?.id]);

    const {
        transcript,
        listening,
        resetTranscript,
        browserSupportsSpeechRecognition,
    } = useSpeechRecognition();

    const scrollKey = `${result?.shabad?.id || 'none'}-${result?.match?.id || 'none'}`;
    useEffect(() => {
        if (!result?.match?.id) return;
        dispatch(setActiveLineId(result.match.id.toString()));
        const timer = setTimeout(() => {
            if (activeLineRef.current) {
                activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 150); 
        return () => clearTimeout(timer);
    }, [scrollKey, dispatch]);

    const clearContextBuffer = useCallback(() => {
        contextBufferRef.current = [];
    }, []);

    const pushContextPhrase = useCallback((phrase: string) => {
        const cleaned = phrase.trim();
        if (!cleaned) return;
        const buf = contextBufferRef.current;
        // Avoid duplicate consecutive pushes of the same phrase
        if (buf.length && buf[buf.length - 1] === cleaned) return;
        contextBufferRef.current = [...buf, cleaned].slice(-SEARCH_CONFIG.CONTEXT_WINDOW_SIZE);
        lastSpeechAtRef.current = Date.now();
    }, []);

    const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const resetPill = useCallback(() => {
        if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
        }
        previousTranscriptRef.current = "";
        resetTranscript();
        dispatch(setCurrentSpeech(""));
        dispatch(setLastSearch(""));
    }, [resetTranscript, dispatch]);

    /**
     * Vote-based confirmation gate for local line matches.
     * - If the matched line is the SAME as what's already displayed → dispatch immediately.
     * - If it's a different line → accumulate votes; only dispatch after MIN_LINE_MATCH_CONFIRMATIONS.
     * - If the new match is a different candidate than the pending one → reset the counter.
     * Returns true if it dispatched (caller should return early).
     */
    const tryConfirmLocalMatch = useCallback((
        localMatchResult: { line: any; confidence: number },
        currentResult: { shabad: any; match: any } | null
    ): boolean => {
        if (!localMatchResult?.line) return false;

        const candidateId = String(localMatchResult.line.id ?? "");
        const currentLineId = String(currentResult?.match?.id ?? "");

        // Same line re-spoken → dispatch immediately, no confirmation needed
        if (candidateId && candidateId === currentLineId) {
            pendingLineMatchRef.current = null;
            return false; // let caller dispatch normally
        }

        const pending = pendingLineMatchRef.current;
        if (pending && pending.lineId === candidateId) {
            pending.count += 1;
            if (pending.count >= SEARCH_CONFIG.MIN_LINE_MATCH_CONFIRMATIONS) {
                // Confirmed — commit the jump
                pendingLineMatchRef.current = null;
                ignoreUntilRef.current = Date.now() + SEARCH_CONFIG.PATIENCE_AFTER_MATCH_MS;
                dispatch(setShabadResult({
                    shabad: pending.shabad ?? currentResult?.shabad,
                    match: pending.line,
                }));
                resetPill();
                return true;
            }
            // Not yet confirmed — hold
            return true;
        }

        // New candidate — start fresh vote
        pendingLineMatchRef.current = {
            lineId: candidateId,
            line: localMatchResult.line,
            shabad: currentResult?.shabad,
            count: 1,
        };
        return true; // hold until confirmed
    }, [dispatch, resetPill]);

    const searchLine = useCallback(async (spokenText: string) => {
        let fullText = cleanTranscript(spokenText);
        const wc = fullText ? fullText.split(/\s+/).filter(Boolean).length : 0;
        
        if (!fullText || wc < SEARCH_CONFIG.MIN_QUERY_WORDS_DISCOVERY) return;

        // Long silence → drop stale context so we don't glue unrelated phrases
        if (
            lastSpeechAtRef.current &&
            Date.now() - lastSpeechAtRef.current > SEARCH_CONFIG.ALAAP_PROTECTION_TIMEOUT_MS
        ) {
            clearContextBuffer();
        }

        pushContextPhrase(fullText);
        const contextLines = [...contextBufferRef.current];

        const currentResult = resultRef.current;

        if (currentResult?.shabad?.lines) {
            const localMatchResult = attemptLocalMatch(
                fullText, 
                currentResult, 
                currentResult?.match?.id
            );

            if (localMatchResult && localMatchResult.confidence >= SEARCH_CONFIG.LOCAL_CACHE_THRESHOLD) {
                const held = tryConfirmLocalMatch(localMatchResult, currentResult);
                if (held) return;
                // Same line — dispatch immediately
                ignoreUntilRef.current = Date.now() + SEARCH_CONFIG.PATIENCE_AFTER_MATCH_MS;
                dispatch(setShabadResult({
                    shabad: currentResult.shabad,
                    match: localMatchResult.line,
                }));
                resetPill();
                return;
            }
        }

        if (isSearchingRef.current) return;
        isSearchingRef.current = true;

        try {
            const res = await fetch("/api/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    query: fullText,
                    contextLines,
                    currentShabadId: currentResult?.shabad?.id ?? null,
                    currentLineId: currentResult?.match?.id ?? null,
                    currentPage: currentResult?.shabad?.page ?? null
                }),
            });

            if (res.ok) {
                const data = await res.json();
                if (data.match && data.shabad) {
                    const prevId = currentResult?.shabad?.id;
                    const nextId = data.shabad?.id;
                    if (prevId != null && nextId != null && String(prevId) !== String(nextId)) {
                        // New shabad from Mongo discovery — reset context for new shabad
                        contextBufferRef.current = [fullText];
                    }
                    ignoreUntilRef.current = Date.now() + SEARCH_CONFIG.PATIENCE_AFTER_MATCH_MS;
                    // Show full shabad + highlighted line on projector screen IMMEDIATELY
                    dispatch(setShabadResult({ shabad: data.shabad, match: data.match }));
                    dispatch(setSearchError(""));
                    resetPill();
                } else {
                    resetPill();
                    // Keep previous shabad on screen; do not clear UI
                    dispatch(setSearchError(""));
                }
            } else {
                dispatch(setSearchError("Search failed"));
            }
        } catch (e: any) {
            dispatch(setSearchError("Connection error"));
            resetPill();
        } finally {
            isSearchingRef.current = false;
        }
    }, [resetPill, dispatch, pushContextPhrase, clearContextBuffer]);

    useEffect(() => {
        if (!transcript || transcript === previousTranscriptRef.current) return;
        if (Date.now() < ignoreUntilRef.current) return;

        const currentResult = resultRef.current;
        const hasActiveShabad = !!currentResult?.shabad?.lines;

        // Silence timer: different behavior for locked shabad vs cold start
        if (hasActiveShabad) {
            // Locked shabad — only reset the pill and clear stale context.
            // Do NOT trigger a remote search here; local matching handles line tracking.
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            // If only 1 stray word landed on the pill (e.g. a trailing syllable
            // separated by STT), clear it fast so it doesn't pollute the next line match.
            const incomingWordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
            const silenceMs = incomingWordCount <= 1
                ? SEARCH_CONFIG.STRAY_WORD_FAST_CLEAR_MS
                : SEARCH_CONFIG.SPEECH_SILENCE_RESET_MS;
            silenceTimerRef.current = setTimeout(() => {
                // Clear stale context so the next phrase doesn't get biased
                // toward the old shabad's words.
                contextBufferRef.current = [];
                pendingLineMatchRef.current = null;
                resetPill();
            }, silenceMs);
        } else {
            // Cold start — speaker paused before reaching 8 words.
            // Fire a search with whatever was spoken so we still discover
            // the shabad even when lines are short.
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = setTimeout(() => {
                const lastSpoken = previousTranscriptRef.current?.replace(/\s+/g, " ").trim();
                if (lastSpoken) {
                    // searchLine's own MIN_QUERY_WORDS_DISCOVERY (5-word) guard applies.
                    searchLine(lastSpoken);
                }
                resetPill();
            }, SEARCH_CONFIG.SPEECH_SILENCE_RESET_MS);
        }

        previousTranscriptRef.current = transcript;
        const normalized = transcript.replace(/\s+/g, " ").trim();
        
        if (!normalized || isProbableNoise(normalized)) return;

        const words = normalized.split(/\s+/).filter(Boolean);
        const currentWc = words.length;
        dispatch(setLastSearch(toGurmukhi(normalized)));
        dispatch(setCurrentSpeech(normalized));
        
        const chunkToSearch = currentWc > SEARCH_CONFIG.ROLLING_WINDOW_WORDS
            ? words.slice(-SEARCH_CONFIG.ROLLING_WINDOW_WORDS).join(" ")
            : normalized;
        
        const isGurmukhiText = /[\u0A00-\u0A7F]/.test(chunkToSearch);
        const noiseSyllables = /^(dha|tin|tun|dhin|da|ki|ta|na|ge|ne|ti)$/i;
        const cleanedChunk = isGurmukhiText ? chunkToSearch : chunkToSearch.split(" ").filter(w => !noiseSyllables.test(w)).join(" ");
        const cleanedWc = cleanedChunk.split(" ").filter(Boolean).length;

        if (cleanedWc < 2) return;

        // 1. Immediate local matching if active Shabad is present (0ms delay)
        if (hasActiveShabad) {
            const localMatchResult = attemptLocalMatch(
                cleanedChunk,
                currentResult,
                currentResult?.match?.id
            );
            if (localMatchResult && localMatchResult.confidence >= SEARCH_CONFIG.LOCAL_CACHE_THRESHOLD) {
              const held = tryConfirmLocalMatch(localMatchResult, currentResult);
                if (held) {
                    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                    lastSearchTimeRef.current = Date.now();
                    return;
                }
                // Same line — dispatch immediately
                if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                lastSearchTimeRef.current = Date.now();
                ignoreUntilRef.current = Date.now() + SEARCH_CONFIG.PATIENCE_AFTER_MATCH_MS;
                dispatch(setShabadResult({
                    shabad: currentResult.shabad,
                    match: localMatchResult.line,
                }));
                resetPill();
                return;
            }
        }

        // 2. Remote search in MongoDB:
        // - Cold start (no active Shabad): wait for MIN_QUERY_WORDS_DISCOVERY_CONTINUOUS (8)
        //   words of continuous speech before searching. A long silence with fewer words
        //   is handled by the cold-start silence timer above.
        // - Active Shabad locked: minimum MIN_QUERY_WORDS_JUMP_SHABAD (6) words.
        //   This path is UNCHANGED from original behavior.
        const minWordsForRemote = hasActiveShabad
            ? SEARCH_CONFIG.MIN_QUERY_WORDS_JUMP_SHABAD
            : SEARCH_CONFIG.MIN_QUERY_WORDS_DISCOVERY_CONTINUOUS;

        if (cleanedWc < minWordsForRemote) return;

        // Throttled search (max-wait) for continuous speech remote searches
        const now = Date.now();
        const timeSinceLastSearch = now - lastSearchTimeRef.current;
        const baseTimeoutMs = cleanedWc >= 5 ? SEARCH_CONFIG.DEBOUNCE_FAST_MS : SEARCH_CONFIG.DEBOUNCE_SLOW_MS;

        // Force immediate search if:
        // 1. Time since last search >= MAX_WAIT_SEARCH_MS  (original behavior — unchanged)
        // 2. Cold start and continuous speech reached 8+ words
        const isColdStart = !hasActiveShabad;
        const forceColdStartImmediate = isColdStart && cleanedWc >= SEARCH_CONFIG.MAX_CONTINUOUS_WORDS_FORCE_SEARCH;
        const shouldSearchImmediately = forceColdStartImmediate || timeSinceLastSearch >= SEARCH_CONFIG.MAX_WAIT_SEARCH_MS;

        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

        if (shouldSearchImmediately) {
            lastSearchTimeRef.current = now;
            searchLine(cleanedChunk);
        } else {
            const delay = Math.min(baseTimeoutMs, Math.max(50, SEARCH_CONFIG.MAX_WAIT_SEARCH_MS - timeSinceLastSearch));
            searchDebounceRef.current = setTimeout(() => {
                lastSearchTimeRef.current = Date.now();
                searchLine(cleanedChunk);

                setTimeout(() => {
                    const latest = transcript.replace(/\s+/g, " ").trim();
                    if (latest === normalized && cleanedWc < 3) {
                        resetPill();
                    }
                }, SEARCH_CONFIG.ALAAP_PROTECTION_TIMEOUT_MS);
            }, delay);
        }

    }, [transcript, searchLine, resetPill, dispatch]);

    const startListening = useCallback(() => {
        if (!browserSupportsSpeechRecognition) {
            dispatch(setSearchError("Voice Search not supported"));
            return;
        }
        try {
            SpeechRecognition.startListening({ continuous: true, language: 'pa-IN' });
            dispatch(setSearchError(""));
        } catch (e: any) {
            dispatch(setSearchError("Mic Error: " + e.message));
        }
    }, [browserSupportsSpeechRecognition, dispatch]);

    const stopListening = useCallback(() => {
        SpeechRecognition.stopListening();
        clearContextBuffer();
        resetPill();
    }, [resetPill, clearContextBuffer]);

    const setResult = useCallback((res: any) => {
        if (!res) {
            clearContextBuffer();
            dispatch(setShabadResult(null));
            resetPill();
        } else if (res.shabad && res.match) {
            const prevId = resultRef.current?.shabad?.id;
            const nextId = res.shabad?.id;
            if (prevId != null && nextId != null && String(prevId) !== String(nextId)) {
                clearContextBuffer();
            }
            dispatch(setShabadResult({ shabad: res.shabad, match: res.match }));
            resetPill();
        }
    }, [dispatch, clearContextBuffer, resetPill]);

    return {
        result,
        setResult,
        errorMessage,
        listening,
        transcript,
        currentSpeech,
        lastSearch,
        activeLineRef,
        startListening,
        stopListening,
        searchLine,
        browserSupportsSpeechRecognition
    };
};
