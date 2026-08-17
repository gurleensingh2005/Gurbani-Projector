import mongoose, { Mongoose } from "mongoose";
import { env } from "@/core/config/env.config";
import { logger } from "@/core/logger/logger.service";

declare global {
  var mongooseCache: { conn: Mongoose | null; promise: Promise<Mongoose> | null } | undefined;
}

const cached =
  globalThis.mongooseCache ??
  (globalThis.mongooseCache = { conn: null, promise: null });

let cleanupBound = false;

const bindCleanupOnce = () => {
  if (cleanupBound || typeof process === "undefined") return;
  cleanupBound = true;
  const cleanup = async (signal: string) => {
    if (cached.conn) {
      logger.info({ event: "mongo_disconnect", signal }, "Disconnecting Mongoose on signal");
      await cached.conn.disconnect();
      cached.conn = null;
      cached.promise = null;
    }
  };
  process.once("SIGTERM", () => void cleanup("SIGTERM"));
  process.once("SIGINT", () => void cleanup("SIGINT"));
};

export const connectDB = async (): Promise<Mongoose> => {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(env.MONGODB_URI, { bufferCommands: false });
  }

  try {
    cached.conn = await cached.promise;
    bindCleanupOnce();
  } catch (e) {
    cached.promise = null;
    logger.error({ event: "mongo_connect_failed", error: e instanceof Error ? e.message : "unknown" }, "MongoDB connection failed");
    throw e;
  }

  return cached.conn;
};
