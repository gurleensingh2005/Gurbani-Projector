import { SEARCH_CONFIG } from "@/modules/gurbani/gurbani.constants";
import { logger } from "@/core/logger/logger.service";
import { getRedis } from "@/core/redis/redis.client";
import { buildShabadCacheKey, REDIS_KEYS, REDIS_TTL } from "@/core/redis/redis.keys";

type CacheEntry = { value: Record<string, unknown>; expiresAt: number };

/** Small L1 Map for same-instance bursts (in front of Redis L2). */
const l1Cache = new Map<string, CacheEntry>();

const l1Get = (key: string): Record<string, unknown> | null => {
  const entry = l1Cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    l1Cache.delete(key);
    return null;
  }
  return entry.value;
};

const l1Set = (key: string, value: Record<string, unknown>, ttlMs: number): void => {
  if (l1Cache.size >= SEARCH_CONFIG.L1_CACHE_SIZE) {
    const firstKey = l1Cache.keys().next().value;
    if (firstKey) l1Cache.delete(firstKey);
  }
  l1Cache.set(key, { value, expiresAt: Date.now() + ttlMs });
};

export const getJson = async (key: string): Promise<Record<string, unknown> | null> => {
  const local = l1Get(key);
  if (local) return local;

  const redis = getRedis();
  if (!redis) return null;

  try {
    const value = await redis.get<Record<string, unknown>>(key);
    if (value && typeof value === "object") {
      l1Set(key, value, SEARCH_CONFIG.CACHE_TTL_MS);
      return value;
    }
    return null;
  } catch (e) {
    logger.warn(
      { event: "redis_cache_get_failed", key, error: e instanceof Error ? e.message : "unknown" },
      "Redis cache GET failed — falling through"
    );
    return null;
  }
};

export const setJson = async (
  key: string,
  value: Record<string, unknown>,
  ttlSeconds: number = REDIS_TTL.SEARCH_HIT_SECONDS
): Promise<void> => {
  l1Set(key, value, ttlSeconds * 1000);

  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (e) {
    logger.warn(
      { event: "redis_cache_set_failed", key, error: e instanceof Error ? e.message : "unknown" },
      "Redis cache SET failed — L1 only"
    );
  }
};

export const delKey = async (key: string): Promise<void> => {
  l1Cache.delete(key);
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch (e) {
    logger.warn(
      { event: "redis_cache_del_failed", key, error: e instanceof Error ? e.message : "unknown" },
      "Redis DEL failed"
    );
  }
};

export const setCorpusMeta = async (count: number): Promise<void> => {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(REDIS_KEYS.corpusCount, String(count), { ex: REDIS_TTL.CORPUS_COUNT_SECONDS });
    await redis.set(REDIS_KEYS.warmupAt, new Date().toISOString(), { ex: REDIS_TTL.WARMUP_AT_SECONDS });
  } catch (e) {
    logger.warn(
      { event: "redis_meta_set_failed", error: e instanceof Error ? e.message : "unknown" },
      "Failed to set corpus meta in Redis"
    );
  }
};

export const getCorpusCount = async (): Promise<number | null> => {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get<string | number>(REDIS_KEYS.corpusCount);
    if (raw === null || raw === undefined) return null;
    const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
};

export type CachedShabad = {
  shabadId: string | number;
  bani: string;
  page?: number;
  lines: Array<Record<string, unknown>>;
};

export const getCachedShabad = async (
  shabadId: string | number
): Promise<CachedShabad | null> => {
  const raw = await getJson(buildShabadCacheKey(shabadId));
  if (!raw || !Array.isArray(raw.lines) || raw.lines.length === 0) return null;
  return {
    shabadId: (raw.shabadId as string | number) ?? shabadId,
    bani: String(raw.bani ?? ""),
    page: typeof raw.page === "number" ? raw.page : undefined,
    lines: raw.lines as Array<Record<string, unknown>>,
  };
};

/** Persist full shabad after first successful match — later tracking skips Mongo. */
export const setCachedShabad = async (shabad: {
  id?: string | number;
  shabadId?: string | number;
  bani: string;
  page?: number;
  lines: Array<Record<string, unknown>>;
}): Promise<void> => {
  const id = shabad.shabadId ?? shabad.id;
  if (id === undefined || id === null || !shabad.lines?.length) return;

  const payload: CachedShabad = {
    shabadId: id,
    bani: shabad.bani,
    page: shabad.page,
    lines: shabad.lines,
  };
  await setJson(buildShabadCacheKey(id), payload as unknown as Record<string, unknown>, REDIS_TTL.SHABAD_SECONDS);
};
