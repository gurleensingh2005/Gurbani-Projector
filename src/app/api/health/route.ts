import { NextResponse } from "next/server";
import { connectDB } from "@/core/database/mongodb.connection";
import { logger } from "@/core/logger/logger.service";
import { getCorpusCount, pingRedis } from "@/core/redis";

export const dynamic = "force-dynamic";

export const GET = async (): Promise<NextResponse> => {
  const start = Date.now();
  try {
    await connectDB();
    const redis = await pingRedis();
    const corpusCount = await getCorpusCount();
    const latencyMs = Date.now() - start;

    const status = redis === "down" ? "degraded" : "ok";
    return NextResponse.json({
      status,
      db: "connected",
      redis,
      corpusCount,
      latencyMs,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "unknown";
    logger.error({ event: "health_check_failed", error }, "Health check DB connection failed");
    const redis = await pingRedis();
    return NextResponse.json({ status: "down", db: "error", redis }, { status: 503 });
  }
};
