/** Compatibility re-export — prefer `@/core/redis`. */
export {
  getRedis,
  getJson,
  setJson,
  buildSearchCacheKey,
  buildShabadCacheKey,
  getCachedShabad,
  setCachedShabad,
  enforceSearchRateLimit,
  setCorpusMeta,
  getCorpusCount,
} from "@/core/redis";
