import { NextResponse } from "next/server";
import { SearchBodySchema } from "@/modules/gurbani/gurbani.validation";
import { executeSearch } from "@/modules/gurbani/services/gurbani-search.service";
import { clampContextLines } from "@/modules/gurbani/services/fuse-matcher.service";
import { logger } from "@/core/logger/logger.service";
import {
  buildSearchCacheKey,
  enforceSearchRateLimit,
  getCorpusCount,
  getJson,
  setJson,
  REDIS_TTL,
} from "@/core/redis";

/**
 * Functional Controller for Gurbani HTTP API requests.
 * Pure functional implementation using arrow functions.
 */

export { SearchBodySchema };

const extractQueryText = (
  query: string | { unicode?: string; text?: string }
): string => {
  if (typeof query === "string") return query.trim();
  return (query.unicode || query.text || "").trim();
};

export const handleSearchRequest = async (req: Request): Promise<NextResponse> => {
  try {
    const rate = await enforceSearchRateLimit(req);
    if (rate.limited) {
      return NextResponse.json(
        { error: "Rate limit exceeded", retryAfter: rate.retryAfter },
        {
          status: 429,
          headers: {
            "Retry-After": String(rate.retryAfter),
            "X-RateLimit-Remaining": String(rate.remaining),
          },
        }
      );
    }

    const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
    if (contentLength > 100_000) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }

    const rawBody = await req.json();
    const parsed = SearchBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { query, currentShabadId, currentLineId, currentPage, contextLines: rawContext } = parsed.data;
    const queryText = extractQueryText(query);
    const contextLines = clampContextLines(rawContext);

    const corpusCount = await getCorpusCount();
    if (corpusCount === 0) {
      return NextResponse.json(
        { error: "Corpus empty", code: "CORPUS_EMPTY" },
        { status: 503 }
      );
    }

    const cacheKey = buildSearchCacheKey({
      query: queryText,
      currentShabadId,
      currentPage,
      contextLines,
    });

    const cached = await getJson(cacheKey);
    // Only serve positive cache hits — never stick on cached null (blocks new-shabad discovery)
    if (cached && cached.match && cached.shabad) {
      return NextResponse.json(cached, {
        headers: { "X-Cache": "HIT" },
      });
    }

    const result = await executeSearch(query, currentShabadId, currentPage, contextLines, currentLineId);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    if (result.match && result.shabad) {
      const resPayload = {
        match: result.match,
        matchedLine: result.matchedLine,
        shabad: result.shabad,
      };
      await setJson(cacheKey, resPayload, REDIS_TTL.SEARCH_HIT_SECONDS);
      const cacheHeader = result.fromRedisShabad ? "SHABAD" : "MISS";
      return NextResponse.json(resPayload, {
        headers: { "X-Cache": cacheHeader },
      });
    }

    // Do not cache nulls — next STT phrase must be free to run global Mongo discovery
    return NextResponse.json(
      { match: null, shabad: null, reason: "below_threshold_or_no_candidates" },
      { headers: { "X-Cache": "MISS" } }
    );
  } catch (e) {
    const error = e instanceof Error ? e.message : "unknown";
    logger.error({ event: "search_error", error }, "Search handler threw exception");
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
};
