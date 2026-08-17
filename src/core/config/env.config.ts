import { z } from "zod";

const emptyToUndefined = (v: unknown) => (v === "" || v === undefined || v === null ? undefined : v);

const envSchema = z.object({
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  IMPORT_API_KEY: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  UPSTASH_REDIS_REST_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  UPSTASH_REDIS_REST_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  /** When true, Redis credentials must be present (production hardening). */
  REDIS_REQUIRED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables — see error above");
}

const data = parsed.data;
const hasRedisUrl = Boolean(data.UPSTASH_REDIS_REST_URL);
const hasRedisToken = Boolean(data.UPSTASH_REDIS_REST_TOKEN);

if (data.REDIS_REQUIRED && (!hasRedisUrl || !hasRedisToken)) {
  console.error("❌ REDIS_REQUIRED=true but UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing");
  throw new Error("Redis required but not configured");
}

export const env = data;
