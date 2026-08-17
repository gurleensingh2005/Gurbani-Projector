# Gurbani Projector — Complete Code Guide

**Live audio → Gurbani line matcher.**  
Ragi kirtan gaata hai → browser mic sunta hai → system real-time mein SGGS line identify karta hai → projector pe Gurmukhi + translation dikhta hai.

> **Status:** Working MVP  
> **STT (Speech-to-Text):** Browser Web Speech API (`pa-IN`) — Phase 0 baseline  
> **Roadmap:** Production plan → [`docs/PLAN.md`](docs/PLAN.md)

---

## 1. Yeh project kya karta hai? (Simple flow)

```
🎤 Mic (Ragi voice)
    ↓
Browser Web Speech API  →  "sat naam waheguru..." (transcript)
    ↓
useGurbaniProjector hook  →  clean + debounce + noise filter
    ↓
① Pehle LOCAL match (current shabad ke andar) — fast
② Warna POST /api/search  →  MongoDB + fuzzy scoring
    ↓
Best matching line + full shabad
    ↓
📺 ShabadDisplay  →  active line highlight + translations
```

**Golden rule:** Galat line dikhana blank se bura hai. Low confidence pe pehli matched line hold hoti hai.

---

## 2. Tech stack

| Layer | Technology |
|--------|------------|
| Framework | **Next.js 16** (App Router) |
| UI | **React 19** + **Tailwind CSS 4** |
| State | **Redux Toolkit** |
| Database | **MongoDB** + **Mongoose 9** |
| Cache / RL | **Upstash Redis** (optional locally; see [`docs/REDIS_IMPLEMENTATION_PLAN.md`](docs/REDIS_IMPLEMENTATION_PLAN.md)) |
| Gurbani source | **BaniDB API** (`@sttm/banidb`, `api.banidb.com`) |
| STT | **react-speech-recognition** (Chrome/Edge) |
| Validation | **Zod** |
| Logging | **Pino** |
| Language | **TypeScript** |

---

## 3. Setup (zero se chalana)

### Prerequisites
- Node.js **20+**
- MongoDB (local Docker ya Atlas)
- Microphone (USB audio interface best; laptop mic weak)
- Browser: **Chrome** ya **Edge** (Safari continuous STT support nahi)

### Steps

```bash
# 1. Install
npm install

# 2. Local Mongo (agar Atlas nahi hai)
docker run -d -p 27017:27017 --name gurbani-mongo mongo:7

# 3. Env file banao (see .env.example)
cp .env.example .env.local
# edit: MONGODB_URI, IMPORT_API_KEY
# optional Upstash Redis:
#   UPSTASH_REDIS_REST_URL=...
#   UPSTASH_REDIS_REST_TOKEN=...
#   REDIS_REQUIRED=false

# 4. Dev server
npm run dev
```

Open: [http://localhost:3000](http://localhost:3000)


**Redis (optional):** search-result cache, rate limits, import lock. Bina Redis ke app chalega (degraded). Full guide → [`docs/REDIS_IMPLEMENTATION_PLAN.md`](docs/REDIS_IMPLEMENTATION_PLAN.md).

### Gurbani corpus import (ek baar zaroori)

Matcher ko Mongo mein ~10k shabads chahiye. BaniDB se sync ~1–2 hours:

```bash
curl -H "x-api-key: YOUR_IMPORT_API_KEY" "http://localhost:3000/api/import?mode=full"
```

| Mode | Meaning |
|------|---------|
| `mode=full` | Shabads + banis (default) |
| `mode=shabads` | Sirf shabads |
| `mode=banis&source=dasam` | Specific bani sources |

Idempotent hai — pehle se imported records skip ho jaate hain.

> **Note:** Vercel functions 60s pe timeout. Import **local** pe chalao.

### Verify

```bash
npm run build
curl http://localhost:3000/api/health
# → {"status":"ok","db":"connected",...}

curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"sat naam"}'
```

Browser mein **Space** dabao → listening start → Gurbani line gao → match highlight hona chahiye.  
**F** = fullscreen.

---

## 4. Folder structure (poora map)

```
gurbani_projector/
├── docs/
│   └── PLAN.md                 # 16-week production roadmap (cloud STT, mobile, SaaS)
├── public/                     # Static assets, PWA manifest, test HTML
├── src/
│   ├── app/                    # Next.js App Router (pages + API)
│   ├── modules/                # ★ BUSINESS LOGIC (naya modular layer)
│   ├── shared/                 # ★ Shared UI, hooks, utils (naya)
│   ├── core/                   # ★ Env, DB, logger (naya)
│   ├── store/                  # ★ Redux store + slices
│   │
│   ├── components/             # (legacy aliases / older copies)
│   ├── hooks/                  # (re-exports → shared/)
│   ├── util/                   # (older utils; logic ab modules/shared mein)
│   ├── lib/                    # (re-exports → core/)
│   ├── model/                  # (older model; canonical → modules/gurbani/models)
│   ├── context/                # (legacy settings)
│   ├── config/                 # (legacy search config)
│   └── env.ts                  # re-export → core/config
│
├── package.json
├── next.config.ts
└── README.md                   # yeh file
```

### Important note (refactor in progress)

Codebase **do layers** mein hai:

1. **Canonical (use yeh):** `src/modules/`, `src/shared/`, `src/core/`, `src/store/`
2. **Legacy / thin wrappers:** `src/components/`, `src/hooks/`, `src/util/`, `src/lib/`, `src/model/`

`page.tsx` already **shared + modules** use karta hai. Naya code wahi pe likho.

---

## 5. Layer-by-layer explanation

### 5.1 `src/app/` — Entry points (UI + HTTP)

| File | Kaam |
|------|------|
| `layout.tsx` | Root layout: fonts (Gurmukhi/Devanagari), Redux `StoreProvider`, `SettingsProvider` |
| `page.tsx` | Main projector screen — Space/F keys, mic button, settings, `ShabadDisplay` |
| `globals.css` | Theme, glass morphism, CSS variables |
| `api/search/route.ts` | Thin wrapper → `gurbani.controller` (matcher heart) |
| `api/import/route.ts` | BaniDB → Mongo sync (API-key protected) |
| `api/health/route.ts` | DB health check |
| `api/debug/route.ts` | Debug helpers |

### 5.2 `src/modules/gurbani/` — Matching engine (dil)

Yahan asli business logic hai:

```
modules/gurbani/
├── controllers/gurbani.controller.ts   # HTTP: zod validate, cache, response
├── services/gurbani-search.service.ts  # ★ score + candidate evaluate + executeSearch
├── repositories/gurbani-mongo.repository.ts  # Mongo queries ($text, ang range)
├── models/shabad.model.ts              # Mongoose schema (Shabad + lines)
├── gurbani.constants.ts                # SEARCH_CONFIG (saare thresholds)
├── gurbani.helper.ts                   # cleanTranscript, local match, acronym
├── gurbani.utils.ts / gurbani.service.ts / gurbani.repository.ts  # re-exports
```

**Search kaise chalti hai (server):**

1. Query sanitize + Hindi→Gurmukhi / noise filter  
2. Mongo `$text` search se candidate shabads  
3. Har line pe `scoreLine()` — naked Gurmukhi / phonetic translit + DTW-style alignment  
4. Current shabad/page pe proximity bonus  
5. Heading lines pe penalty  
6. Confidence ≥ `MIN_CONFIDENCE` (0.55) → match return; warna null / hold previous (client)

### 5.3 `src/modules/stt/` — Speech text cleanup

| File | Kaam |
|------|------|
| `stt.service.ts` | STT-related service entry |
| `services/stt-normalizer.service.ts` | Speech noise filter (`dha`, `tin`, tabla syllables, etc.) |

Abhi STT browser mein hai; yeh module transcript ko searchable banata hai.

### 5.4 `src/shared/` — UI + client glue

```
shared/
├── hooks/use-gurbani-projector.ts   # ★ Mic → transcript → local/API search → Redux
├── components/
│   ├── projector/shabad-display.tsx # Active line + translations render
│   ├── settings/settings-modal.tsx  # Font, theme, translation prefs
│   └── ui/
│       ├── home-placeholder.tsx     # Empty state (ੴ)
│       └── lotus-background.tsx     # Decorative background
├── context/settings.context.tsx     # Settings React context
└── utils/
    ├── alignment.ts                 # Word subsequence alignment (DTW-like)
    ├── gurbani-text-normalizer.ts   # Hindi→Gurmukhi, text normalize
    └── gurbani-text-normalizer.constants.ts
```

### 5.5 `src/core/` — Infrastructure

| File | Kaam |
|------|------|
| `config/env.config.ts` | Zod-validated env (`MONGODB_URI`, `IMPORT_API_KEY`, …) |
| `database/mongodb.connection.ts` | Cached Mongo connection (serverless-safe) |
| `redis/*` | Upstash client, search cache, rate limit, import lock |
| `logger/logger.service.ts` | Pino structured logger |

**Rule:** `process.env` directly mat padho — `env` object use karo.

### 5.6 `src/store/` — Redux state

```
store/
├── store.ts                 # configureStore
├── store-provider.tsx       # Client Provider
├── store.hooks.ts           # useAppDispatch / useAppSelector
└── slices/
    ├── search.slice.ts      # transcript, lastSearch, errors
    ├── shabad.slice.ts      # activeShabad + matchedLine
    ├── projector.slice.ts   # activeLineId, UI projector state
    ├── settings.slice.ts    # settings (Redux side)
    ├── session.slice.ts     # session (future multi-room)
    └── socket.slice.ts      # realtime socket (future Ably/etc.)
```

---

## 6. Data model (Mongo)

**Collection:** `shabads`

```ts
{
  shabadId: number,      // unique, indexed
  bani: string,
  raag: string,
  page: number,          // ang
  lines: [
    {
      id: string,
      gurmukhi: string,
      transliteration: string,      // English
      transliteration_hi: string,   // Hindi
      translation: string,          // English
      translation_pu: string,
      translation_hi: string,
      larivaar: string
    }
  ]
}
```

**Text index:** `lines.gurmukhi` (weight 10) + `lines.transliteration` (weight 5).

---

## 7. Client flow (detail)

File: `src/shared/hooks/use-gurbani-projector.ts`

1. **Space / mic button** → `SpeechRecognition.startListening({ continuous: true, language: 'pa-IN' })`
2. Har naya `transcript`:
   - Noise check (`isProbableNoise`)
   - Rolling window (last ~8 words)
   - Debounce: 4+ words → 600ms, warna 1500ms
3. **Local fast path:** agar pehle se shabad loaded hai → `attemptLocalMatch`  
   - Score ≥ `LOCAL_CACHE_THRESHOLD` (0.85) → API skip
4. **API path:** `POST /api/search` with `{ query, currentShabadId, currentLineId, currentPage }`
5. Match aane pe Redux update → `ShabadDisplay` scroll + highlight
6. Match ke baad ~1s patience (`PATIENCE_AFTER_MATCH_MS`) — flicker kam

---

## 8. API reference

### `POST /api/search`
Body:
```json
{
  "query": "sat naam",
  "currentShabadId": 123,
  "currentLineId": "456",
  "currentPage": 1
}
```
Response (success): `{ match, matchedLine, shabad }`

### `GET /api/import?mode=full`
Header: `x-api-key: <IMPORT_API_KEY>`  
BaniDB se Mongo fill.

### `GET /api/health`
DB + Redis status (`up` / `skipped` / `down`) + optional `corpusCount`.

### `GET /api/warmup`
Mongo se shabad count padh kar Redis corpus meta refresh.

---

## 9. Config — magic numbers kahan hain?

**Sirf yahan:** `src/modules/gurbani/gurbani.constants.ts` → `SEARCH_CONFIG`

Examples:
- `MIN_CONFIDENCE: 0.55` — isse neeche match reject
- `LOCAL_CACHE_THRESHOLD: 0.85` — local match pe API skip
- `DEBOUNCE_FAST_MS / DEBOUNCE_SLOW_MS` — STT search timing
- `HEADING_PENALTY` — Raag/Mehla headings galat match na hon

Naye thresholds hardcode mat karo — yahan add karo.

---

## 10. Development conventions

1. Matcher thresholds → `gurbani.constants.ts`
2. Env → `core/config/env.config.ts` (zod)
3. Logs → `logger` (pino), API routes mein `console.log` mat
4. New API → zod validate body; Mongo `$text` mein raw user input mat daalo
5. Naya UI → `src/shared/components/`
6. Naya business logic → `src/modules/`

---

## 11. Kaunsi file pehle padho? (learning order)

Junior / naye developer ke liye yeh order best hai:

1. `src/app/page.tsx` — UI orchestrator  
2. `src/shared/hooks/use-gurbani-projector.ts` — STT → search glue  
3. `src/modules/gurbani/controllers/gurbani.controller.ts` — API entry  
4. `src/modules/gurbani/services/gurbani-search.service.ts` — scoring brain  
5. `src/modules/gurbani/gurbani.helper.ts` — local match + transcript clean  
6. `src/shared/components/projector/shabad-display.tsx` — screen render  
7. `src/modules/gurbani/models/shabad.model.ts` — data shape  
8. `src/app/api/import/route.ts` — corpus kaise aata hai  
9. `docs/PLAN.md` — aage kya banana hai  
10. `banidb_vs_mongodb_analysis.md` — pehle ke architecture decisions  

---

## 12. Architecture diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Projector UI)                                     │
│  page.tsx → useGurbaniProjector → Redux store               │
│       │                                                     │
│       ├─ local match (helper) ──┐                           │
│       └─ fetch /api/search ─────┤                           │
└─────────────────────────────────┼───────────────────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────┐
│  Next.js API                                                │
│  gurbani.controller → gurbani-search.service                │
│       │                                                     │
│       ▼                                                     │
│  MongoDB (shabads collection) ←── BaniDB import             │
└─────────────────────────────────────────────────────────────┘
```

---

## 13. Future (short)

Abhi MVP. `docs/PLAN.md` mein full plan:

- Web Speech → cloud **faster-whisper** (GPU)
- Matching v2 (3-gram index + phonetic hash)
- Multi-tenant SaaS (Vercel + Atlas + Ably)
- Sangat mobile app (Expo)

---

## 14. Scripts

```bash
npm run dev      # development
npm run build    # production build
npm run start    # serve production build
npm run lint     # ESLint
```

---

**TL;DR:** Mic se awaaz aati hai → text banti hai → pehle current shabad mein local match → warna Mongo fuzzy search → sahi line projector pe highlight.  
Code padhne ke liye start: `page.tsx` → `use-gurbani-projector.ts` → `gurbani-search.service.ts`.
