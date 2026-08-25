import { SEARCH_CONFIG } from "@/modules/gurbani/gurbani.constants";
import {
    buildLineDocsFromShabads,
    rankAllLinesWithFuse,
    scoreFirstLetters,
} from "@/modules/gurbani/services/fuse-matcher.service";
import {
    matras,
    MATRAS_REGEX,
    DIACRITICS_ACCENTS_REGEX,
    SPECIAL_GURMUKHI_CHARS_REGEX,
    MULTI_SPACE_REGEX,
    CLEAN_TRANSCRIPT_PUNCTUATION_REGEX,
    CLEAN_ACRONYM_PUNCTUATION_REGEX,
    HEADING_GURMUKHI_REGEX,
    HEADING_TRANSLIT_REGEX,
    DANDA_REGEX,
    DIACRITICS_MAP,
    HINDI_TO_GURMUKHI_MAP,
    CONSONANTS,
    VOWEL_SIGNS,
    INDEPENDENT_VOWELS,
    MODIFIERS,
    PHONETIC_MAPS,
    ENGLISH_ACRONYM_MAP,
} from "./gurbani-text-normalizer.constants";

export { matras };

export const stripMatras = (text: string): string => {
    if (!text) return "";
    return text.replace(MATRAS_REGEX, "");
};

export const stripDiacritics = (text: string): string => {
    if (!text) return "";
    return text
        .normalize("NFD")
        .replace(DIACRITICS_ACCENTS_REGEX, "")
        .replace(/[ẖṯṣṛṇḍ]/g, (m) => DIACRITICS_MAP[m] || m)
        .toLowerCase();
};

export const normalizeGurbani = (text: string): string => {
    return text.replace(SPECIAL_GURMUKHI_CHARS_REGEX, "").replace(MULTI_SPACE_REGEX, " ").trim();
};

export const hindiToGurmukhi = (text: string): string => {
    if (!text) return "";
    let result = "";
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        result += HINDI_TO_GURMUKHI_MAP[char] || char;
    }
    return result;
};

export const gurmukhiToEnglish = (text: string): string => {
    if (!text) return "";
    const isConsonant = (ch: string) => ch in CONSONANTS;
    const isVowelSign = (ch: string) => ch in VOWEL_SIGNS;
    const chars = [...text];
    let result = "";

    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        const next = chars[i + 1] || "";
        if (ch === ' ' || ch === '\t' || ch === '\n') {
            result += " ";
        } else if (ch === 'ਸ਼' || (ch === 'ਸ' && next === '਼')) {
            result += "sh";
            if (next === '਼') i++;
            if (next && !isVowelSign(next) && next !== ' ' && isConsonant(next)) result += "a";
        } else if (INDEPENDENT_VOWELS[ch]) {
            result += INDEPENDENT_VOWELS[ch];
        } else if (isConsonant(ch)) {
            result += CONSONANTS[ch];
            if (next && !isVowelSign(next) && !['ੱ','਼','ੰ','ਂ'].includes(next) && (isConsonant(next) || next === ' ')) result += "a";
        } else if (isVowelSign(ch)) {
            result += VOWEL_SIGNS[ch];
        } else if (MODIFIERS[ch] !== undefined) {
            result += MODIFIERS[ch];
        } else {
            result += ch;
        }
    }
    return result.replace(MULTI_SPACE_REGEX, ' ').trim();
};

export const toGurmukhi = (text: string): string => {
    if (!text) return "";
    let res = text.toLowerCase().trim();
    for (const [en, gur] of PHONETIC_MAPS) {
        if (res.includes(en)) {
            res = res.split(en).join(gur);
        }
    }
    return res;
};

export const englishToGurmukhi = (text: string): string => {
    return text.split(" ").map(w => toGurmukhi(w)).join(" ");
};

export const isSimranTrigger = (text: string): boolean => {
    const t = text.toLowerCase();
    return t.includes("waheguru") || t.includes("ਵਾਹਿਗੁਰੂ") || t.includes("simran") || t.includes("ਸਿਮਰਨ") || t.includes("w w w");
};

/** First letter of each Gurmukhi word (stored as lines[].larivaar on import). */
export const getAcronym = (text: string): string => {
    if (!text) return "";
    const cleaned = text.replace(CLEAN_ACRONYM_PUNCTUATION_REGEX, "");
    return cleaned
        .split(MULTI_SPACE_REGEX)
        .filter(Boolean)
        .map(w => w[0])
        .filter(c => /[\u0A00-\u0A7Fੴ]/.test(c))
        .join("");
};

/**
 * Sanitizes a raw gurmukhi string from BaniDB before storing to MongoDB.
 *
 * Retains:
 *  - Gurmukhi Unicode block (U+0A00–U+0A7F), including ੴ (Ik Onkar, U+0A74)
 *  - Gurmukhi digits (੦–੯ are already in the block above)
 *  - Danda / Double Danda (।॥ U+0964–U+0965)
 *  - Pipe separator (|) and double-pipe (||) used in SGGS lines
 *  - Whitespace (spaces, tabs, newlines — normalised to single space)
 *
 * Strips:
 *  - Emoji and decorative symbols (e.g. ❁ U+2741)
 *  - ASCII/Latin characters and parenthetical annotations like (੫੬) or (Pause)
 *  - Any character outside the allowed sets above
 *
 * Returns empty string if nothing valid remains after sanitization.
 */
export const sanitizeGurmukhiText = (text: string): string => {
    if (!text) return "";
    // Allow: Gurmukhi block + danda/double-danda + pipe + whitespace
    const sanitized = text
        .replace(/[^\u0A00-\u0A7F\u0964\u0965|\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return sanitized;
};

export const englishAcronymToGurmukhiRegex = (acronym: string): string => {
    const clean = acronym.toLowerCase().replace(/[^a-z]/g, "");
    if (!clean) return "";

    let regexStr = "^";
    for (let i = 0; i < clean.length; i++) {
        const char = clean[i];
        regexStr += ENGLISH_ACRONYM_MAP[char] || char;
    }
    return regexStr;
};

/** Does Latin acronym align with Gurmukhi larivaar (prefix)? */
export const latinAcronymMatchesLarivaar = (
    latinAcronym: string,
    larivaar: string
): { match: boolean; prefix: boolean; exact: boolean } => {
    const lat = (latinAcronym || "").toLowerCase().replace(/[^a-z]/g, "");
    const gur = (larivaar || "").replace(/\s+/g, "");
    if (!lat || !gur || lat.length > gur.length) {
        return { match: false, prefix: false, exact: false };
    }
    for (let i = 0; i < lat.length; i++) {
        const pattern = ENGLISH_ACRONYM_MAP[lat[i]];
        if (!pattern) return { match: false, prefix: false, exact: false };
        if (!new RegExp(`^${pattern}$`).test(gur[i])) {
            return { match: false, prefix: false, exact: false };
        }
    }
    return {
        match: true,
        prefix: lat.length < gur.length,
        exact: lat.length === gur.length,
    };
};

export const cleanTranscript = (text: string): string => text.toLowerCase().replace(CLEAN_TRANSCRIPT_PUNCTUATION_REGEX, "").replace(MULTI_SPACE_REGEX, " ").trim();

/** First letter of each Latin/translit word — e.g. "mere sahiba tu" → "mst". */
export const getLatinAcronym = (text: string): string => {
    if (!text) return "";
    const cleaned = cleanTranscript(stripDiacritics(text));
    return cleaned
        .split(MULTI_SPACE_REGEX)
        .filter(Boolean)
        .map((w) => w[0])
        .filter((c) => /[a-z]/i.test(c))
        .join("")
        .toLowerCase();
};

/** Query → first-letter string (Gurmukhi or Latin depending on script). */
export const getQueryAcronym = (query: string): string => {
    const q = (query || "").trim();
    if (!q) return "";
    if (/[\u0A00-\u0A7F]/.test(q)) return getAcronym(q);
    return getLatinAcronym(q);
};

export const isProbableNoise = (text: string): boolean => {
    if (!text) return true;
    const clean = text.trim();
    if (clean.length < 3) return true;
    const words = clean.split(MULTI_SPACE_REGEX);
    if (words.length <= 1 && clean.length < 4) return true;
    if (words.length >= 3 && new Set(words).size === 1) return true;
    return /^[.,!\s\d]+$/.test(clean);
};

export const isLikelyShabadHeadingLine = (line: any): boolean => {
    const g = (line?.gurmukhi || "").trim();
    if (HEADING_GURMUKHI_REGEX.test(g)) return true;
    const t = cleanTranscript(stripDiacritics(line.transliteration || ""));
    if (HEADING_TRANSLIT_REGEX.test(t)) return true;
    return false;
};

const normalizeLineGurmukhiForMatch = (g: string) =>
    cleanTranscript(normalizeGurbani(stripMatras((g || "").replace(DANDA_REGEX, " "))));

export const attemptLocalMatch = (
    query: string,
    currentShabad: any,
    activeLineId?: string | number
) => {
    if (!currentShabad?.shabad?.lines) return null;

    const raw = query.trim();
    const hasGurmukhi = /[\u0A00-\u0A7F]/.test(raw);
    const cleanLatin = cleanTranscript(stripDiacritics(hasGurmukhi ? "" : raw));
    const cleanGurmukhi = hasGurmukhi ? normalizeLineGurmukhiForMatch(raw) : "";
    const latinFromGurmukhi = hasGurmukhi
        ? cleanTranscript(stripDiacritics(gurmukhiToEnglish(normalizeGurbani(raw))))
        : "";

    const queryForTranslit = cleanLatin || latinFromGurmukhi;
    if (!queryForTranslit && !cleanGurmukhi) return null;

    const lines = currentShabad.shabad.lines;
    const activeIndex = lines.findIndex((line: any) => line.id?.toString() === activeLineId?.toString());

    let maxScore: number = activeIndex >= 0
        ? SEARCH_CONFIG.LOCAL_THRESHOLD_WITH_CONTEXT
        : SEARCH_CONFIG.LOCAL_THRESHOLD_NO_CONTEXT;

    const getForwardDistance = (idx: number) => {
        if (activeIndex < 0) return 0;
        if (idx >= activeIndex) return idx - activeIndex;
        return lines.length - activeIndex + idx;
    };

    const qAcrLen = getQueryAcronym(raw).length;
    const queryWordCount = raw.split(/\s+/).filter(Boolean).length;

    // Require at least 3 words or 3 acronym letters before allowing ANY line change.
    // "tere" (1 word) or "sant tere" (2 words) are too ambiguous when multiple
    // lines share the same word — hold the current line.
    if (queryWordCount < 3 && qAcrLen < 3) return null;

    const substantiveQuery = qAcrLen >= 3 || queryWordCount >= 3;

    // 1) First-letter (acronym) score on each line + proximity
    let best: any = null;
    for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        const forwardDistance = getForwardDistance(idx);

        // Non-substantive queries (barely 3 words) can only progress to the very next line
        if (!substantiveQuery && activeIndex >= 0) {
            if (forwardDistance > 1) continue;
        }

        const proximityBonus = activeIndex >= 0
            ? Math.max(0, SEARCH_CONFIG.PROXIMITY_BONUS_MAX - forwardDistance * SEARCH_CONFIG.PROXIMITY_DECAY_PER_LINE)
            : 0;

        let baseScore = scoreFirstLetters(
            raw,
            line.gurmukhi || "",
            line.transliteration || "",
            line.larivaar || ""
        );
        if (baseScore <= 0) continue;
        let score = baseScore;
        if (baseScore >= 0.70) {
            score += proximityBonus;
        }

        if (isLikelyShabadHeadingLine(line) && substantiveQuery) {
            score -= SEARCH_CONFIG.HEADING_PENALTY;
        }

        if (activeIndex >= 0 && idx < activeIndex && score < 0.98) {
            score -= SEARCH_CONFIG.BACKWARD_PENALTY;
        }

        if (score > maxScore) {
            maxScore = score;
            best = line;
        }
    }

    if (best) {
        return { line: best, confidence: maxScore };
    }

    // 2) Fuse on first-letter fields + domain penalties
    const shabadId = Number(currentShabad.shabad?.id ?? currentShabad.shabad?.shabadId ?? 0);
    const lineDocs = buildLineDocsFromShabads([
        {
            shabadId,
            lines: lines.map((l: any) => ({
                id: l.id,
                gurmukhi: l.gurmukhi,
                unicode: l.gurmukhi,
                transliteration: l.transliteration,
                larivaar: l.larivaar,
            })),
        },
    ]);

    const fuseHits = rankAllLinesWithFuse(raw, lineDocs, SEARCH_CONFIG.FUSE_MIN_CONFIDENCE);
    let fuseBest: any = null;
    let fuseMax = maxScore;

    for (const hit of fuseHits) {
        const idx = hit.doc.lineIndex;
        if (idx < 0 || idx >= lines.length) continue;
        const line = lines[idx];

        const forwardDistance = getForwardDistance(idx);

        // Mirror the acronym section: non-substantive → only next line allowed
        if (!substantiveQuery && activeIndex >= 0) {
            if (forwardDistance > 1) continue;
        }

        const proximityBonus = activeIndex >= 0
            ? Math.max(0, SEARCH_CONFIG.PROXIMITY_BONUS_MAX - forwardDistance * SEARCH_CONFIG.PROXIMITY_DECAY_PER_LINE)
            : 0;

        let score = hit.confidence;
        if (hit.confidence >= 0.70) {
            score += proximityBonus;
        }

        if (isLikelyShabadHeadingLine(line) && substantiveQuery) {
            score -= SEARCH_CONFIG.HEADING_PENALTY;
        }

        if (activeIndex >= 0 && idx < activeIndex && score < 0.98) {
            score -= SEARCH_CONFIG.BACKWARD_PENALTY;
        }

        if (score > fuseMax) {
            fuseMax = score;
            fuseBest = line;
        }
    }

    return fuseBest ? { line: fuseBest, confidence: fuseMax } : null;
};

export const filterKirtanFillers = (text: string): string => {
    if (!text) return "";
    const fillers = /\b(ji|raam|piyaare|piyare|merea|mereya|harji|har\s+ji|satnam|waheguru|satiguru)\b/gi;
    const cleaned = text.replace(fillers, "").replace(/\s+/g, " ").trim();
    return cleaned.length >= 2 ? cleaned : text;
};

export const isAcronymQuery = (query: string): boolean => {
    const q = query.trim();
    if (!q) return false;
    
    // Spaced single letters e.g. "m s h h"
    const words = q.split(/\s+/);
    const isSpacedAcronym = words.length >= 2 && words.every(w => w.length === 1);
    if (isSpacedAcronym) return true;
    
    const hasGurmukhi = /[\u0A00-\u0A7F]/.test(q);
    if (hasGurmukhi) {
        const matrasRegex = /[ਾਿੀੁੂੇੈੋੌਂੰੱ਼੍]/;
        const hasMatras = matrasRegex.test(q);
        return !hasMatras && q.length >= 2;
    } else {
        const cleanLatin = q.replace(/[^a-z]/gi, "").toLowerCase();
        const vowelCount = (cleanLatin.match(/[aeiou]/gi) || []).length;
        if (cleanLatin.length >= 3 && vowelCount <= 1) return true;
    }
    
    return false;
};
