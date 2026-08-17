# Redis Implementation — Gurbani Projector

Upstash Redis is the shared serverless cache / rate-limit / lock layer. It does **not** store the SGGS corpus (Mongo remains source of truth) and does **not** replace the in-memory / browser matcher.

## What Redis is used for

| Use | Key pattern | TTL |
|-----|-------------|-----|
| Search result cache | `gp:search:v1:{hash}` | 60s (hits), 5s (nulls) |
| Full shabad (after first match) | `gp:shabad:v1:{shabadId}` | 1h — same shabad pe Mongo skip |
| Search rate limit | `gp:rl:search:*` | sliding 60/min |
| Import rate limit | `gp:rl:import:*` | sliding 5/min |
| Import single-flight lock | `gp:lock:import` | 2h |
| Corpus count meta | `gp:meta:corpus:count` | 1h |
| Warmup timestamp | `gp:meta:warmup:at` | 24h |

## Packages

```bash
npm i @upstash/redis @upstash/ratelimit
```

## Env

```bash
UPSTASH_REDIS_REST_URL=https://xxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=...
REDIS_REQUIRED=false
```

Copy from `.env.example`. Locally, leave Redis unset — search still works (L1 Map only, no distributed RL/lock).

Production (Vercel): set both Upstash vars; set `REDIS_REQUIRED=true` when you want boot to fail without Redis.

## Module layout

```
src/core/redis/
  redis.client.ts         # getRedis(), pingRedis()
  redis.keys.ts           # key builders + TTLs
  redis.cache.service.ts  # L1 Map + L2 Upstash get/set + corpus meta
  redis.rate-limit.ts     # search + import limiters
  redis.lock.service.ts   # import NX lock
  index.ts
src/lib/cache-redis.ts    # thin re-export
```

## Request flow (search)

1. Rate limit (fail-open if Redis missing)
2. Optional `CORPUS_EMPTY` if Redis meta count is `0`
3. Build cache key from `query | shabadId | page`
4. Redis/L1 GET → `X-Cache: HIT` and return (skip matcher)
5. Miss → `executeSearch`:
   - agar `currentShabadId` pe pehle se `gp:shabad:v1:{id}` hai → sirf us shabad pe score (**Mongo nahi**), header `X-Cache: SHABAD`
   - pehli baar match → poora shabad Redis mein 1h ke liye store
6. Query-level SET hit (60s) or short null (5s)

## Import flow

1. API key check
2. Rate limit 5/min → 429
3. `SET gp:lock:import NX EX 7200` → 409 if busy
4. Background sync; on finish refresh corpus meta + release lock

## Ops commands

```bash
# Health (db + redis + corpusCount)
curl http://localhost:3000/api/health

# Refresh Redis corpus meta from Mongo
curl http://localhost:3000/api/warmup

# Search (second identical call should show X-Cache: HIT when Redis configured)
curl -i -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"sat naam"}'

# Import (second concurrent call → 409 when Redis configured)
curl -H "x-api-key: $IMPORT_API_KEY" "http://localhost:3000/api/import?mode=mock"
```

## Graceful degrade

| Condition | Behaviour |
|-----------|-----------|
| Redis env missing | `getRedis()` null; L1 cache only; RL skipped (search); import lock noop |
| Redis ping fail | Health `redis: "down"`, status `degraded`; search fail-open |
| `REDIS_REQUIRED=true` without creds | Process throws at boot |
| `corpusCount === 0` in Redis | Search returns 503 `CORPUS_EMPTY` |

## Hard rules

- Do **not** call Redis on client speech-start — only when `/api/search` or `/api/import` / `/api/warmup` / `/api/health` runs.
- Do **not** use Redis as the fuzzy matcher.
- Do **not** cache null matches longer than 5 seconds.

## Acceptance checklist

- [ ] Same query twice → second response `X-Cache: HIT` (with Upstash configured)
- [ ] >60 search/min same IP → 429
- [ ] Concurrent import → 409
- [ ] No Redis env → app boots, search works
- [ ] `GET /api/health` includes `redis: "up"|"skipped"|"down"`
- [ ] `GET /api/warmup` sets `corpusCount` visible on health
