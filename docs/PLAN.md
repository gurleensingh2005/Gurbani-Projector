# End-to-End Plan: Production-Grade "Shazam for Gurbani" — Cloud + Mobile

> A junior-developer-consumable plan to take `gurbani_projector` from MVP to production as a **cloud-hosted SaaS** with a **native mobile sangat app**. Each phase begins with **Research First** (read these before coding), then **Build**, then **Acceptance**.

---

## Context

**Product**: A live system where a Sikh ragi sings shabads from Sri Guru Granth Sahib, the system identifies the line in real time, and a projector at the gurdwara displays Gurmukhi + Sant Singh Khalsa English translation. Sangat (congregation) phones run a native iOS/Android app that joins the room via QR code and shows the same line synced.

**Why this plan**: The current `gurbani_projector` is a working MVP but **not production-grade**. A prior audit catalogued 40 issues across security, infra, observability, and matcher correctness. Replacing the Web Speech API (the accuracy ceiling) is the highest-leverage move; the existing matcher is genuinely good and only needs augmentation.

**Locked architecture decisions** (do not relitigate without explicit go-ahead):
- **Distribution model**: **Cloud-hosted SaaS**. Gurdwaras pay a small monthly fee per room. They bring their own laptop / mini-PC and a USB audio interface; the heavy compute (STT + matching) runs in our cloud.
- **Operator surface**: Browser-based projector app served from the cloud. Any modern Chromium / Safari device with a mic input and an HDMI output works. No local install, no signed binaries, no Mac-Mini hardware bundle.
- **Sangat surface**: **Native mobile app** built with Expo (React Native), shipped to the iOS App Store and Google Play. Offline-capable. Native push, native QR scan, native audio focus when phone is locked.
- **Compute target**: NVIDIA GPU instances in the cloud (L4 / A10G class) running `faster-whisper` (CTranslate2 backend) with batching. Streaming protocol over WebSocket. Provider: **Modal** or **Fly.io GPU machines** (both autoscale-to-zero, both bill per-second). Avoid keeping a 24/7 GPU on for any single room.
- **STT primary model**: **Whisper-large-v3** via `faster-whisper` (NOT turbo — turbo regresses on low-resource languages including Punjabi, per OpenAI's own model card).
- **STT fallback**: AI4Bharat IndicConformer-600M (MIT, RNNT-streaming, Indic-native). Hosted as a sibling Modal/Fly service so it can be A/B-tested per room.
- **Resources**: Small team of 2–3 engineers. ~6-month arc to production-grade SaaS.
- **Constrained decoder**: Deferred to Phase 5+. Ship unconstrained Whisper + augmented fuzzy matcher for v1.
- **Corpus**: Mongo Atlas for ingestion / source-of-truth; SQLite snapshot bundled into the mobile app and into the matcher service for in-memory hot path.
- **Realtime fan-out**: **Ably** (managed pub/sub) for v1. Self-hosted Centrifugo is a Phase 7+ cost-optimisation only if Ably bills exceed ~$300/mo.
- **Hosting topology**:
  - Next.js app (operator projector + admin) → **Vercel**.
  - STT streaming service → **Modal** (preferred) or **Fly.io GPU machines**.
  - Matcher service → same node as STT to avoid extra hop, or co-located on Fly.io regions close to the user.
  - Mongo → **MongoDB Atlas** M10 starter.
  - Pub/sub → **Ably** managed.
  - Object storage (audio clips, signed URLs) → **Cloudflare R2** (no egress fees).
  - CDN → **Cloudflare** in front of Vercel for the projector static assets and in front of R2 for audio.

**Guiding principle**: A wrong line on the projector is worse than no line — sangat perceives it as disrespect to Gurbani. Every behavioural choice biases toward "hold previous line on low confidence" over "guess and correct."

---

## Table of contents

- Phase 0: Setup & verify
- Phase 1: Stop the bleeding (security, matcher correctness, infra hygiene)
- Phase 2: Eval harness
- Phase 3: Matching engine v2
- Phase 4: Cloud STT service — `faster-whisper` on Modal / Fly GPU
- Phase 5: Cloud deployment — Vercel + Atlas + Modal + Ably
- Phase 6: Native sangat mobile app (Expo / React Native)
- Phase 7: Production hardening, multi-tenancy & pilot
- Verification matrix
- Reading list

---

## Phase 0 — Setup & verify

The repo is currently in a broken state for production work: `npm run build` fails, no `.env.example`, README is boilerplate.

### Research first
- Read `README.md`, `banidb_vs_mongodb_analysis.md`, and walk every file under `src/`.
- Run-through of Next.js 16 app router: https://nextjs.org/docs/app
- Mongoose 9 connection patterns in serverless: https://www.mongodb.com/docs/drivers/node/current/

### Build
1. **Fix the build.**
   ```bash
   rm -rf node_modules .next package-lock.json
   npm install
   npm run build
   ```
   If Turbopack still panics, pin Next: try `next@15.x` in `package.json` and reinstall. The current build error is a Turbopack/Next-internals issue, not application code.

2. **Create `.env.example`** in repo root:
   ```
   MONGODB_URI=mongodb://localhost:27017/gurbani_projector
   NODE_ENV=development
   IMPORT_API_KEY=replace-with-32-byte-hex
   STT_WS_URL=ws://localhost:9090
   ABLY_API_KEY=
   ```
   Then copy to `.env.local` with real values. Use MongoDB Atlas free tier for cloud-mode dev, or a local Docker container (`docker run -d -p 27017:27017 mongo:7`) for offline dev.

3. **Replace `README.md`** with: project goal (1 paragraph), prerequisites (Node 20+, Mongo, mic), setup commands, env vars, how to run import, how to run dev. Keep under 100 lines.

4. **Run the data import** (locally — Vercel timeout will kill it):
   ```bash
   npm run dev
   curl -H "x-api-key: $IMPORT_API_KEY" http://localhost:3000/api/import?mode=full
   ```
   Takes ~1–2 hours. Idempotent: re-runs skip imported shabads.

5. **Verify dev loop works**: open `http://localhost:3000`, press Space, sing a Gurbani line. Note the line that gets matched.

### Acceptance
- `npm run build` exits 0.
- `npm run dev` serves the app; mic permission prompts; Web Speech API returns transcripts.
- `db.shabads.countDocuments()` ≥ 9000 in your Mongo (local or Atlas).
- README walks a new dev from clone to running app in < 15 minutes.

### Files touched
- `package.json` (possibly Next pin)
- `package-lock.json` (regenerated)
- `.env.example` (new)
- `README.md` (rewrite)

---

## Phase 1 — Stop the bleeding

The 40-item audit had 5 CRITICAL and 10 HIGH issues. Fix them before anything new lands. **Do not skip — Phase 2+ will compound on top of these.**

### Research first
- OWASP API Security Top 10: https://owasp.org/API-Security/editions/2023/en/
- Zod input validation: https://zod.dev/
- Pino structured logging: https://github.com/pinojs/pino

### Build

**Security & input validation:**
1. **Lock `/api/import` behind an API key.** Add `IMPORT_API_KEY` env var. In `src/app/api/import/route.ts`, reject requests missing `x-api-key` header. Without this, anyone on the internet can trigger a 10k-shabad re-sync — a real concern the moment the app is on Vercel.
2. **Add zod validation on `/api/search`** in `src/app/api/search/route.ts`. Schema: `{ query: z.string().max(500), currentShabadId: z.number().optional(), currentPage: z.number().optional() }`. Reject body > 100KB.
3. **Sanitize Mongo `$text` input** in `src/app/api/search/route.ts:214,248`. Strip `$`, `{`, `}`, leading dashes; reject if length < 2 or > 200.
4. **Add CSP + security headers** in `next.config.ts`:
   ```ts
   async headers() {
     return [{
       source: '/:path*',
       headers: [
         { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.banidb.com wss://*.ably.io wss://*.modal.run" },
         { key: 'X-Frame-Options', value: 'DENY' },
         { key: 'X-Content-Type-Options', value: 'nosniff' },
         { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
         { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
       ],
     }];
   },
   ```
5. **Rate-limit every public route** with Upstash Redis (Vercel-native): 60 req/min per IP for `/api/search`, 5 req/min per IP for `/api/auth/*`. Cloud exposure makes this non-optional.

**Matcher correctness — the wrong-line bug:**
6. **Move thresholds to config**. Create `src/config/search.ts`:
   ```ts
   export const SEARCH_CONFIG = {
     MIN_CONFIDENCE: 0.55,        // was 0.30 — too permissive
     HEADING_PENALTY: 0.65,       // was 0.38 — heading lines were leaking through
     PHASE_SWITCH_DELTA: 0.20,    // was 0.08 — caused jumpy shabad switches
     FALLBACK_THRESHOLD: 0.75,    // was 0.65
     LOCAL_CACHE_THRESHOLD: 0.85, // keep
     PROXIMITY_BONUS_MAX: 0.18,
     DEBOUNCE_FAST_MS: 600,
     DEBOUNCE_SLOW_MS: 1500,
   } as const;
   ```
   Reference these from `src/app/api/search/route.ts` and `src/util/gurbani.ts`. **Every hardcoded number gets a name.**
7. **"Hold previous line on low confidence"** — in `src/hooks/useGurbaniProjector.ts`, when no candidate beats `MIN_CONFIDENCE`, do not blank the display; keep the last matched line. Log the failed match for observability.
8. **Acronym match guard** — in `src/app/api/search/route.ts:19`, before calling `getAcronymMatch`, verify the `larivaar` field is non-empty on at least 50% of sampled shabads. If not, log a warning and skip acronym phase.

**Infrastructure:**
9. **Mongo connection cleanup** in `src/lib/mongodb.ts`:
   ```ts
   if (typeof process !== 'undefined') {
     process.on('SIGTERM', async () => { await mongoose.disconnect(); });
   }
   ```
10. **Health endpoint** — new `src/app/api/health/route.ts`:
    ```ts
    import { connectDB } from '@/lib/mongodb';
    export async function GET() {
      try { await connectDB(); return Response.json({ status: 'ok', db: 'connected' }); }
      catch (e) { return Response.json({ status: 'down', db: 'error' }, { status: 503 }); }
    }
    ```
    This becomes the Vercel cron + uptime probe target in Phase 5.
11. **Structured logging** with pino. Replace every `console.log/error` in API routes. Log shape: `{ event, tenantId?, roomId?, latencyMs, score?, error? }`. Never log raw audio or raw transcripts to disk.
12. **Search-cache TTL** — in `src/app/api/search/route.ts:78`, add `expiresAt: Date.now() + 60_000` per entry; evict expired on read. (When deployed serverless, this in-process cache becomes worthless across cold starts; Phase 5 swaps it for Upstash Redis.)

**Code health:**
13. Delete `embedding` field from `src/model/shabad.ts` and the import path that populates it. Run a one-time Mongo migration: `db.shabads.updateMany({}, { $unset: { 'lines.$[].embedding': '' } })`.
14. Remove `fuse.js` from `package.json` dependencies — never imported.
15. Audit `src/env.ts` (already exists) — ensure zod schema covers every env var and import it from `src/lib/mongodb.ts` to fail fast on missing `MONGODB_URI`.

### Acceptance
- `curl /api/import` without `x-api-key` returns 401.
- `curl -d '{"query":"$where:..."}' /api/search` returns 400.
- `curl /api/health` returns 200 with DB up; 503 with DB down.
- Headers visible in browser DevTools include CSP, HSTS, X-Frame-Options, X-Content-Type-Options.
- Matcher logs show structured pino entries with `score` field.
- App never displays a blank line during a kirtan; always holds previous match.

### Files touched
- `src/app/api/import/route.ts` (auth)
- `src/app/api/search/route.ts` (validation, sanitization, threshold refs, rate limit)
- `src/app/api/health/route.ts` (new)
- `src/config/search.ts` (new)
- `src/env.ts` (extend)
- `src/lib/mongodb.ts` (cleanup, env validation)
- `src/lib/rate-limit.ts` (new)
- `src/util/gurbani.ts` (threshold refs)
- `src/hooks/useGurbaniProjector.ts` (hold-previous-line behaviour)
- `src/model/shabad.ts` (delete `embedding`)
- `next.config.ts` (security headers)
- `package.json` (remove fuse.js, add zod + pino + `@upstash/ratelimit`)

---

## Phase 2 — Eval harness

**Without a measurable eval, every STT and matcher decision is a guess.** This phase builds the harness that unblocks every later choice — including which cloud STT provider to pick.

### Research first
- WER vs line-match accuracy — for our use case, line-match is the only metric that matters.
- yt-dlp: https://github.com/yt-dlp/yt-dlp
- ffmpeg basics for audio extraction (16kHz mono WAV).
- Read your existing matcher in `src/app/api/search/route.ts` end-to-end; understand what the eval needs to call.

### Build
1. **Create `tools/eval/`** directory with:
   - `download.sh` — `yt-dlp -x --audio-format wav --postprocessor-args "-ac 1 -ar 16000"` to grab YouTube clips (e.g., `youtube.com/watch?v=xQC5vhS1lKQ` is the v0 sample).
   - `clips/` — downloaded WAVs.
   - `labels.csv` — manual ground truth: `clip_id, t_start_sec, t_end_sec, shabad_id, line_id, gurmukhi`.
   - `runner.ts` — pipes audio through a configurable STT backend, then through the live matcher, computes per-clip top-1 line accuracy.
   - `backends/` — pluggable STT adapters: `web-speech.ts` (current baseline), `openai-whisper-api.ts` (cheap baseline before we self-host), `faster-whisper-modal.ts` (Phase 4 target), `indic-conformer-modal.ts` (fallback).
   - `report.ts` — generates a markdown table: `model, total_segments, top1_accuracy, top3_accuracy, mean_confidence, mean_latency_ms, $/min`.

2. **Label v0 eval set**: 5 clips × ~5 minutes = 25 min of labelled kirtan. Start with the YouTube clip the user provided. Use Audacity or a simple in-browser labeller. Aim for ~150 labelled segments total.

3. **Wire the matcher as a callable library** — extract scoring logic from `src/app/api/search/route.ts` into `src/lib/matcher.ts` so the eval runner can call it directly without spinning up the Next.js server. The API route then becomes a thin HTTP wrapper around the same library. This same `src/lib/matcher.ts` becomes the import target for the cloud matcher service in Phase 4.

4. **Add per-match telemetry** in production code: every match emits a structured log with `{ roomId?, transcript, candidates: [{lineId, score}], chosen_lineId, latency_ms }`. Same shape as eval, so production data can be replayed through the harness later.

### Acceptance
- `npm run eval -- --backend=web-speech` runs end-to-end and produces a report.
- Baseline numbers exist: how good is the current Web Speech + matcher pipeline on the labelled set?
- Eval can be re-run after any matcher or STT change. Delta is visible.
- Cost-per-minute column populated for every cloud-STT backend tried.

### Files touched
- `tools/eval/` (new directory)
- `src/lib/matcher.ts` (new — extracted from API route)
- `src/app/api/search/route.ts` (refactored to use `lib/matcher`)
- `package.json` scripts: `"eval": "tsx tools/eval/runner.ts"`

---

## Phase 3 — Matching engine v2

Augment, don't replace. Use the eval harness from Phase 2 to measure each change.

### Research first
- The Tarteel.ai pattern (Quranic recitation matcher): closed-vocabulary alignment over scripture text. Find their public repos under `github.com/tarteel-ai`.
- N-gram inverted indices: 30-min CS refresher — https://en.wikipedia.org/wiki/Inverted_index
- Phonetic hashing: Soundex/Metaphone are English-tuned and useless for Gurmukhi; we'll build our own.
- Read all of `src/util/gurbani.ts` — the current matcher's brain.

### Build
1. **3-gram inverted index over naked Gurmukhi**. New module `src/lib/gram-index.ts`:
   - On boot, load all 60k lines from Mongo, strip matras, extract overlapping 3-character grams, build `Map<gram, Set<lineId>>`.
   - Query path: extract grams from filtered input, intersect candidate sets, return top ~200.
   - Score only those 200 with the existing `getNakedOverlapScore`. Drops worst-case latency 50–100x.
   - **Cloud note**: this index lives in matcher-service memory. Build once at boot from a SQLite snapshot baked into the container image to avoid Mongo round-trips on cold start.

2. **Gurmukhi phonetic hash**. New module `src/lib/phonetic.ts`:
   - Collapse consonants by point of articulation: ਕ/ਖ/ਗ/ਘ → "K" (velar); ਪ/ਫ/ਬ/ਭ → "P" (bilabial); ਤ/ਥ/ਦ/ਧ → "T" (dental); ਚ/ਛ/ਜ/ਝ → "C" (palatal); ਟ/ਠ/ਡ/ਢ → "RT" (retroflex); ਸ/ਸ਼ → "S"; ਹ → "H"; etc.
   - Use as tiebreaker when overlap score is close: bonus +0.05 if phonetic hash matches.
   - Catches Whisper's #1 Punjabi error: aspirated/unaspirated stop confusion.

3. **Probabilistic ang-locality prior**. Replace the binary ±1 page filter in `src/app/api/search/route.ts:241` with `weight = exp(-|page - currentPage| / 3)`. Smoother shabad transitions.

4. **Heading-line detection improvement** in `src/util/gurbani.ts:128`. Current regex is brittle. Add a flag on Mongo schema: `lines[].is_heading: boolean`, populated at import time by checking against a known list of heading patterns (Raag, Mehlaa, Ghar, Ashtpadi, Salok). Then at match time, multiply heading-line scores by 0.35 (was 0.62 in old penalty math).

5. **Run eval after each change**, commit per-change with the delta in the commit message.

### Acceptance
- Top-1 line accuracy on eval set improves vs Phase 1 baseline (record exact delta).
- p99 search latency on a populated index < 50ms (in-process — does not include network).
- No false positives on single-word queries: query "sat" no longer matches with confidence 1.0.

### Files touched
- `src/lib/gram-index.ts` (new)
- `src/lib/phonetic.ts` (new)
- `src/lib/matcher.ts` (integrate gram-index + phonetic hash)
- `src/util/gurbani.ts` (probabilistic prior)
- `src/model/shabad.ts` (add `is_heading` field)
- `src/app/api/import/route.ts` (populate `is_heading` at import)

---

## Phase 4 — Cloud STT service: `faster-whisper` on Modal / Fly GPU

Replace `react-speech-recognition` with a self-hosted Whisper-large-v3 streaming server, running on autoscale-to-zero GPU instances. **Per-room GPU spin-up on session start** — gurdwaras only run kirtan a few hours/day, so always-on GPUs are economic suicide.

### Research first
- `faster-whisper`: https://github.com/SYSTRAN/faster-whisper — CTranslate2 backend, ~4× speedup over `openai/whisper`, native CUDA.
- Modal: https://modal.com/docs/guide/gpu — read the GPU container, web-endpoint, and websocket guides. Modal autoscale-to-zero is the default; cold start ~10s for an L4 with a pre-baked image.
- Fly.io GPU machines: https://fly.io/docs/gpus/ — sibling option, billed per-second on `a10` or `l40s`.
- WhisperLive (Collabora): https://github.com/collabora/WhisperLive — production-ready streaming server reference. Consider forking instead of writing from scratch.
- UFAL `whisper_streaming` LocalAgreement-2 algorithm: https://github.com/ufal/whisper_streaming — token is emitted only when two successive decodes agree on it. Critical for the projector "no flicker" feel.
- Browser audio capture: `AudioWorklet` + WebSocket. https://web.dev/articles/audioworklet
- VAD: Silero VAD (https://github.com/snakers4/silero-vad) — gates speech vs silence, prevents wasted GPU on silence between shabads.

### Build
1. **Stand up `services/stt/`** — separate Python service deployed to Modal (preferred) or Fly GPU.
   - `faster-whisper` with `large-v3` model, `compute_type="float16"` on L4 GPU.
   - WebSocket endpoint accepting 16kHz mono PCM frames, framed at 250ms.
   - Implements LocalAgreement-2: decode rolling 6-second window every ~500ms; emit only stable-prefix tokens; finalize on VAD silence boundary.
   - Output schema: `{ type: 'partial'|'final', text, t_start, t_end, confidence }`.
   - **Per-room container**: each connected room gets its own Modal container (or Fly machine). On disconnect + 60s idle, container is reclaimed.
   - Bake the model weights into the container image — pulling from HuggingFace at boot adds 30s to cold start.

2. **Stand up `services/matcher/`** — a Node service (or co-located in the STT Python container as an HTTP sidecar) that imports `src/lib/matcher.ts` (Phase 2 extraction). Runs the gram-index in memory. STT WebSocket forwards finalized text directly to matcher; matcher publishes to Ably (Phase 5).
   - Co-locating matcher with STT in the same region keeps the hot-path round-trip < 50ms.

3. **Browser audio capture** — replace `react-speech-recognition` in `src/hooks/useGurbaniProjector.ts`:
   - `getUserMedia({ audio: true })` with `echoCancellation: false, noiseSuppression: false, autoGainControl: false` (kirtan audio is pristine line-out from a mixer; the browser DSP fights it).
   - `AudioWorklet` downsamples to 16kHz mono, base64-encodes 16-bit PCM frames.
   - WebSocket to `wss://stt.gurbaniprojector.com/room/<roomId>` (Modal endpoint, fronted by Cloudflare for TLS termination + DDoS).
   - On `partial` events, render to a "tentative" UI ghost line; on `final`, run matcher and commit.

4. **Cold-start UX**: on room creation, the projector page fires a "warm" ping to the STT service before the first audio frame, so the GPU is hot when the ragi starts singing. Display "Warming up… 8s" with a spinner. Document the cold-start budget in the operator manual.

5. **Run eval**: route `tools/eval/backends/faster-whisper-modal.ts` through the deployed service. Compare top-1 accuracy and **$/min** vs OpenAI Whisper API and Web Speech baselines.

6. **Run the IndicConformer fallback**: stand up a second Modal service. Same WebSocket protocol. Compare on eval set. Ship as `STT_BACKEND=indic-conformer` per-room override for testing.

### Acceptance
- Browser → cloud STT → matcher round-trip p95 < 1.2s (network-inclusive; includes ~150–250ms inter-region latency for India sangat hitting a Mumbai region).
- L4 GPU sustains ≥ 1× realtime for `large-v3` with 6s rolling window.
- Cold-start from zero containers to first partial transcript < 12s.
- Eval top-1 accuracy improves materially vs Web Speech baseline (target: ≥ 15 percentage points).
- App still works when STT service is down: graceful error, "STT unavailable" UI banner, projector stays on previous line. **Never blanks.**
- Cost-per-hour-of-kirtan documented (target < $0.40/hour at L4 spot pricing).

### Files touched
- `services/stt/` (new directory — Python, deployed to Modal)
- `services/matcher/` (new — Node, co-located)
- `services/Dockerfile` (new — model weights baked in)
- `src/hooks/useGurbaniProjector.ts` (replace `react-speech-recognition`)
- `src/lib/audio-worklet.ts` (new — 16kHz downsampler)
- `src/lib/stt-client.ts` (new — WebSocket client with reconnect)
- `package.json` (remove `react-speech-recognition`)
- `infra/modal-deploy.py` (new — Modal app definition)

---

## Phase 5 — Cloud deployment: Vercel + Atlas + Modal + Ably

Wire all the moving parts into a multi-tenant SaaS deployment.

### Research first
- Vercel deployments + preview environments: https://vercel.com/docs/deployments/overview
- Vercel cron jobs: https://vercel.com/docs/cron-jobs
- MongoDB Atlas + Vercel integration: https://www.mongodb.com/docs/atlas/reference/partner-integrations/vercel/
- Cloudflare in front of Vercel (Argo, R2, Workers): https://developers.cloudflare.com/
- Multi-tenant data modelling — single DB, tenant-scoped collections, indexes that include `tenantId` first.
- Stripe + Next.js subscriptions: https://docs.stripe.com/billing/subscriptions/quickstart

### Build
1. **Multi-tenant data model**. Add to Mongo:
   - `tenants` collection: `{ _id, name, slug, plan, createdAt, ownerEmail }`.
   - `rooms` collection: `{ _id, tenantId, name, sttBackend, translation, fontSize, createdAt }`.
   - `sessions` collection: `{ _id, tenantId, roomId, startedAt, endedAt, sttMinutesUsed, matchCount, operatorOverrides }`.
   - Every existing query that touches `shabads` is unchanged (corpus is shared); every new query touching room/session data must filter by `tenantId`.

2. **Auth**. Use **Clerk** (cheaper than Auth0 at this scale, Next.js-native). Tenant creation on first signup. Operator role per tenant.

3. **Stripe billing**. Two SKUs:
   - "Sangat Free" — 1 room, 5 hours/month STT, sangat app capped at 25 concurrent.
   - "Gurdwara" — £29/mo, 3 rooms, 200 hours/month STT, unlimited sangat clients.
   Webhook → updates `tenants.plan`. Hard-stop the STT WebSocket connect if monthly minutes exhausted.

4. **Vercel deploy** — push to `main` deploys to production. Configure:
   - `MONGODB_URI` → Atlas SRV string.
   - `STT_WS_URL` → Modal endpoint.
   - `ABLY_API_KEY` → Ably control-plane key.
   - `STRIPE_*`, `CLERK_*`.
   - Cron: `/api/cron/billing-reconcile` daily; `/api/cron/health-roundup` every 5 min.
   - Cloudflare in front: Argo Smart Routing for the projector route (latency-sensitive); R2 origin for static assets.

5. **Replace in-process search cache** (Phase 1 item 12) with Upstash Redis. Each cache hit shaves ~120ms off the matcher hot path on Vercel cold starts.

6. **Operator projector UX for cloud**: prominent "Connection: Strong / Weak / Reconnecting" indicator. The cloud round-trip means network instability is now an operator-visible failure mode. Add a one-tap "Switch to local fallback" toggle — falls back to Web Speech API in the browser if cloud STT is unavailable. Better degraded matching than no matching.

7. **Operator manual override UI**: prominent button on the projector that lets the sevadar (a) freeze the current line, (b) jump to a specific shabad via search, (c) thumbs-down a wrong match (logs it for telemetry). Non-negotiable per the ecosystem research — a wrong line on Gurbani is worse than no line.

8. **Region strategy**:
   - Vercel: default global edge.
   - Modal STT: deploy to `ap-south-1` (Mumbai) for India gurdwaras, `us-east-1` for North America, `eu-west-1` for UK / EU. Browser picks closest based on `cf-ipcountry` header.
   - Ably: global by default; no action needed.
   - Atlas: M10 in `us-east-1` for v1; add read replicas in Mumbai once India gurdwaras > 5.

### Acceptance
- New gurdwara signs up via web → Clerk login → Stripe checkout → first room created → projector running, all in < 5 minutes.
- Tenant isolation verified: a query as Tenant A cannot read Tenant B's rooms (write a test).
- Vercel preview deploy works for every PR.
- Lighthouse score on operator projector: Performance ≥ 90, Accessibility ≥ 95.
- Cost per active room per month documented (target < £6 at L4 spot pricing + minimal idle).

### Files touched
- `src/model/tenant.ts`, `src/model/room.ts`, `src/model/session.ts` (new)
- `src/middleware.ts` (Clerk auth, tenant scoping)
- `src/app/api/billing/webhook/route.ts` (new — Stripe)
- `src/app/(dashboard)/` (new — tenant admin UI)
- `src/lib/cache-redis.ts` (new — Upstash)
- `src/components/OperatorOverride.tsx` (new)
- `src/components/ConnectionIndicator.tsx` (new)
- `infra/vercel.json` (cron config)
- `infra/cloudflare-zone.tf` (optional Terraform)

---

## Phase 6 — Native sangat mobile app (Expo / React Native)

Sangat (congregation members) install a native app from the App Store / Play Store, scan a QR code at the gurdwara, and see the live shabad line synced. The app works offline for personal nitnem reading too.

### Research first
- Expo (managed React Native): https://docs.expo.dev/ — much faster path than bare RN; OTA updates via EAS.
- EAS Build & Submit: https://docs.expo.dev/build/setup/ — handles iOS provisioning + Play Console submission.
- Expo Camera (QR scan): https://docs.expo.dev/versions/latest/sdk/camera/
- Expo SQLite: https://docs.expo.dev/versions/latest/sdk/sqlite/ — bundles the `@sttm/banidb` SQLite snapshot for offline reading.
- Ably React Native SDK: https://ably.com/docs/getting-started/react-native
- Native font loading (Gurmukhi): https://docs.expo.dev/develop/user-interface/fonts/ — must ship Anmol Lipi or Mukti as a bundled asset.
- iOS background audio focus & "do not lock screen" entitlement: https://developer.apple.com/documentation/avfaudio/avaudiosession
- Indian DPDP Act 2023 + Apple/Google privacy nutrition labels.

### Build
1. **`mobile/` directory** — Expo workspace. Reuse the matcher? No — sangat app does not run STT or matching; it only subscribes to line IDs and renders. Reuse `src/lib/corpus-sqlite.ts` (Phase 5 work) by extracting it into a shared `packages/corpus/` workspace.

2. **Onboarding**:
   - Splash → "Scan gurdwara QR" or "Read on my own" (offline mode without a room).
   - QR scan → joins room via Ably channel `room:<roomId>` using a tenant-scoped token from `/api/mobile/join-token` (issues a short-lived Ably JWT scoped to that one channel).

3. **Live mode** (in-room):
   - Subscribe to Ably channel.
   - On line update, look up `lineId` in bundled SQLite, render Gurmukhi + chosen translation.
   - "Keep screen awake" while in active session.
   - Audio focus: do not interrupt iOS lock-screen now-playing.

4. **Offline mode** (anywhere):
   - Browse SGGS by ang or shabad.
   - Bookmark, dark mode, font size, multiple translations (Sant Singh Khalsa English, Manmohan Singh, Hindi, Punjabi).
   - Daily Hukamnama: pulled from `/api/hukamnama` once per day, cached.

5. **Push only line IDs, not text.** Sangat client resolves to text from local SQLite. Collapses Ably bandwidth ~50× at 5000 phones — a real cost lever.

6. **Auth-light**: no signup required for sangat. Anonymous device ID for analytics. If they want to sync bookmarks across devices, optional Clerk email login.

7. **Build & ship**:
   - `eas build --platform all` for iOS + Android.
   - `eas submit` to App Store Connect + Play Console.
   - Set up TestFlight + internal testing tracks.
   - Apple review: prepare a screencast showing in-room sync (review team won't have a gurdwara handy; ship a dev-only "demo room" that auto-cycles a sample shabad).
   - App name / metadata in English + Punjabi.

8. **Operator companion mobile** (optional, Phase 6.5): the same app, signed in as an operator, lets a sevadar from the front of the divan hall trigger overrides without touching the Mac at the projector. Same Ably channel, opposite direction (publish instead of subscribe). De-prioritise for v1; ship after first gurdwara complaints.

### Acceptance
- App approved on iOS App Store and Google Play.
- 50 simulated Ably clients all receive the same line update within 2 seconds (use Ably's `presence` to count).
- Cold-launch on iPhone 12: app opens, scans QR, shows first synced line in < 8 seconds.
- Airplane-mode test: app opens, browse SGGS, render any ang in offline mode.
- Battery test: 1-hour session draws < 8% on a 2-year-old Pixel.

### Files touched
- `mobile/` (new — Expo project)
- `packages/corpus/` (new — shared SQLite reader, used by matcher service + mobile + eventually web sangat fallback)
- `src/app/api/mobile/join-token/route.ts` (new — issues Ably JWT)
- `src/app/api/mobile/hukamnama/route.ts` (new)
- `src/lib/realtime-publisher.ts` (new — operator side, publishes to Ably)

---

## Phase 7 — Production hardening, multi-tenancy & pilot

### Research first
- OpenTelemetry for Node + Python: https://opentelemetry.io/docs/instrumentation/
- Sentry Next.js + React Native SDKs: https://docs.sentry.io/
- Datadog or Grafana Cloud for unified logs/traces/metrics across Vercel + Modal + mobile.
- Indian DPDP Act 2023 — voice is biometric; data-handling implications.
- App Store Privacy Nutrition Labels + Play Data Safety section.
- Cloudflare Turnstile (CAPTCHA-free bot detection) for `/api/mobile/join-token`.

### Build
1. **OpenTelemetry traces + match-quality dashboard.** Self-hosted Grafana + Tempo + Loki on a small VPS, OR Grafana Cloud free tier. Trace context propagates browser → Vercel → Modal STT → matcher → Ably. North-star metric: **% of finalized hypotheses producing a match above threshold**. Secondary: time-to-first-match, operator-correction rate, shabad-switch latency, GPU $/hour-of-kirtan.

2. **Sentry for errors** in: Next.js app, STT Python service, matcher Node service, Expo mobile app. Source maps uploaded for all four.

3. **Privacy & data retention**:
   - Drop raw audio after STT inference unless operator opts in for fine-tuning data collection. Voice is biometric.
   - Document retention policy in plain Punjabi + English consent form, surfaced on operator first-launch and on sangat app first-launch.
   - DPDP Act: nominate a data fiduciary contact, expose a data-deletion request endpoint.
   - App store privacy labels accurate: "Audio Data — collected for app functionality, not linked to identity, not used for tracking."

4. **`navigator.wakeLock.request('screen')`** in the projector web app — projector must never sleep mid-kirtan. Mobile app uses `expo-keep-awake` during active room subscription.

5. **Backup & disaster recovery**:
   - Atlas continuous backup enabled on M10.
   - Weekly snapshot of corpus → Backblaze B2 / R2.
   - Document the restore runbook.

6. **Cost dashboard & alarms**:
   - Daily Modal GPU spend per tenant (alarm > £20/day single tenant).
   - Ably message volume (alarm > 80% of plan).
   - Vercel bandwidth (alarm > 80% of plan).

7. **Pilot with 3 gurdwaras**, one sangat at a time. Collect:
   - 10+ hours of labelled kirtan audio (with consent) — your training-data moat for Phase 5+ constrained decoder.
   - Operator-correction logs.
   - Match-quality dashboard data.
   - Mobile app crash-free user rate (Sentry).

### Acceptance
- Match-quality dashboard live; SLO target ≥ 90% line-match accuracy on real gurdwara audio.
- Sentry catches a forced error end-to-end across web, STT service, and mobile app.
- 3 successful pilot programs (kirtans run without intervention).
- Mobile app crash-free sessions ≥ 99.5%.
- Cost-per-active-tenant ≤ £8/month at pilot scale.

---

## Verification matrix

| Phase | What to test | How |
|---|---|---|
| 0 | Build, dev loop | `npm run build && npm run dev`, manual smoke |
| 1 | Security, thresholds, hold-previous-line | `curl` against API routes; manual kirtan singing test |
| 2 | Eval harness end-to-end | `npm run eval -- --backend=web-speech` |
| 3 | Matcher accuracy delta | `npm run eval -- --backend=web-speech` (re-run, compare) |
| 4 | Cloud STT + matcher | `npm run eval -- --backend=faster-whisper-modal`; cold-start timer |
| 5 | Multi-tenant SaaS deploy | Stripe test signup; tenant-isolation jest test; Lighthouse |
| 6 | Mobile app, Ably fan-out | TestFlight install; k6 sim of 100 Ably subscribers; airplane-mode test |
| 7 | Observability, pilot | Grafana dashboards; pilot run with real sevadar |

---

## Reading list (give to junior on Day 1)

**Codebase entry points** (read in this order):
- `src/app/page.tsx` — main projector orchestrator
- `src/hooks/useGurbaniProjector.ts` — STT-to-search glue
- `src/app/api/search/route.ts` — the matcher (the heart)
- `src/util/gurbani.ts` — Gurmukhi text utilities
- `src/components/ShabadDisplay.tsx` — line rendering
- `src/app/api/import/route.ts` — BaniDB sync
- `banidb_vs_mongodb_analysis.md` — prior architectural pivots

**External, in order of relevance:**
- Tarteel.ai blog & repos (the architecture we're copying without saying so) — `github.com/tarteel-ai`
- Whisper paper (Radford 2022) — https://cdn.openai.com/papers/whisper.pdf
- `faster-whisper` README — https://github.com/SYSTRAN/faster-whisper
- Modal docs (GPU + WebSocket) — https://modal.com/docs/guide/gpu
- AI4Bharat IndicConformer — https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual (verified MIT license, supports Punjabi)
- Shabad OS data layer — `github.com/shabados/database` (use it as a reference, don't reimplement)
- @sttm/banidb npm package — already a dependency; the canonical SGGS data
- Expo docs — https://docs.expo.dev/
- Ably realtime patterns — https://ably.com/docs/realtime/

**Domain (non-negotiable for any engineer working on this):**
- Read the first 5 angs of Sri Guru Granth Sahib in Gurmukhi + Sant Singh Khalsa English. Without basic familiarity with what the system is matching, every design decision is uninformed.
- Visit a gurdwara during kirtan. Watch the existing STTM operator. Note what goes wrong.

---

## Out of scope for this plan

- Constrained decoder (Phase 5+ research project, deferred per locked decisions).
- Self-hosted Centrifugo (deferred behind Ably until cost requires the swap).
- Bare-metal / Tauri local-install distribution — explicitly replaced by cloud SaaS in this revision. Revisit only if a major gurdwara demands an air-gapped install.
- Operator-side native mobile app (Phase 6.5; ship the sangat app first).
- Translations beyond Sant Singh Khalsa English + Roman transliteration + Gurmukhi for v1; Manmohan Singh / Hindi / Punjabi exposed via settings toggle but not the default.
- Akhand path live-alignment (a separate, easier product — flag for after main launch).
- Apple Watch / Wear OS companions for sangat (post-v1; if requested, Apple Watch first).
