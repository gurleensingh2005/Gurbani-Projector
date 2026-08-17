import pino from "pino";
import { env } from "@/core/config/env.config";

/**
 * Structured logger. Use this in all API routes and server-side modules.
 *
 * Log shape convention:
 *   logger.info({ event: "search_match", latencyMs, score, lineId }, "...");
 *   logger.error({ event: "import_failed", error: e.message }, "...");
 *
 * In production, raw query/transcript values are redacted — voice content is
 * biometric and we don't want it in log files. In dev, full content is logged
 * to aid debugging.
 */
const isProd = env.NODE_ENV === "production";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "gurbani-projector" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: isProd ? ["query", "transcript", "*.query", "*.transcript", "*.*.query", "*.*.transcript"] : [],
    censor: "[redacted]",
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
});
