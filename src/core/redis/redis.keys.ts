import { createHash } from "crypto";
import { SEARCH_CONFIG } from "@/modules/gurbani/gurbani.constants";

/** Key prefix for all Gurbani Projector Redis keys. */
export const REDIS_PREFIX = "gp:" as const;

export const REDIS_TTL = {
  SEARCH_HIT_SECONDS: Math.floor(SEARCH_CONFIG.CACHE_TTL_MS / 1000),
  SEARCH_NULL_SECONDS: SEARCH_CONFIG.REDIS_NULL_CACHE_TTL_SECONDS,
  SHABAD_SECONDS: SEARCH_CONFIG.REDIS_SHABAD_TTL_SECONDS,
  CORPUS_COUNT_SECONDS: SEARCH_CONFIG.REDIS_CORPUS_META_TTL_SECONDS,
  WARMUP_AT_SECONDS: SEARCH_CONFIG.REDIS_WARMUP_META_TTL_SECONDS,
  IMPORT_LOCK_SECONDS: SEARCH_CONFIG.REDIS_IMPORT_LOCK_TTL_SECONDS,
} as const;

export const REDIS_KEYS = {
  importLock: `${REDIS_PREFIX}lock:import`,
  corpusCount: `${REDIS_PREFIX}meta:corpus:count`,
  warmupAt: `${REDIS_PREFIX}meta:warmup:at`,
} as const;

export type SearchCacheContext = {
  query: string;
  currentShabadId?: string | number | null;
  currentPage?: string | number | null;
  /** Joined context phrases so 1-line vs 3-line queries don't collide. */
  contextLines?: string[] | null;
};

/** Build a stable cache key including tracking context so discovery/tracking don't collide. */
export const buildSearchCacheKey = (ctx: SearchCacheContext): string => {
  const contextJoined = (ctx.contextLines || [])
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean)
    .join("|");
  const normalized = [
    ctx.query.trim().toLowerCase(),
    contextJoined,
    ctx.currentShabadId ?? "",
    ctx.currentPage ?? "",
  ].join("|");
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 32);
  return `${REDIS_PREFIX}search:v1:${hash}`;
};

/** Full shabad document cache — one key per shabadId. */
export const buildShabadCacheKey = (shabadId: string | number): string => {
  return `${REDIS_PREFIX}shabad:v1:${String(shabadId)}`;
};
