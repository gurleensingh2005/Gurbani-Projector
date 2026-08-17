import { NextResponse } from "next/server";
import { connectDB } from "@/core/database/mongodb.connection";
import Shabad from "@/modules/gurbani/models/shabad.model";
import { logger } from "@/core/logger/logger.service";
import { getCorpusCount, setCorpusMeta } from "@/core/redis";

export const dynamic = "force-dynamic";

/**
 * Refresh Redis corpus meta from Mongo (count + warmup timestamp).
 * Does not load the full in-memory matcher index — that is a separate concern.
 */
export const GET = async (): Promise<NextResponse> => {
  const start = Date.now();
  try {
    await connectDB();
    const count = await Shabad.countDocuments({});
    await setCorpusMeta(count);
    const cached = await getCorpusCount();
    const latencyMs = Date.now() - start;

    if (count === 0) {
      return NextResponse.json(
        { status: "empty", code: "CORPUS_EMPTY", count: 0, corpusCount: cached, latencyMs },
        { status: 503 }
      );
    }

    logger.info({ event: "warmup_ok", count, latencyMs }, "Corpus meta warmup complete");
    return NextResponse.json({
      status: "ok",
      count,
      corpusCount: cached,
      latencyMs,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "unknown";
    logger.error({ event: "warmup_failed", error }, "Warmup failed");
    return NextResponse.json({ status: "error", error }, { status: 500 });
  }
};
