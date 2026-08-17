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
    /** Rolling STT phrases for 2–3 line discovery context. */
    const contextBufferRef = useRef<string[]>([]);
    const lastShabadIdRef = useRef<string | number | null>(null);
    const lastSpeechAtRef = useRef<number>(0);

    const result = activeShabad && matchedLine ? { shabad: activeShabad, match: matchedLine } : null;

    useEffect(() => {
        resultRef.current = result;
    }, [result]);

    // Clear context buffer when shabad changes
    useEffect(() => {
        const id = activeShabad?.id ?? null;
        if (id !== lastShabadIdRef.current) {
            lastShabadIdRef.current = id;
            contextBufferRef.current = [];
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

    const resetPill = useCallback(() => {
        previousTranscriptRef.current = "";
        resetTranscript();
        dispatch(setCurrentSpeech(""));
        dispatch(setLastSearch(""));
    }, [resetTranscript, dispatch]);

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
                ignoreUntilRef.current = Date.now() + SEARCH_CONFIG.PATIENCE_AFTER_MATCH_MS;
                dispatch(setShabadResult({
                    shabad: currentResult.shabad,
                    match: localMatchResult.line,
                }));
                resetPill();
                return;
            }
        }

        if (abortControllerRef.current) abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();

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
                signal: abortControllerRef.current.signal
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
                    // Show full shabad + highlighted line on projector screen
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
            if (e.name !== 'AbortError') {
                dispatch(setSearchError("Connection error"));
                resetPill();
            }
        }
    }, [resetPill, dispatch, pushContextPhrase, clearContextBuffer]);

    useEffect(() => {
        if (!transcript || transcript === previousTranscriptRef.current) return;
        if (Date.now() < ignoreUntilRef.current) return;

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
        const currentResult = resultRef.current;
        const hasActiveShabad = !!currentResult?.shabad?.lines;

        if (hasActiveShabad) {
            const localMatchResult = attemptLocalMatch(
                cleanedChunk,
                currentResult,
                currentResult?.match?.id
            );
            if (localMatchResult && localMatchResult.confidence >= SEARCH_CONFIG.LOCAL_CACHE_THRESHOLD) {
                if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                lastSearchTimeRef.current = Date.now();
                ignoreUntilRef.current = Date.now() + SEARCH_CONFIG.PATIENCE_AFTER_MATCH_MS;
                dispatch(setShabadResult({
                    shabad: currentResult.shabad,
                    match: localMatchResult.line,
                }));
                resetPill();
                return;
            } else {
                // If local match fails (Pramaan line / foreign quote):
                // Reset STT pill after 3 words so buffer stays clean, but pin current Shabad on screen
                if (cleanedWc >= 3 && cleanedWc < SEARCH_CONFIG.MIN_QUERY_WORDS_JUMP_SHABAD) {
                    resetPill();
                    return;
                }
            }
        }

        // 2. Remote search in MongoDB:
        // - Cold start (no active Shabad): minimum 5 words (MIN_QUERY_WORDS_DISCOVERY)
        // - Active Shabad loaded: minimum 6 words (MIN_QUERY_WORDS_JUMP_SHABAD)
        const minWordsForRemote = hasActiveShabad
            ? SEARCH_CONFIG.MIN_QUERY_WORDS_JUMP_SHABAD
            : SEARCH_CONFIG.MIN_QUERY_WORDS_DISCOVERY;

        if (cleanedWc < minWordsForRemote) return;

        // Throttled search (max-wait) for continuous speech remote searches
        const now = Date.now();
        const timeSinceLastSearch = now - lastSearchTimeRef.current;
        const baseTimeoutMs = cleanedWc >= 5 ? SEARCH_CONFIG.DEBOUNCE_FAST_MS : SEARCH_CONFIG.DEBOUNCE_SLOW_MS;
        const shouldSearchImmediately = timeSinceLastSearch >= SEARCH_CONFIG.MAX_WAIT_SEARCH_MS;

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
