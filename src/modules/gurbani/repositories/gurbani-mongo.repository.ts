import { connectDB } from "@/core/database/mongodb.connection";
import { SEARCH_CONFIG } from "@/modules/gurbani/gurbani.constants";
import { ShabadModel } from "@/modules/gurbani/models/shabad.model";
import {
  englishAcronymToGurmukhiRegex,
  getAcronym,
  getLatinAcronym,
} from "@/shared/utils/gurbani-text-normalizer";

/**
 * Functional Data Access Layer (Repository Pattern) for MongoDB Atlas Gurbani queries.
 * Pure functional implementation using arrow functions.
 */

type RankedId = { shabadId: number; score: number };

const LINE_SELECT = {
  id: 1,
  gurmukhi: 1,
  unicode: 1,
  transliteration: 1,
  transliteration_hi: 1,
  translation: 1,
  translation_pu: 1,
  translation_hi: 1,
  larivaar: 1,
} as const;

const fetchShabadsByIdsOrdered = async (
  ranked: RankedId[]
): Promise<Array<Record<string, unknown>>> => {
  if (!ranked.length) return [];

  const ids = ranked.map((r) => r.shabadId);
  const scoreById = new Map(ranked.map((r) => [r.shabadId, r.score]));

  const docs = await ShabadModel.find({ shabadId: { $in: ids } })
    .select({
      _id: 0,
      shabadId: 1,
      bani: 1,
      page: 1,
      lines: LINE_SELECT,
    })
    .lean();

  return (docs as Array<Record<string, unknown>>).slice().sort((a, b) => {
    const sa = scoreById.get(Number(a.shabadId)) ?? 0;
    const sb = scoreById.get(Number(b.shabadId)) ?? 0;
    return sb - sa;
  });
};

/**
 * First-letter (larivaar) candidate search.
 * Latin STT → Gurmukhi larivaar regex via ENGLISH_ACRONYM_MAP.
 * Gurmukhi query → prefix match on lines.larivaar.
 */
export const searchShabadsByFirstLetters = async (
  query: string,
  limit: number = SEARCH_CONFIG.MONGO_CANDIDATE_LIMIT
): Promise<Array<Record<string, unknown>>> => {
  await connectDB();

  const isGurmukhi = /[\u0A00-\u0A7F]/.test(query);
  let larivaarRegex: string | null = null;

  if (isGurmukhi) {
    const acr = getAcronym(query);
    if (acr.length < SEARCH_CONFIG.ACRONYM_MIN_LENGTH) return [];
    // Escape regex specials in Gurmukhi acronym (usually none)
    const escaped = acr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    larivaarRegex = escaped;
  } else {
    const latin = getLatinAcronym(query);
    if (latin.length < SEARCH_CONFIG.ACRONYM_MIN_LENGTH) return [];
    // englishAcronymToGurmukhiRegex already prefixes ^
    larivaarRegex = englishAcronymToGurmukhiRegex(latin);
    if (!larivaarRegex) return [];
  }

  const filter = isGurmukhi
    ? { "lines.larivaar": { $regex: larivaarRegex } }
    : { "lines.larivaar": { $regex: larivaarRegex } };

  const docs = await ShabadModel.find(filter)
    .select({
      _id: 0,
      shabadId: 1,
      bani: 1,
      page: 1,
      lines: LINE_SELECT,
    })
    .limit(limit)
    .lean();

  return docs as Array<Record<string, unknown>>;
};

/**
 * Broad $text candidate retrieval (fallback when larivaar index sparse).
 * Two-stage query avoids Mongo 32MB sort OOM.
 */
export const searchShabadsByText = async (
  searchText: string,
  limit: number = SEARCH_CONFIG.MONGO_CANDIDATE_LIMIT
): Promise<Array<Record<string, unknown>>> => {
  await connectDB();

  const ranked = (await ShabadModel.aggregate([
    { $match: { $text: { $search: searchText } } },
    { $addFields: { score: { $meta: "textScore" } } },
    { $project: { _id: 0, shabadId: 1, score: 1 } },
    { $sort: { score: -1 } },
    { $limit: limit },
  ])) as RankedId[];

  return fetchShabadsByIdsOrdered(ranked);
};

/**
 * Prefer first-letter Mongo lookup; fall back to $text word search.
 */
export const searchShabadsForQuery = async (
  query: string,
  textFallback: string | null,
  limit: number = SEARCH_CONFIG.MONGO_CANDIDATE_LIMIT
): Promise<Array<Record<string, unknown>>> => {
  const byLetters = await searchShabadsByFirstLetters(query, limit);
  if (byLetters.length > 0) return byLetters;

  if (textFallback) {
    return searchShabadsByText(textFallback, limit);
  }
  return [];
};


export const fetchShabadById = async (
  shabadId: number
): Promise<Record<string, unknown> | null> => {
  await connectDB();
  const shabad = await ShabadModel.findOne({ shabadId }).lean();
  return (shabad as Record<string, unknown>) || null;
};
