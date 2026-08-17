import Fuse, { type IFuseOptions } from "fuse.js";
import { SEARCH_CONFIG } from "@/modules/gurbani/gurbani.constants";
import {
  getAcronym,
  getLatinAcronym,
  getQueryAcronym,
  latinAcronymMatchesLarivaar,
} from "@/shared/utils/gurbani-text-normalizer";

/**
 * Fuse.js scorer — primary key is first-letter acronym of each word
 * (Gurmukhi larivaar / Latin first letters), not full pankti text.
 */

export type FuseLineDoc = {
  id: string;
  shabadId: number;
  lineIndex: number;
  /** Gurmukhi first letters (larivaar), e.g. ਮਸਤ */
  firstLettersGur: string;
  /** Latin first letters, e.g. mst */
  firstLettersLat: string;
  gurmukhiNaked: string;
  translitPhonetic: string;
};

export type FuseWindowDoc = {
  shabadId: number;
  startLineIndex: number;
  endLineIndex: number;
  firstLettersGur: string;
  firstLettersLat: string;
  gurmukhiNaked: string;
  translitPhonetic: string;
  bani?: string;
  page?: number;
};

export type FuseRankResult<T> = {
  doc: T;
  confidence: number;
  fuseScore: number;
};

/** Gurbani punctuation: danda, double danda, pipes, dashes. */
const GURMUKHI_PUNCT_REGEX = /[।॥|｜\u0964\u0965\u2013\u2014\-–—]/g;

const GURMUKHI_OPTIONAL_AND_MATRA_REGEX =
  /[\u0A01-\u0A03\u0A3C\u0A3E-\u0A4D\u0A51\u0A70-\u0A71\u0A75\u0A81-\u0A83\u0ABC]/g;

export const normalizeNakedGurmukhi = (text: string): string => {
  if (!text) return "";
  return text
    .normalize("NFC")
    .replace(GURMUKHI_PUNCT_REGEX, " ")
    .replace(GURMUKHI_OPTIONAL_AND_MATRA_REGEX, "")
    .replace(/\s+/g, " ")
    .trim();
};

export const normalizeTranslitPhonetic = (text: string): string => {
  if (!text) return "";
  let t = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const maps: Array<[RegExp, string | ((m: string) => string)]> = [
    [/a[ae]/g, "a"],
    [/ee/g, "i"],
    [/oo/g, "u"],
    [/kh/g, "k"],
    [/gh/g, "g"],
    [/chh?/g, "c"],
    [/jh/g, "j"],
    [/th/g, "t"],
    [/dh/g, "d"],
    [/ph/g, "p"],
    [/bh/g, "b"],
    [/sh/g, "s"],
    [
      /[ẖṯṣṛṇḍ]/g,
      (m: string) => {
        const map: Record<string, string> = {
          ẖ: "h",
          ṯ: "t",
          ṣ: "s",
          ṛ: "r",
          ṇ: "n",
          ḍ: "d",
        };
        return map[m] || m;
      },
    ],
  ];

  for (const [pattern, replacement] of maps) {
    t = t.replace(pattern, replacement as string);
  }

  return t.replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
};

export const fuseConfidence = (fuseScore: number | undefined): number => {
  if (fuseScore === undefined || fuseScore === null || Number.isNaN(fuseScore)) {
    return 0;
  }
  return Math.max(0, Math.min(1, 1 - fuseScore));
};

/**
 * Score query vs line using first letter of each word only.
 * exact=1.0, prefix=0.98, contains=0.95; Latin↔Gurmukhi via acronym map.
 */
export const scoreFirstLetters = (
  query: string,
  lineGurmukhi: string,
  lineTranslit: string,
  lineLarivaar?: string
): number => {
  const q = (query || "").trim();
  if (!q) return 0;

  const lineGurAcr = (lineLarivaar || getAcronym(lineGurmukhi) || "").replace(/\s+/g, "");
  const lineLatAcr = getLatinAcronym(lineTranslit || "");

  if (/[\u0A00-\u0A7F]/.test(q)) {
    const qAcr = getAcronym(q);
    if (qAcr.length < SEARCH_CONFIG.ACRONYM_MIN_LENGTH) return 0;
    if (!lineGurAcr) return 0;
    if (lineGurAcr === qAcr) return 1.0;
    if (lineGurAcr.startsWith(qAcr)) return 0.98;
    if (lineGurAcr.includes(qAcr)) return 0.95;
    return 0;
  }

  const qLat = getLatinAcronym(q);
  if (qLat.length < SEARCH_CONFIG.ACRONYM_MIN_LENGTH) return 0;

  // Prefer Latin first-letters on transliteration
  if (lineLatAcr) {
    if (lineLatAcr === qLat) return 1.0;
    if (lineLatAcr.startsWith(qLat)) return 0.98;
    if (lineLatAcr.includes(qLat)) return 0.95;
  }

  // Cross-script: Latin STT acronym vs Gurmukhi larivaar
  if (lineGurAcr) {
    const cross = latinAcronymMatchesLarivaar(qLat, lineGurAcr);
    if (cross.exact) return 1.0;
    if (cross.prefix) return 0.98;
    if (cross.match) return 0.95;
    // Partial: how many leading letters align
    let aligned = 0;
    for (let i = 0; i < Math.min(qLat.length, lineGurAcr.length); i++) {
      const partial = latinAcronymMatchesLarivaar(qLat.slice(0, i + 1), lineGurAcr);
      if (partial.match) aligned = i + 1;
      else break;
    }
    if (aligned >= SEARCH_CONFIG.ACRONYM_MIN_LENGTH) {
      return Math.min(0.94, 0.55 + (aligned / qLat.length) * 0.35);
    }
  }

  return 0;
};

const lineFuseOptions: IFuseOptions<FuseLineDoc> = {
  includeScore: true,
  ignoreLocation: true,
  findAllMatches: true,
  threshold: SEARCH_CONFIG.FUSE_THRESHOLD,
  minMatchCharLength: SEARCH_CONFIG.FUSE_MIN_MATCH_CHAR_LENGTH,
  distance: SEARCH_CONFIG.FUSE_DISTANCE_LINE,
  useExtendedSearch: false,
  keys: [
    { name: "firstLettersLat", weight: SEARCH_CONFIG.FUSE_WEIGHT_FIRST_LETTERS },
    { name: "firstLettersGur", weight: SEARCH_CONFIG.FUSE_WEIGHT_FIRST_LETTERS },
    { name: "gurmukhiNaked", weight: SEARCH_CONFIG.FUSE_WEIGHT_GURMUKHI },
    { name: "translitPhonetic", weight: SEARCH_CONFIG.FUSE_WEIGHT_TRANSLIT },
  ],
};

const windowFuseOptions: IFuseOptions<FuseWindowDoc> = {
  includeScore: true,
  ignoreLocation: true,
  findAllMatches: true,
  threshold: SEARCH_CONFIG.FUSE_THRESHOLD,
  minMatchCharLength: SEARCH_CONFIG.FUSE_MIN_MATCH_CHAR_LENGTH,
  distance: SEARCH_CONFIG.FUSE_DISTANCE_WINDOW,
  useExtendedSearch: false,
  keys: [
    { name: "firstLettersLat", weight: SEARCH_CONFIG.FUSE_WEIGHT_FIRST_LETTERS },
    { name: "firstLettersGur", weight: SEARCH_CONFIG.FUSE_WEIGHT_FIRST_LETTERS },
    { name: "gurmukhiNaked", weight: SEARCH_CONFIG.FUSE_WEIGHT_GURMUKHI },
    { name: "translitPhonetic", weight: SEARCH_CONFIG.FUSE_WEIGHT_TRANSLIT },
  ],
};

export type RawLineLike = {
  verseId?: string | number;
  _id?: string | number;
  id?: string | number;
  verse?: { id?: string | number; unicode?: string; gurmukhi?: string; text?: string };
  unicode?: string;
  gurmukhi?: string;
  text?: string;
  larivaar?: string;
  transliteration?: string | { english?: string; hindi?: string; hi?: string };
};

const extractGurmukhi = (line: RawLineLike): string => {
  const core = line.verse && typeof line.verse === "object" ? line.verse : line;
  return String(
    core.unicode || core.gurmukhi || core.text || line.gurmukhi || line.unicode || line.text || ""
  );
};

const extractTranslit = (line: RawLineLike): string => {
  if (typeof line.transliteration === "object" && line.transliteration) {
    return line.transliteration.english || "";
  }
  return typeof line.transliteration === "string" ? line.transliteration : "";
};

const extractLineId = (line: RawLineLike, idx: number): string => {
  return String(line.verseId || line._id || line.id || line.verse?.id || idx);
};

const lineLettersCache = new Map<
  string,
  {
    gurmukhi: string;
    translit: string;
    firstLettersGur: string;
    firstLettersLat: string;
    gurmukhiNaked: string;
    translitPhonetic: string;
  }
>();

const lineFirstLetters = (line: RawLineLike) => {
  const gurmukhi = extractGurmukhi(line);
  const cached = lineLettersCache.get(gurmukhi);
  if (cached) return cached;

  const translit = extractTranslit(line);
  const firstLettersGur = (line.larivaar || getAcronym(gurmukhi) || "").replace(/\s+/g, "");
  const firstLettersLat = getLatinAcronym(translit);
  
  const result = {
    gurmukhi,
    translit,
    firstLettersGur,
    firstLettersLat,
    gurmukhiNaked: normalizeNakedGurmukhi(gurmukhi),
    translitPhonetic: normalizeTranslitPhonetic(translit),
  };

  if (lineLettersCache.size < 70000) {
    lineLettersCache.set(gurmukhi, result);
  }

  return result;
};

/** Acronym string used as Fuse query (not full pankti). */
export const normalizeQueryForFuse = (query: string): string => {
  return getQueryAcronym(query);
};

export const buildLineDocsFromShabads = (
  shabads: Array<Record<string, unknown>>
): FuseLineDoc[] => {
  const docs: FuseLineDoc[] = [];
  for (const shbd of shabads) {
    const shabadId = Number(shbd.shabadId ?? shbd.id ?? 0);
    const rawLines = (shbd.lines as RawLineLike[]) || [];
    for (let i = 0; i < rawLines.length; i++) {
      const fl = lineFirstLetters(rawLines[i]);
      docs.push({
        id: extractLineId(rawLines[i], i),
        shabadId,
        lineIndex: i,
        firstLettersGur: fl.firstLettersGur,
        firstLettersLat: fl.firstLettersLat,
        gurmukhiNaked: fl.gurmukhiNaked,
        translitPhonetic: fl.translitPhonetic,
      });
    }
  }
  return docs;
};

export const buildWindowDocs = (
  shabads: Array<Record<string, unknown>>,
  windowSize: number
): FuseWindowDoc[] => {
  const W = Math.max(1, Math.min(SEARCH_CONFIG.CONTEXT_WINDOW_SIZE, windowSize));
  const docs: FuseWindowDoc[] = [];

  for (const shbd of shabads) {
    const shabadId = Number(shbd.shabadId ?? shbd.id ?? 0);
    const rawLines = (shbd.lines as RawLineLike[]) || [];
    if (rawLines.length === 0) continue;

    const perLine = rawLines.map((l) => lineFirstLetters(l));

    if (W === 1) {
      for (let i = 0; i < perLine.length; i++) {
        docs.push({
          shabadId,
          startLineIndex: i,
          endLineIndex: i,
          firstLettersGur: perLine[i].firstLettersGur,
          firstLettersLat: perLine[i].firstLettersLat,
          gurmukhiNaked: perLine[i].gurmukhiNaked,
          translitPhonetic: perLine[i].translitPhonetic,
          bani: shbd.bani as string | undefined,
          page: shbd.page as number | undefined,
        });
      }
      continue;
    }

    for (let i = 0; i <= perLine.length - W; i++) {
      const slice = perLine.slice(i, i + W);
      docs.push({
        shabadId,
        startLineIndex: i,
        endLineIndex: i + W - 1,
        firstLettersGur: slice.map((s) => s.firstLettersGur).join(""),
        firstLettersLat: slice.map((s) => s.firstLettersLat).join(""),
        gurmukhiNaked: slice
          .map((s) => s.gurmukhiNaked)
          .filter(Boolean)
          .join(" "),
        translitPhonetic: slice
          .map((s) => s.translitPhonetic)
          .filter(Boolean)
          .join(" "),
        bani: shbd.bani as string | undefined,
        page: shbd.page as number | undefined,
      });
    }
  }
  return docs;
};

/** Join context phrases as concatenated first-letter acronyms. */
export const joinContextQuery = (contextLines: string[]): string => {
  return contextLines
    .map((l) => getQueryAcronym(l))
    .filter((a) => a.length > 0)
    .join("");
};

const searchFuseByAcronym = <T>(
  query: string,
  docs: T[],
  options: IFuseOptions<T>
): FuseRankResult<T> | null => {
  const q = normalizeQueryForFuse(query);
  if (!q || q.length < SEARCH_CONFIG.ACRONYM_MIN_LENGTH || docs.length === 0) return null;

  const fuse = new Fuse(docs, options);
  const hits = fuse.search(q);
  if (!hits.length) return null;

  const best = hits[0];
  return {
    doc: best.item,
    confidence: fuseConfidence(best.score),
    fuseScore: best.score ?? 1,
  };
};

export const rankLinesWithFuse = (
  query: string,
  docs: FuseLineDoc[]
): FuseRankResult<FuseLineDoc> | null => {
  const hit = searchFuseByAcronym(query, docs, lineFuseOptions);
  if (!hit || hit.confidence < SEARCH_CONFIG.FUSE_MIN_CONFIDENCE) return null;
  return hit;
};

export const rankAllLinesWithFuse = (
  query: string,
  docs: FuseLineDoc[],
  minConfidence: number = SEARCH_CONFIG.FUSE_MIN_CONFIDENCE
): FuseRankResult<FuseLineDoc>[] => {
  const q = normalizeQueryForFuse(query);
  if (!q || docs.length === 0) return [];

  const fuse = new Fuse(docs, lineFuseOptions);
  return fuse
    .search(q)
    .map((hit) => ({
      doc: hit.item,
      confidence: fuseConfidence(hit.score),
      fuseScore: hit.score ?? 1,
    }))
    .filter((r) => r.confidence >= minConfidence);
};

export const rankWindowsWithFuse = (
  contextQuery: string,
  docs: FuseWindowDoc[],
  minConfidence: number = SEARCH_CONFIG.DISCOVERY_WINDOW_MIN_CONFIDENCE
): FuseRankResult<FuseWindowDoc> | null => {
  const hit = searchFuseByAcronym(contextQuery, docs, windowFuseOptions);
  if (!hit || hit.confidence < minConfidence) return null;
  return hit;
};

export const rankWindowsWithFuseRaw = (
  contextQuery: string,
  docs: FuseWindowDoc[]
): FuseRankResult<FuseWindowDoc> | null => {
  return searchFuseByAcronym(contextQuery, docs, windowFuseOptions);
};

export const clampContextLines = (contextLines?: string[] | null): string[] => {
  if (!contextLines?.length) return [];
  return contextLines
    .map((l) => (l || "").trim())
    .filter(Boolean)
    .slice(-SEARCH_CONFIG.CONTEXT_WINDOW_SIZE);
};

/**
 * Mongo $text still needs words for candidate recall; keep last tokens.
 * Acronym re-rank happens in Fuse / scoreFirstLetters.
 */
export const buildBroadMongoSearchText = (sanitized: string): string | null => {
  if (!sanitized) return null;
  const words = sanitized
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w.length >= 2)
    .slice(-8);
  if (!words.length) return null;
  return words.join(" ");
};

export { getQueryAcronym };
