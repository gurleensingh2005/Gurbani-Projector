import { NextResponse } from "next/server";
import { connectDB } from "@/core/database/mongodb.connection";
import Shabad from "@/modules/gurbani/models/shabad.model";
import { env } from "@/core/config/env.config";
import { logger } from "@/core/logger/logger.service";
import axios from "axios";
import { z } from "zod";
import { getAcronym, sanitizeGurmukhiText } from "@/modules/gurbani/gurbani.helper";
import {
    acquireImportLock,
    enforceImportRateLimit,
    releaseImportLock,
    setCorpusMeta,
} from "@/core/redis";

export const maxDuration = 300;

const BANIDB_BANIS_INDEX = "https://api.banidb.com/v2/banis";
const BANIDB_BANI = (id: number) => `https://api.banidb.com/v2/banis/${id}`;
const fakeShabadIdForBani = (baniId: number) => 10000 + baniId;

const safeStr = (val: unknown): string => {
    if (!val) return "";
    if (typeof val === "string") return val;
    if (typeof val === "object" && val !== null) {
        const o = val as Record<string, unknown>;
        return (o.unicode as string) || (o.default as string) || (o.english as string) || (o.en as string) || (o.hi as string) || (o.pu as string) || "";
    }
    return "";
};

const syncShabadsFromBanidb = async (): Promise<void> => {
    await connectDB();
    const TOTAL_SHABADS = 10000;

    logger.info({ event: "shabads_sync_start", total: TOTAL_SHABADS }, "Shabads sync starting");
    let retryCount = 0;
    let imported = 0;
    let skipped = 0;

    for (let shabadId = 1; shabadId <= TOTAL_SHABADS; shabadId++) {
        try {
            const existing = await Shabad.findOne({ shabadId }).lean() as { lines?: unknown[] } | null;
            if (existing && Array.isArray(existing.lines) && existing.lines.length > 0) {
                skipped++;
                continue;
            }

            const res = await axios.get(`https://api.banidb.com/v2/shabads/${shabadId}`);
            const data = res.data;
            if (!data?.verses?.length) continue;

            const lines = [];
            for (const v of data.verses) {
                const core = v.verse || v;
                const t = v.translation || {};
                const gurmukhiRaw = safeStr(core.unicode || core.gurmukhi || v.gurmukhi);
                const gurmukhi = sanitizeGurmukhiText(gurmukhiRaw);
                // Skip lines that are purely decorative / have no valid Gurmukhi after sanitization
                if (!gurmukhi) continue;
                const transliteration = safeStr(v.transliteration?.english || v.transliteration);
                lines.push({
                    id: (v.verseId || v._id || v.id || v.verse?.id || Math.random()).toString(),
                    gurmukhi,
                    transliteration,
                    translation: safeStr(t.en?.bdb || t.en?.ms || t.en || v.translation),
                    translation_pu: safeStr(t.pu?.ss?.unicode || t.pu?.bdb?.unicode || t.pu || v.translation_pu),
                    translation_hi: safeStr(t.hi?.ss || t.hi?.sts || t.hi || v.translation_hi),
                    transliteration_hi: safeStr(v.transliteration?.hindi || v.transliteration?.hi || v.transliteration_hi),
                    larivaar: getAcronym(gurmukhi),
                });
            }

            const baniName = safeStr(data.shabadInfo?.source?.english || "Sri Guru Granth Sahib Ji");
            const raag = safeStr(data.shabadInfo?.raag?.english);
            const page = data.shabadInfo?.pageNo || 0;

            await Shabad.findOneAndUpdate(
                { shabadId },
                { shabadId, bani: baniName, raag, page, lines },
                { upsert: true }
            );

            imported++;
            retryCount = 0;
            await new Promise((r) => setTimeout(r, 800));
        } catch (err: unknown) {
            const e = err as { response?: { status?: number }; message?: string };
            if (e?.response?.status === 429) {
                retryCount++;
                const waitTime = 5000 * retryCount;
                logger.warn({ event: "rate_limit", waitMs: waitTime, shabadId }, "BaniDB rate limit, backing off");
                await new Promise((r) => setTimeout(r, waitTime));
                shabadId--;
                continue;
            }
            if (e?.response?.status !== 404) {
                logger.error({ event: "shabad_sync_error", shabadId, error: e?.message }, "Shabad sync failed");
            }
        }
    }

    logger.info({ event: "shabads_sync_complete", imported, skipped }, "Shabads sync done");
};

const syncAllBanisFromBanidb = async (filterSourceId?: string): Promise<void> => {
    await connectDB();

    let catalog: { ID: number; token?: string; transliteration?: string }[] = [];
    try {
        const res = await axios.get(BANIDB_BANIS_INDEX, { timeout: 60000 });
        catalog = Array.isArray(res.data) ? res.data : [];
    } catch (err: unknown) {
        const e = err as { message?: string };
        logger.error({ event: "banis_catalog_fetch_failed", error: e?.message }, "Failed to fetch /v2/banis catalog");
        return;
    }

    const ids = [...new Set(catalog.map((b) => b.ID))].filter((n) => typeof n === "number").sort((a, b) => a - b);
    logger.info({ event: "banis_sync_start", count: ids.length }, "BaniDB banis sync starting");

    const normalizedSources = filterSourceId
        ? filterSourceId
              .toString()
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .map((s) => s.toUpperCase())
              .flatMap((s) => {
                  if (s === "DASAM" || s === "DASAMGRANTH" || s === "DASAMGRANTHJI") return ["D"];
                  if (s === "VAARS") return ["B", "S", "N", "A"];
                  return [s];
              })
        : [];

    for (const baniId of ids) {
        try {
            const fakeShabadId = fakeShabadIdForBani(baniId);
            const existing = await Shabad.findOne({ shabadId: fakeShabadId }).lean() as { lines?: unknown[] } | null;
            if (existing && Array.isArray(existing.lines) && existing.lines.length > 0) {
                continue;
            }

            const res = await axios.get(BANIDB_BANI(baniId), { timeout: 120000 });
            if (!res.data?.verses?.length) continue;

            const sourceId = safeStr(res.data?.baniInfo?.source?.sourceId).toUpperCase();
            if (normalizedSources.length > 0) {
                if (!sourceId || !normalizedSources.includes(sourceId)) continue;
            }

            const lines = [];
            for (const v of res.data.verses) {
                const core = v.verse || v;
                const t = v.translation || {};

                const gurmukhiRaw = safeStr(core.unicode || core.gurmukhi || v.gurmukhi);
                const gurmukhi = sanitizeGurmukhiText(gurmukhiRaw);
                // Skip lines that are purely decorative / have no valid Gurmukhi after sanitization
                if (!gurmukhi) continue;
                const transliteration = safeStr(v.transliteration?.english || v.transliteration);
                lines.push({
                    id: (v.verseId || v._id || v.id || v.verse?.id || Math.random()).toString(),
                    gurmukhi,
                    transliteration,
                    translation: safeStr(t.en?.bdb || t.en?.ms || t.en || v.translation),
                    translation_pu: safeStr(t.pu?.ss?.unicode || t.pu?.bdb?.unicode || t.pu || v.translation_pu),
                    translation_hi: safeStr(t.hi?.ss || t.hi?.sts || t.hi || v.translation_hi),
                    transliteration_hi: safeStr(v.transliteration?.hindi || v.transliteration?.hi || v.transliteration_hi),
                    larivaar: getAcronym(gurmukhi),
                });
            }

            const baniName = safeStr(res.data.baniInfo?.english || `Bani ${baniId}`);
            const token = catalog.find((c) => c.ID === baniId)?.token || "";
            const raagLabel = token ? `BaniDB / ${token}` : "BaniDB";

            await Shabad.findOneAndUpdate(
                { shabadId: fakeShabadId },
                { shabadId: fakeShabadId, bani: baniName, raag: raagLabel, page: 0, lines },
                { upsert: true }
            );

            logger.info({ event: "bani_imported", baniId, name: baniName, lineCount: lines.length }, "Bani imported");
            await new Promise((r) => setTimeout(r, 500));
        } catch (err: unknown) {
            const e = err as { response?: { status?: number }; message?: string };
            if (e?.response?.status === 404) {
                logger.warn({ event: "bani_not_found", baniId }, "Bani 404");
            } else {
                logger.error({ event: "bani_sync_error", baniId, error: e?.message }, "Bani sync failed");
            }
        }
    }

    logger.info({ event: "banis_sync_complete" }, "Banis sync done");
};

const runFullSync = async (): Promise<void> => {
    logger.info({ event: "full_sync_start" }, "Starting full sync (shabads then banis)");
    await syncShabadsFromBanidb();
    await syncAllBanisFromBanidb();
    logger.info({ event: "full_sync_complete" }, "Full Gurbani + Banis sync completed");
};

const syncMockShabads = async (): Promise<void> => {
    await connectDB();
    logger.info({ event: "mock_sync_start" }, "Mock shabads sync starting");

    const mockShabadsData = [
        {
            shabadId: 90001,
            bani: "Sri Guru Granth Sahib Ji",
            raag: "Japji Sahib",
            page: 1,
            lines: [
                {
                    id: "90001-1",
                    gurmukhi: "ੴ ਸਤਿ ਨਾਮੁ ਕਰਤਾ ਪੁਰਖੁ ਨਿਰਭਉ ਨਿਰਵੈਰੁ ਅਕਾਲ ਮੂਰਤਿ ਅਜੂਨੀ ਸੈਭੰ ਗੁਰ ਪ੍ਰਸਾਦਿ ॥",
                    transliteration: "ik oankaar sat naam karataa purakh nirabhau niravair akaal moorat ajoonee saibhan gur prasaad ||",
                    translation: "One Universal Creator God. The Name Is Truth. Creative Being Personified. No Fear. No Hatred. Image Of The Undying. Beyond Birth. Self-Existent. By Guru's Grace.",
                    translation_pu: "ਇੱਕ ਓਅੰਕਾਰ, ਸੱਚਾ ਨਾਮ, ਸਿਰਜਣਹਾਰ ਪੁਰਖ, ਨਿਰਭਉ, ਨਿਰਵੈਰ, ਅਕਾਲ ਮੂਰਤ, ਅਜੂਨੀ, ਸਵੈ-ਹੋਂਦ, ਗੁਰੂ ਦੀ ਕਿਰਪਾ ਦੁਆਰਾ।",
                    translation_hi: "एक ओंकार, सत्य नाम, कर्ता पुरख, निर्भय, निर्वैर, अकाल मूरत, अजूनी, स्वयंभू, गुरु की कृपा से।",
                    transliteration_hi: "इक ओंकार सत नाम करता पुरख निरभउ निरवैर अकाळ मूरत अजूनी सैभं गुर प्रसाद ॥",
                    larivaar: getAcronym("ੴ ਸਤਿ ਨਾਮੁ ਕਰਤਾ ਪੁਰਖੁ ਨਿਰਭਉ ਨਿਰਵੈਰੁ ਅਕਾਲ ਮੂਰਤਿ ਅਜੂਨੀ ਸੈਭੰ ਗੁਰ ਪ੍ਰਸਾਦਿ ॥")
                },
                {
                    id: "90001-2",
                    gurmukhi: "॥ ਜਪੁ ॥",
                    transliteration: "|| jap ||",
                    translation: "Chant And Meditate:",
                    translation_pu: "ਜਪੋ:",
                    translation_hi: "जप:",
                    transliteration_hi: "॥ जपु ॥",
                    larivaar: getAcronym("॥ ਜਪੁ ॥")
                },
                {
                    id: "90001-3",
                    gurmukhi: "ਆਦਿ ਸਚੁ ਜੁਗਾਦਿ ਸਚੁ ॥",
                    transliteration: "aad sach jugaad sach ||",
                    translation: "True In The Beginning. True Through The Ages.",
                    translation_pu: "ਮੁੱਢ ਤੋਂ ਸੱਚ ਹੈ, ਯੁੱਗਾਂ ਦੇ ਮੁੱਢ ਤੋਂ ਸੱਚ ਹੈ।",
                    translation_hi: "आदि में सच है, युगों के आदि में सच है।",
                    transliteration_hi: "आदि सचु जुगादि सचु ॥",
                    larivaar: getAcronym("ਆਦਿ ਸਚੁ ਜੁਗਾਦਿ ਸਚੁ ॥")
                },
                {
                    id: "90001-4",
                    gurmukhi: "ਹੈ ਭੀ ਸਚੁ ਨਾਨਕ ਹੋਸੀ ਭੀ ਸਚੁ ॥੧॥",
                    transliteration: "hai bhee sach naanak hosee bhee sach ||1||",
                    translation: "True Here And Now. O Nanak, Forever True. ||1||",
                    translation_pu: "ਹਣ ਵੀ ਸੱਚ ਹੈ, ਹੇ ਨਾਨਕ, ਅਗਾਂਹ ਨੂੰ ਵੀ ਸੱਚ ਹੋਵੇਗਾ। ॥੧॥",
                    translation_hi: "अब भी सच है, हे नानक, भविष्य में भी सच होगा। ॥१॥",
                    transliteration_hi: "है भी सचु नानक होसी भी सचु ॥੧॥",
                    larivaar: getAcronym("ਹੈ ਭੀ ਸਚੁ ਨਾਨਕ ਹੋਸੀ ਭੀ ਸਚੁ ॥੧॥")
                }
            ]
        },
        {
            shabadId: 90002,
            bani: "Sri Guru Granth Sahib Ji",
            raag: "Aasaa",
            page: 384,
            lines: [
                {
                    id: "90002-1",
                    gurmukhi: "ਮੇਰੇ ਸਾਹਿਬਾ ਤੂ ਮੇਰੇ ਮਨ ਕੀ ਪ੍ਰੀਤਿ ॥",
                    transliteration: "mere sahiba too mere man kee preet ||",
                    translation: "O my Lord and Master, You are the Love of my mind.",
                    translation_pu: "ਹੇ ਮੇਰੇ ਮਾਲਕ! ਤੂੰ ਮੇਰੇ ਦਿਲ ਦਾ ਪਿਆਰ ਹੈਂ।",
                    translation_hi: "हे मेरे स्वामी! तुम मेरे मन की प्रीति हो।",
                    transliteration_hi: "मेरे साहिबा तू मेरे मन की प्रीति ॥",
                    larivaar: getAcronym("ਮੇਰੇ ਸਾਹਿਬਾ ਤੂ ਮੇਰੇ ਮਨ ਕੀ ਪ੍ਰੀਤਿ ॥")
                },
                {
                    id: "90002-2",
                    gurmukhi: "ਤੂ ਮੇਰਾ ਸਖਾ ਹਰਿ ਜੀਉ ਤੂ ਮੇਰੀ ਮੀਤਿ ॥ ਰਹਾਉ ॥",
                    transliteration: "too mera sakha har jeeo too meree meet || rahao ||",
                    translation: "You are my Companion, O Dear Lord, You are my Friend. ||Pause||",
                    translation_pu: "ਤੂੰ ਮੇਰਾ ਸਾਥੀ ਹੈਂ, ਹੇ ਪਿਆਰੇ ਹਰੀ! ਤੂੰ ਮੇਰੀ ਸਹੇਲੀ ਹੈਂ। ॥ਰਹਾਉ॥",
                    translation_hi: "तुम मेरे सखा हो, हे प्यारे प्रभु! तुम मेरी सहेली हो। ॥रहाउ॥",
                    transliteration_hi: "तू मेरा सखा हरि जीउ तू मेरी मीत ॥ रहाउ ॥",
                    larivaar: getAcronym("ਤੂ ਮੇਰਾ ਸਖਾ ਹਰਿ ਜੀਉ ਤੂ ਮੇਰੀ ਮੀਤਿ ॥ ਰਹਾਉ ॥")
                }
            ]
        },
        {
            shabadId: 90003,
            bani: "Sri Guru Granth Sahib Ji",
            raag: "Bhairao",
            page: 1144,
            lines: [
                {
                    id: "90003-1",
                    gurmukhi: "ਤੂ ਮੇਰਾ ਪਿਤਾ ਤੂਹੈ ਮੇਰਾ ਮਾਤਾ ॥",
                    transliteration: "too mera pita tuhai mera mata ||",
                    translation: "You are my Father, and You are my Mother.",
                    translation_pu: "ਤੂੰ ਮੇਰਾ ਪਿਤਾ ਹੈਂ ਅਤੇ ਤੂੰ ਹੀ ਮੇਰੀ ਮਾਂ ਹੈਂ।",
                    translation_hi: "तुम मेरे पिता हो और तुम ही मेरी माता हो।",
                    transliteration_hi: "तू मेरा पिता तूहै मेरा माता ॥",
                    larivaar: getAcronym("ਤੂ ਮੇਰਾ ਪਿਤਾ ਤੂਹੈ ਮੇਰਾ ਮਾਤਾ ॥")
                },
                {
                    id: "90003-2",
                    gurmukhi: "ਤੂ ਮੇਰਾ ਬੰਧਪੁ ਤੂ ਮੇਰਾ ਭ੍ਰਾਤਾ ॥",
                    transliteration: "too mera bandhap too mera bhrata ||",
                    translation: "You are my Relative, and You are my Brother.",
                    translation_pu: "ਤੂੰ ਮੇਰਾ ਰਿਸ਼ਤੇਦਾਰ ਹੈਂ ਅਤੇ ਤੂੰ ਮੇਰਾ ਭਰਾ ਹੈਂ।",
                    translation_hi: "तुम मेरे रिश्तेदार हो और तुम मेरे भाई हो।",
                    transliteration_hi: "तू मेरा बंधपु तू मेरा भ्राਤਾ ॥",
                    larivaar: getAcronym("ਤੂ ਮੇਰਾ ਬੰਧਪੁ ਤੂ ਮੇਰਾ ਭ੍ਰਾਤਾ ॥")
                }
            ]
        }
    ];

    for (const shbd of mockShabadsData) {
        await Shabad.findOneAndUpdate(
            { shabadId: shbd.shabadId },
            shbd,
            { upsert: true }
        );
        logger.info({ event: "mock_shabad_imported", shabadId: shbd.shabadId }, `Mock Shabad ${shbd.shabadId} seeded`);
    }

    logger.info({ event: "mock_sync_complete" }, "Mock shabads sync completed successfully");
};

const migrateExistingLarivaar = async (): Promise<void> => {
    await connectDB();
    logger.info({ event: "larivaar_migration_start" }, "Larivaar acronym migration starting");

    let count = 0;
    const shabads = await Shabad.find({});
    for (const shbd of shabads) {
        let updated = false;
        const lines = shbd.lines || [];
        for (const line of lines) {
            if (!line.larivaar) {
                const gurmukhi = line.gurmukhi || "";
                line.larivaar = getAcronym(gurmukhi);
                updated = true;
            }
        }
        if (updated) {
            shbd.markModified("lines");
            await shbd.save();
            count++;
        }
    }

    logger.info({ event: "larivaar_migration_complete", migratedCount: count }, `Larivaar acronym migration completed. Migrated ${count} shabads`);
};

const QuerySchema = z.object({
    mode: z.enum(["full", "banis", "shabads", "mock", "larivaar"]).default("full"),
    source: z.string().max(100).optional(),
});

const refreshCorpusMeta = async (): Promise<void> => {
    try {
        await connectDB();
        const count = await Shabad.countDocuments({});
        await setCorpusMeta(count);
        logger.info({ event: "corpus_meta_refreshed", count }, "Redis corpus meta updated");
    } catch (e) {
        logger.warn(
            { event: "corpus_meta_refresh_failed", error: e instanceof Error ? e.message : "unknown" },
            "Failed to refresh corpus meta"
        );
    }
};

export const GET = async (req: Request): Promise<NextResponse> => {
    if (env.IMPORT_API_KEY) {
        const headerKey = req.headers.get("x-api-key");
        if (headerKey !== env.IMPORT_API_KEY) {
            logger.warn({ event: "import_unauthorized" }, "Import attempted without valid API key");
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
    } else if (env.NODE_ENV === "production") {
        logger.error({ event: "import_misconfigured" }, "IMPORT_API_KEY not set in production");
        return NextResponse.json({ error: "Import disabled — IMPORT_API_KEY not configured" }, { status: 503 });
    }

    const rate = await enforceImportRateLimit(req);
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

    const lock = await acquireImportLock();
    if (!lock.acquired) {
        return NextResponse.json(
            { error: "Import already in progress", code: "IMPORT_LOCKED" },
            { status: 409 }
        );
    }

    const { searchParams } = new URL(req.url);
    const parsed = QuerySchema.safeParse({
        mode: searchParams.get("mode") ?? undefined,
        source: searchParams.get("source") ?? searchParams.get("sourceId") ?? undefined,
    });

    if (!parsed.success) {
        await releaseImportLock(lock.token);
        return NextResponse.json(
            { error: "Invalid query parameters", details: parsed.error.flatten().fieldErrors },
            { status: 400 }
        );
    }

    const { mode, source } = parsed.data;

    const run = async () => {
        try {
            if (mode === "mock") {
                await syncMockShabads();
            } else if (mode === "larivaar") {
                await migrateExistingLarivaar();
            } else if (mode === "banis") {
                await syncAllBanisFromBanidb(source);
            } else if (mode === "shabads") {
                await syncShabadsFromBanidb();
            } else {
                await runFullSync();
            }
            await refreshCorpusMeta();
        } finally {
            await releaseImportLock(lock.token);
        }
    };

    run().catch((e) => {
        const error = e instanceof Error ? e.message : "unknown";
        logger.error({ event: "import_run_failed", error }, "Import run failed");
        void releaseImportLock(lock.token);
    });

    return NextResponse.json({
        message: "Import triggered",
        mode,
        instruction: "Serverless may kill long jobs after ~60s — run locally for full sync. Use ?mode=mock for fast local testing, or ?mode=larivaar to compute acronyms for existing shabads.",
        status: "Running...",
    });
};
