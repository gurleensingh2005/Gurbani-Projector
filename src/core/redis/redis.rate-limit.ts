import { Ratelimit } from "@upstash/ratelimit";
import { SEARCH_CONFIG } from "@/modules/gurbani/gurbani.constants";
import { env } from "@/core/config/env.config";
import { logger } from "@/core/logger/logger.service";
import { getRedis } from "@/core/redis/redis.client";
import { REDIS_PREFIX } from "@/core/redis/redis.keys";

export type RateLimitResult =
  | { limited: false; remaining?: number }
  | { limited: true; remaining: number; reset: number; retryAfter: number };

const getClientIp = (req: Request): string => {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
};

let searchLimiter: Ratelimit | null | undefined;
let importLimiter: Ratelimit | null | undefined;

const getSearchLimiter = (): Ratelimit | null => {
  if (searchLimiter !== undefined) return searchLimiter;
  const redis = getRedis();
  if (!redis) {
    searchLimiter = null;
    return null;
  }
  searchLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(SEARCH_CONFIG.RATE_LIMIT_SEARCH_PER_MINUTE, "1 m"),
    prefix: `${REDIS_PREFIX}rl:search`,
    analytics: false,
  });
  return searchLimiter;
};

const getImportLimiter = (): Ratelimit | null => {
  if (importLimiter !== undefined) return importLimiter;
  const redis = getRedis();
  if (!redis) {
    importLimiter = null;
    return null;
  }
  importLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(SEARCH_CONFIG.RATE_LIMIT_IMPORT_PER_MINUTE, "1 m"),
    prefix: `${REDIS_PREFIX}rl:import`,
    analytics: false,
  });
  return importLimiter;
};

/**
 * Search: fail-open when Redis missing (dev) or Redis errors.
 * Import: fail-closed in production when REDIS_REQUIRED, else fail-open with warn.
 */
export const enforceSearchRateLimit = async (req: Request): Promise<RateLimitResult> => {
  const limiter = getSearchLimiter();
  if (!limiter) return { limited: false };

  const ip = getClientIp(req);
  try {
    const result = await limiter.limit(ip);
    if (!result.success) {
      const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
      return { limited: true, remaining: result.remaining, reset: result.reset, retryAfter };
    }
    return { limited: false, remaining: result.remaining };
  } catch (e) {
    logger.warn(
      { event: "search_rate_limit_error", error: e instanceof Error ? e.message : "unknown" },
      "Search rate limit check failed — fail-open"
    );
    return { limited: false };
  }
};

export const enforceImportRateLimit = async (req: Request): Promise<RateLimitResult> => {
  const limiter = getImportLimiter();
  if (!limiter) {
    if (env.REDIS_REQUIRED && env.NODE_ENV === "production") {
      logger.error({ event: "import_rate_limit_unavailable" }, "Import rate limit unavailable with REDIS_REQUIRED");
      return { limited: true, remaining: 0, reset: Date.now() + 60_000, retryAfter: 60 };
    }
    return { limited: false };
  }

  const ip = getClientIp(req);
  try {
    const result = await limiter.limit(ip);
    if (!result.success) {
      const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
      return { limited: true, remaining: result.remaining, reset: result.reset, retryAfter };
    }
    return { limited: false, remaining: result.remaining };
  } catch (e) {
    logger.warn(
      { event: "import_rate_limit_error", error: e instanceof Error ? e.message : "unknown" },
      "Import rate limit check failed"
    );
    if (env.NODE_ENV === "production" && env.REDIS_REQUIRED) {
      return { limited: true, remaining: 0, reset: Date.now() + 60_000, retryAfter: 60 };
    }
    return { limited: false };
  }
};

export { getClientIp };
