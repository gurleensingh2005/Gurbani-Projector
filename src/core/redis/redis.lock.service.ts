import { randomUUID } from "crypto";
import { logger } from "@/core/logger/logger.service";
import { getRedis } from "@/core/redis/redis.client";
import { REDIS_KEYS, REDIS_TTL } from "@/core/redis/redis.keys";

export type ImportLockResult =
  | { acquired: true; token: string }
  | { acquired: false; reason: "busy" | "unavailable" };

/**
 * Acquire single-flight import lock via SET NX EX.
 * When Redis is not configured, allow import (local/dev degrade).
 */
export const acquireImportLock = async (): Promise<ImportLockResult> => {
  const redis = getRedis();
  if (!redis) {
    return { acquired: true, token: "noop" };
  }

  const token = randomUUID();
  try {
    const ok = await redis.set(REDIS_KEYS.importLock, token, {
      nx: true,
      ex: REDIS_TTL.IMPORT_LOCK_SECONDS,
    });
    // Upstash returns "OK" on success, null when NX fails
    if (ok === "OK") {
      return { acquired: true, token };
    }
    return { acquired: false, reason: "busy" };
  } catch (e) {
    logger.warn(
      { event: "import_lock_acquire_failed", error: e instanceof Error ? e.message : "unknown" },
      "Import lock acquire failed — allowing import (degraded)"
    );
    return { acquired: true, token: "noop" };
  }
};

/** Release lock only if token still owns it (safe unlock). */
export const releaseImportLock = async (token: string): Promise<void> => {
  if (!token || token === "noop") return;
  const redis = getRedis();
  if (!redis) return;

  try {
    const current = await redis.get<string>(REDIS_KEYS.importLock);
    if (current === token) {
      await redis.del(REDIS_KEYS.importLock);
    }
  } catch (e) {
    logger.warn(
      { event: "import_lock_release_failed", error: e instanceof Error ? e.message : "unknown" },
      "Import lock release failed"
    );
  }
};
