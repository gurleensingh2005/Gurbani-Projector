import { SEARCH_CONFIG } from "@/modules/gurbani/gurbani.constants";
import {
  fetchShabadById,
  searchShabadsForQuery,
} from "@/modules/gurbani/repositories/gurbani-mongo.repository";
import { getAcronym, getLatinAcronym, hindiToGurmukhi, filterKirtanFillers, isAcronymQuery } from "@/shared/utils/gurbani-text-normalizer";
import { filterSpeechNoise } from "@/modules/stt/services/stt-normalizer.service";
import { isPhoneticMatch } from "@/shared/utils/phonetic";
import { logger } from "@/core/logger/logger.service";
import { getCachedShabad, setCachedShabad } from "@/core/redis";
import {
  buildBroadMongoSearchText,
  buildLineDocsFromShabads,
  buildWindowDocs,
  clampContextLines,
  joinContextQuery,
  rankLinesWithFuse,
  rankWindowsWithFuseRaw,
  scoreFirstLetters,
  normalizeNakedGurmukhi,
  normalizeTranslitPhonetic,
  type FuseWindowDoc,
  type RawLineLike,
} from "@/modules/gurbani/services/fuse-matcher.service";

/**
 * Functional Business Logic Layer for Gurbani Line Matching and Shabad Discovery.
 * Matching is first-letter (acronym) based — not full pankti text.
 */

/** Score by first letter of each word (larivaar / Latin acronym). */
export const scoreLine = (
  query: string,
  lineGurmukhi: string,
  lineTranslit: string,
  lineLarivaar?: string
): number => {
  return scoreFirstLetters(query, lineGurmukhi, lineTranslit, lineLarivaar);
};

const extractLineTexts = (
  line: RawLineLike
): { gurmukhi: string; translit: string; larivaar: string } => {
  const core = line.verse && typeof line.verse === "object" ? line.verse : line;
  const gurmukhi = String(
    core.unicode || core.gurmukhi || core.text || line.gurmukhi || line.unicode || line.text || ""
  );
  let translit = "";
  if (typeof line.transliteration === "object" && line.transliteration) {
    translit = line.transliteration.english || "";
  } else if (typeof line.transliteration === "string") {
    translit = line.transliteration;
  }
  return { gurmukhi, translit, larivaar: String(line.larivaar || "") };
};

const safeStr = (val: unknown): string => {
  if (!val) return "";
  if (typeof val === "string") return val;
  if (typeof val === "object" && val !== null) {
    const o = val as Record<string, unknown>;
    return (
      (o.unicode as string) ||
      (o.default as string) ||
      (o.en as string) ||
      (o.hi as string) ||
      (o.pu as string) ||
      ""
    );
  }
  return "";
};

export type RawVerse = {
  verseId?: string | number;
  _id?: string | number;
  id?: string | number;
  verse?: { id?: string | number; unicode?: string; gurmukhi?: string; text?: string };
  unicode?: string;
  gurmukhi?: string;
  text?: string;
  transliteration?: string | { english?: string; hindi?: string; hi?: string };
  transliteration_hi?: string;
  translation?: string | {
    en?: { bdb?: string; ms?: string; ssk?: string };
    pu?: { ss?: { unicode?: string }; bdb?: { unicode?: string } };
    hi?: { ss?: string; sts?: string };
  };
  translation_pu?: string;
  translation_hi?: string;
  larivaar?: string;
};

export const mapVerse = (v: RawVerse, idx: number) => {
  const id = (v.verseId || v._id || v.id || v.verse?.id || idx).toString();
  const core = v.verse && typeof v.verse === "object" ? v.verse : v;
  const t = typeof v.translation === "object" && v.translation ? v.translation : {};
  const translit =
    typeof v.transliteration === "object"
      ? v.transliteration
      : { english: v.transliteration as string };
  const gurmukhi = safeStr(
    core.unicode || core.gurmukhi || core.text || v.gurmukhi || v.unicode || v.text
  );
  return {
    id,
    gurmukhi,
    transliteration:
      translit?.english || (typeof v.transliteration === "string" ? v.transliteration : "") || "",
    translation: safeStr(
      t && "en" in t ? t.en?.bdb || t.en?.ms || t.en?.ssk || t.en : v.translation
    ),
    translation_pu: safeStr(
      t && "pu" in t ? t.pu?.ss?.unicode || t.pu?.bdb?.unicode || t.pu : v.translation_pu
    ),
    translation_hi: safeStr(t && "hi" in t ? t.hi?.ss || t.hi?.sts || t.hi : v.translation_hi),
    transliteration_hi: safeStr(translit?.hindi || translit?.hi || v.transliteration_hi),
    larivaar: v.larivaar || getAcronym(gurmukhi) || "",
  };
};

export const sanitizeForTextSearch = (raw: string): string | null => {
  if (!raw) return null;
  const cleaned = raw.replace(/[${}]/g, "").replace(/(^|\s)-/g, "$1").trim();
  if (cleaned.length < SEARCH_CONFIG.MIN_QUERY_LENGTH || cleaned.length > 200) return null;
  return cleaned;
};

export type MatchResult = {
  line: ReturnType<typeof mapVerse>;
  shabadId: number;
  bani: string;
  page: number;
  lines: ReturnType<typeof mapVerse>[];
  score: number;
};

const toMatchResult = (
  shabad: Record<string, unknown>,
  lineIndex: number,
  score: number
): MatchResult | null => {
  const rawLines = (shabad.lines as RawVerse[]) || [];
  if (lineIndex < 0 || lineIndex >= rawLines.length) return null;
  const mappedLines = rawLines.map((l, idx) => mapVerse(l, idx));
  return {
    line: mappedLines[lineIndex],
    shabadId: (shabad.shabadId ?? shabad.id) as number,
    bani: shabad.bani as string,
    page: shabad.page as number,
    lines: mappedLines,
    score,
  };
};

const findShabadById = (
  shabadsArray: Array<Record<string, unknown>>,
  shabadId: number
): Record<string, unknown> | undefined => {
  return shabadsArray.find((s) => Number(s.shabadId ?? s.id) === shabadId);
};

/** Exact / prefix / substring fast-path (locked shabad only). */
const evaluateExactFastPath = (
  shabadsArray: Array<Record<string, unknown>>,
  query: string,
  activeIndex?: number
): MatchResult | null => {
  let best: MatchResult | null = null;
  let maxScore = 0;

  const isAcr = isAcronymQuery(query);

  for (const shbd of shabadsArray) {
    const rawLines = (shbd.lines as RawVerse[]) || [];
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const { gurmukhi, translit, larivaar } = extractLineTexts(line);
      
      let score = 0;
      if (isAcr) {
        score = scoreLine(query, gurmukhi, translit, larivaar);
        const isGurmukhi = /[\u0A00-\u0A7F]/.test(query);
        const acronym = isGurmukhi ? (larivaar || getAcronym(gurmukhi)) : getLatinAcronym(translit);
        
        if (score === 0 && isPhoneticMatch(query, acronym, isGurmukhi)) {
          score = 0.88 + SEARCH_CONFIG.PHONETIC_MATCH_BONUS;
        }
      } else {
        const isGurmukhi = /[\u0A00-\u0A7F]/.test(query);
        const normQuery = isGurmukhi ? normalizeNakedGurmukhi(query) : normalizeTranslitPhonetic(query);
        const normLine = isGurmukhi ? normalizeNakedGurmukhi(gurmukhi) : normalizeTranslitPhonetic(translit);
        const queryWords = normQuery.split(/\s+/).filter(Boolean);
        
        if (normLine === normQuery) {
          score = 0.95;
        } else if (queryWords.length >= 3 || normQuery.length >= 12) {
          if (normLine.startsWith(normQuery) || normLine.includes(normQuery)) {
            score = 0.95;
          }
        }
      }

      if (score > 0) {
        // Apply sequence bonus
        if (activeIndex !== undefined && activeIndex >= 0) {
          if (i === activeIndex + 1) {
            score = Math.min(1.0, score + SEARCH_CONFIG.SEQUENTIAL_NEXT_LINE_BONUS);
          } else if (i === activeIndex + 2) {
            score = Math.min(1.0, score + SEARCH_CONFIG.SEQUENTIAL_SKIP_LINE_BONUS);
          }
        }
      }

      if (score >= SEARCH_CONFIG.MIN_CONFIDENCE && score > maxScore) {
        maxScore = score;
        best = toMatchResult(shbd, i, score);
      }
    }
  }
  return best;
};

const applyWindowEndLineBonus = (
  windowDoc: FuseWindowDoc,
  shabad: Record<string, unknown>,
  spokenQuery: string,
  baseConfidence: number
): number => {
  let score = Math.min(1, baseConfidence + SEARCH_CONFIG.CONTEXT_ALIGN_BONUS);
  const rawLines = (shabad.lines as RawLineLike[]) || [];
  const endLine = rawLines[windowDoc.endLineIndex];
  if (!endLine) return score;

  const { gurmukhi, translit, larivaar } = extractLineTexts(endLine);
  const endAlign = scoreLine(spokenQuery, gurmukhi, translit, larivaar);
  // Bonus when spoken line is exact/prefix/substring of window end
  if (endAlign >= 0.95) {
    score = Math.min(1, score + SEARCH_CONFIG.CONTEXT_END_LINE_BONUS);
  } else if (endAlign >= 0.7) {
    score = Math.min(1, score + SEARCH_CONFIG.CONTEXT_END_LINE_BONUS * 0.5);
  }
  return score;
};

/** Locked-shabad path: exact fast-path, then Fuse line rank. */
export const evaluateLockedShabad = (
  shabadsArray: Array<Record<string, unknown>>,
  query: string,
  contextLines: string[] = [],
  currentLineId?: string | number | null
): MatchResult | null => {
  if (!shabadsArray?.length) return null;

  let activeIndex = -1;
  if (currentLineId !== undefined && currentLineId !== null) {
    const activeShabad = shabadsArray[0];
    if (activeShabad && Array.isArray(activeShabad.lines)) {
      activeIndex = activeShabad.lines.findIndex(
        (line: unknown, idx: number) => {
          const l = line as { id?: string | number; verseId?: string | number; _id?: string | number; verse?: { id?: string | number } };
          return (l.verseId || l._id || l.id || l.verse?.id || idx).toString() === currentLineId.toString();
        }
      );
    }
  }

  const exact = evaluateExactFastPath(shabadsArray, query, activeIndex);
  if (exact) return exact;

  // Prefer window when context available (same shabad, multi-line STT)
  if (contextLines.length >= SEARCH_CONFIG.CONTEXT_WINDOW_MIN) {
    const windowSize = Math.min(SEARCH_CONFIG.CONTEXT_WINDOW_SIZE, contextLines.length);
    const windowDocs = buildWindowDocs(shabadsArray, windowSize);
    const ctxQuery = joinContextQuery(contextLines);
    const windowHit = rankWindowsWithFuseRaw(ctxQuery, windowDocs);
    if (windowHit) {
      const shabad = findShabadById(shabadsArray, windowHit.doc.shabadId);
      if (shabad) {
        let score = applyWindowEndLineBonus(
          windowHit.doc,
          shabad,
          query,
          windowHit.confidence
        );

        if (activeIndex >= 0) {
          if (windowHit.doc.endLineIndex === activeIndex + 1) {
            score = Math.min(1.0, score + SEARCH_CONFIG.SEQUENTIAL_NEXT_LINE_BONUS);
          } else if (windowHit.doc.endLineIndex === activeIndex + 2) {
            score = Math.min(1.0, score + SEARCH_CONFIG.SEQUENTIAL_SKIP_LINE_BONUS);
          }
        }

        if (score >= SEARCH_CONFIG.MIN_CONFIDENCE) {
          logger.info(
            {
              event: "search_window_match",
              fuseScore: windowHit.fuseScore,
              confidence: score,
              phase: "locked_shabad",
              endLineIndex: windowHit.doc.endLineIndex,
              shabadId: windowHit.doc.shabadId,
            },
            "Fuse window match inside locked shabad"
          );
          return toMatchResult(shabad, windowHit.doc.endLineIndex, score);
        }
      }
    }
  }

  const lineDocs = buildLineDocsFromShabads(shabadsArray);
  const fuseHit = rankLinesWithFuse(query, lineDocs);
  if (!fuseHit) return null;

  const shabad = findShabadById(shabadsArray, fuseHit.doc.shabadId);
  if (!shabad) return null;

  let score = fuseHit.confidence;

  if (activeIndex >= 0) {
    if (fuseHit.doc.lineIndex === activeIndex + 1) {
      score = Math.min(1.0, score + SEARCH_CONFIG.SEQUENTIAL_NEXT_LINE_BONUS);
    } else if (fuseHit.doc.lineIndex === activeIndex + 2) {
      score = Math.min(1.0, score + SEARCH_CONFIG.SEQUENTIAL_SKIP_LINE_BONUS);
    }
  }

  if (contextLines.length >= SEARCH_CONFIG.CONTEXT_WINDOW_MIN) {
    const windowDocs = buildWindowDocs(shabadsArray, contextLines.length);
    const ctxQuery = joinContextQuery(contextLines);
    const windowHit = rankWindowsWithFuseRaw(ctxQuery, windowDocs);
    if (
      windowHit &&
      windowHit.doc.shabadId === fuseHit.doc.shabadId &&
      windowHit.doc.endLineIndex === fuseHit.doc.lineIndex
    ) {
      score = Math.min(1, score + SEARCH_CONFIG.CONTEXT_ALIGN_BONUS);
    }
  }

  if (score < SEARCH_CONFIG.MIN_CONFIDENCE) return null;

  logger.info(
    {
      event: "search_fuse_match",
      fuseScore: fuseHit.fuseScore,
      confidence: score,
      phase: "locked_shabad",
      lineIndex: fuseHit.doc.lineIndex,
      shabadId: fuseHit.doc.shabadId,
    },
    "Fuse line match inside locked shabad"
  );

  return toMatchResult(shabad, fuseHit.doc.lineIndex, score);
};

/** Single-line Fuse discovery with stricter cold-start gate. */
const evaluateDiscoverySingleLine = (
  shabadsArray: Array<Record<string, unknown>>,
  query: string,
  minConfidence: number
): MatchResult | null => {
  const lineDocs = buildLineDocsFromShabads(shabadsArray);
  const fuseHit = rankLinesWithFuse(query, lineDocs);
  if (!fuseHit) return null;
  if (fuseHit.confidence < minConfidence) {
    logger.info(
      {
        event: "search_single_line_rejected",
        confidence: fuseHit.confidence,
        minRequired: minConfidence,
        shabadId: fuseHit.doc.shabadId,
      },
      "Single-line discovery below threshold — holding"
    );
    return null;
  }

  const shabad = findShabadById(shabadsArray, fuseHit.doc.shabadId);
  if (!shabad) return null;

  logger.info(
    {
      event: "search_fuse_match",
      fuseScore: fuseHit.fuseScore,
      confidence: fuseHit.confidence,
      phase: "discovery_single",
      lineIndex: fuseHit.doc.lineIndex,
      shabadId: fuseHit.doc.shabadId,
    },
    "Fuse single-line discovery match"
  );

  return toMatchResult(shabad, fuseHit.doc.lineIndex, fuseHit.confidence);
};

/**
 * Discovery path: window Fuse first when context ≥ 2, then single-line fallback.
 * Window miss no longer hard-nulls.
 */
export const evaluateDiscovery = (
  shabadsArray: Array<Record<string, unknown>>,
  query: string,
  contextLines: string[]
): MatchResult | null => {
  if (!shabadsArray?.length) return null;

  const ctx = clampContextLines(contextLines.length ? contextLines : [query]);
  const useWindow = ctx.length >= SEARCH_CONFIG.CONTEXT_WINDOW_MIN;

  if (useWindow) {
    const windowSize = Math.min(SEARCH_CONFIG.CONTEXT_WINDOW_SIZE, ctx.length);
    const windowDocs = buildWindowDocs(shabadsArray, windowSize);
    const ctxQuery = joinContextQuery(ctx);
    const windowHit = rankWindowsWithFuseRaw(ctxQuery, windowDocs);

    if (windowHit) {
      const shabad = findShabadById(shabadsArray, windowHit.doc.shabadId);
      if (shabad) {
        const score = applyWindowEndLineBonus(
          windowHit.doc,
          shabad,
          query,
          windowHit.confidence
        );
        if (score >= SEARCH_CONFIG.DISCOVERY_WINDOW_MIN_CONFIDENCE) {
          logger.info(
            {
              event: "search_window_match",
              fuseScore: windowHit.fuseScore,
              confidence: score,
              phase: "discovery",
              startLineIndex: windowHit.doc.startLineIndex,
              endLineIndex: windowHit.doc.endLineIndex,
              shabadId: windowHit.doc.shabadId,
              windowSize,
            },
            "Fuse window match for discovery"
          );
          return toMatchResult(shabad, windowHit.doc.endLineIndex, score);
        }
        logger.info(
          {
            event: "search_window_weak",
            confidence: score,
            minRequired: SEARCH_CONFIG.DISCOVERY_WINDOW_MIN_CONFIDENCE,
            shabadId: windowHit.doc.shabadId,
          },
          "Window match below gate — falling back to single-line"
        );
      }
    }

    // Window weak/null → single-line fallback (use MIN_CONFIDENCE, not cold-start 0.78)
    return evaluateDiscoverySingleLine(
      shabadsArray,
      query,
      SEARCH_CONFIG.MIN_CONFIDENCE
    );
  }

  // Single-phrase cold start — stricter gate to avoid duplicate-line jumps
  return evaluateDiscoverySingleLine(
    shabadsArray,
    query,
    SEARCH_CONFIG.DISCOVERY_SINGLE_LINE_MIN_CONFIDENCE
  );
};

/** @deprecated Prefer evaluateLockedShabad / evaluateDiscovery — kept for callers. */
export const evaluateCandidates = (
  shabadsArray: Array<Record<string, unknown>>,
  query: string,
  contextLines: string[] = []
) => {
  if (contextLines.length >= SEARCH_CONFIG.CONTEXT_WINDOW_MIN) {
    return evaluateDiscovery(shabadsArray, query, contextLines);
  }
  return evaluateLockedShabad(shabadsArray, query, contextLines);
};

const preprocessQuery = (rawQuery: string | { unicode?: string; text?: string }): string => {
  let trimmed = (
    typeof rawQuery === "string" ? rawQuery : rawQuery?.unicode || rawQuery?.text || ""
  ).trim();

  if (/[ऀ-ॿ]/.test(trimmed)) {
    trimmed = hindiToGurmukhi(trimmed);
  }

  if (!/[਀-੿]/.test(trimmed)) {
    trimmed = filterSpeechNoise(trimmed);
  }

  trimmed = filterKirtanFillers(trimmed);
  
  return trimmed.replace(/\b(.+?)(?:\s+\1)+\b/gi, "$1").trim();
};

/**
 * Search waterfall (locked product flow):
 *
 * 1) FIRST / global discovery (no currentShabadId)
 *    → Mongo $text candidates → Fuse rank → store FULL shabad in Redis
 *
 * 2) SCROLLING (currentShabadId present)
 *    → Redis full shabad → match lines only (no Mongo text search)
 *    → Redis miss → rehydrate THAT shabad by id from Mongo → re-cache → match
 *    → Line still unmatched → global Mongo discovery (possible shabad change)
 */
export const executeSearch = async (
  rawQuery: string | { unicode?: string; text?: string },
  currentShabadId?: string | number | null,
  currentPage?: string | number | null,
  contextLinesInput?: string[] | null,
  currentLineId?: string | number | null
) => {
  const startTs = Date.now();
  const trimmed = preprocessQuery(rawQuery);
  const contextLines = clampContextLines(contextLinesInput);

  if (!trimmed || trimmed.length < SEARCH_CONFIG.MIN_QUERY_LENGTH) {
    return { error: "Phrase too short", status: 400 };
  }

  const sanitizedSearchText = sanitizeForTextSearch(trimmed);

  let bestMatch: MatchResult | null = null;
  let lockedMatch: MatchResult | null = null;
  let phase: "redis_shabad" | "mongo_rehydrate" | "discovery" = "discovery";
  const hasShabadContext =
    currentShabadId !== undefined && currentShabadId !== null && currentShabadId !== "";

  // ── SCROLLING PATH: Redis (then Mongo-by-id rehydrate) ──
  if (hasShabadContext) {
    const shabadKey = currentShabadId as string | number;
    let lockedPayload: {
      shabadId: string | number;
      bani: string;
      page?: number;
      lines: Array<Record<string, unknown>>;
    } | null = null;

    const cached = await getCachedShabad(shabadKey);
    if (cached) {
      phase = "redis_shabad";
      lockedPayload = cached;
      logger.info(
        { event: "search_redis_hit", shabadId: cached.shabadId },
        "Scrolling: full shabad loaded from Redis"
      );
    } else {
      // Redis miss / TTL — fetch the same shabad by id (not global text search)
      const numericId = Number(shabadKey);
      if (Number.isFinite(numericId)) {
        const fromMongo = await fetchShabadById(numericId);
        if (fromMongo && Array.isArray(fromMongo.lines) && fromMongo.lines.length > 0) {
          phase = "mongo_rehydrate";
          lockedPayload = {
            shabadId: (fromMongo.shabadId as number) ?? numericId,
            bani: String(fromMongo.bani ?? ""),
            page: typeof fromMongo.page === "number" ? fromMongo.page : undefined,
            lines: fromMongo.lines as Array<Record<string, unknown>>,
          };
          await setCachedShabad({
            id: lockedPayload.shabadId,
            bani: lockedPayload.bani,
            page: lockedPayload.page,
            lines: lockedPayload.lines,
          });
          logger.info(
            { event: "search_mongo_rehydrate", shabadId: lockedPayload.shabadId },
            "Scrolling: Redis miss — rehydrated shabad by id from Mongo and re-cached"
          );
        }
      }
      if (!lockedPayload) {
        logger.info(
          { event: "search_redis_miss", shabadId: currentShabadId },
          "Scrolling: shabad not in Redis/Mongo by id — will try global discovery"
        );
      }
    }

    if (lockedPayload) {
      lockedMatch = evaluateLockedShabad(
        [
          {
            shabadId: lockedPayload.shabadId,
            bani: lockedPayload.bani,
            page: lockedPayload.page,
            lines: lockedPayload.lines,
          },
        ],
        trimmed,
        contextLines,
        currentLineId
      );
      if (!lockedMatch) {
        logger.info(
          { event: "search_locked_line_miss", shabadId: lockedPayload.shabadId },
          "Line not in current shabad — falling back to global Mongo discovery"
        );
      }
    }
  }

  // Strong locked hit (same shabad scrolling) → skip Mongo. Weak/none → global search for NEW shabad.
  const lockedIsSticky =
    !!lockedMatch && lockedMatch.score >= SEARCH_CONFIG.MIN_CONFIDENCE;

  const queryWordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const canJumpToNewShabad = !hasShabadContext || queryWordCount >= SEARCH_CONFIG.MIN_QUERY_WORDS_JUMP_SHABAD;

  if (lockedIsSticky) {
    bestMatch = lockedMatch;
  } else if (lockedMatch) {
    // If we have a line match in current active Shabad, keep it unless query is long enough to jump
    bestMatch = lockedMatch;
  }

  if (!bestMatch && sanitizedSearchText && canJumpToNewShabad) {
    // ── GLOBAL DISCOVERY: naya shabad Redis mein nahi → Mongo se dhundo ──
    phase = "discovery";
    const searchText = buildBroadMongoSearchText(sanitizedSearchText);
    if (searchText) {
      // First-letter (larivaar) Mongo lookup; $text fallback if larivaar sparse
      const candidates = await searchShabadsForQuery(
        trimmed,
        searchText,
        SEARCH_CONFIG.MONGO_CANDIDATE_LIMIT
      );
      const discoveryContext = contextLines.length > 0 ? contextLines : [trimmed];
      const discoveryMatch = evaluateDiscovery(candidates, trimmed, discoveryContext);

      if (discoveryMatch) {
        const qualifiesToReplaceShabad =
          !hasShabadContext ||
          (discoveryMatch.score >= SEARCH_CONFIG.SWITCH_SHABAD_MIN_CONFIDENCE &&
            (!lockedMatch || discoveryMatch.score >= lockedMatch.score + SEARCH_CONFIG.PHASE_SWITCH_DELTA));

        if (qualifiesToReplaceShabad) {
          bestMatch = discoveryMatch;
          logger.info(
            {
              event: "search_global_discovery",
              shabadId: discoveryMatch.shabadId,
              score: discoveryMatch.score,
              replacedLocked: !!lockedMatch,
              lockedScore: lockedMatch?.score,
            },
            "Global Mongo discovery — new/better shabad for screen"
          );
        } else {
          bestMatch = lockedMatch;
        }
      } else {
        // Discovery miss — keep weak locked match if any (hold previous behaviour)
        bestMatch = lockedMatch;
      }
    } else {
      bestMatch = lockedMatch;
    }
  } else {
    bestMatch = lockedMatch;
  }

  const latencyMs = Date.now() - startTs;

  if (bestMatch) {
    const shabadPayload = {
      id: bestMatch.shabadId,
      bani: bestMatch.bani,
      page: bestMatch.page,
      lines: bestMatch.lines,
    };
    // Always cache full shabad so next scroll lines hit Redis
    await setCachedShabad(shabadPayload);
    logger.info(
      {
        event: "search_match",
        phase,
        score: bestMatch.score,
        latencyMs,
        lineId: bestMatch.line.id,
        shabadId: bestMatch.shabadId,
        contextLen: contextLines.length,
      },
      "Search match — full shabad stored in Redis"
    );
    return {
      match: bestMatch.line,
      matchedLine: bestMatch.line,
      shabad: shabadPayload,
      trimmed,
      fromRedisShabad: phase === "redis_shabad",
    };
  }

  logger.info(
    { event: "search_no_match", phase, latencyMs, contextLen: contextLines.length },
    "Search produced no match — frontend should hold previous line"
  );
  return { match: null, shabad: null, trimmed };
};
