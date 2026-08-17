import { Redis } from "@upstash/redis";
import { env } from "@/core/config/env.config";
import { logger } from "@/core/logger/logger.service";

declare global {
  var __gpRedis: Redis | undefined;
}

/** Lazy Upstash Redis client. Returns null when credentials are not configured. */
export const getRedis = (): Redis | null => {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  if (!globalThis.__gpRedis) {
    globalThis.__gpRedis = new Redis({ url, token });
  }
  return globalThis.__gpRedis;
};

export type RedisHealthStatus = "up" | "skipped" | "down";

export const pingRedis = async (): Promise<RedisHealthStatus> => {
  const redis = getRedis();
  if (!redis) return "skipped";
  try {
    const pong = await redis.ping();
    return pong === "PONG" || pong === "pong" ? "up" : "down";
  } catch (e) {
    logger.warn(
      { event: "redis_ping_failed", error: e instanceof Error ? e.message : "unknown" },
      "Redis ping failed"
    );
    return "down";
  }
};
