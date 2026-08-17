/**
 * Centralized matcher configuration.
 *
 * Every threshold and tunable in the matching engine lives here. Do not hardcode
 * magic numbers in route handlers or utility functions — reference these constants.
 */
export const SEARCH_CONFIG = {
  // Server-side matcher (src/app/api/search/route.ts)
  /** Reject weak STT guesses — wrong Gurbani worse than hold. */
  MIN_CONFIDENCE: 0.68,
  FALLBACK_THRESHOLD: 0.75,
  PHASE_SWITCH_DELTA: 0.25,
  SWITCH_SHABAD_MIN_CONFIDENCE: 0.85,
  EXACT_MATCH_SCORE: 1.0,
  /**
   * Only stay on Redis/locked shabad when match is this strong (scrolling).
   * Below this → always run global Mongo discovery so a NEW shabad can appear.
   */
  LOCKED_STICKY_THRESHOLD: 0.9,
  /** Mongo $text candidate pool for Fuse re-rank (broad recall). */
  MONGO_CANDIDATE_LIMIT: 500,

  // Alignment settings
  DTW_INSERTION_COST: 0.8,
  DTW_DELETION_COST: 0.6,
  WORD_SIMILARITY_THRESHOLD: 0.7,

  // Local-cache matcher — high accuracy threshold for loaded shabad line tracking
  LOCAL_CACHE_THRESHOLD: 0.82,
  LOCAL_THRESHOLD_WITH_CONTEXT: 0.75,
  LOCAL_THRESHOLD_NO_CONTEXT: 0.82,
  PROXIMITY_BONUS_MAX: 0.18,
  PROXIMITY_DECAY_PER_LINE: 0.022,
  GURMUKHI_SUBSTRING_BONUS: 0.95,
  TRANSLIT_SUBSTRING_BONUS: 0.92,
  HEADING_PENALTY: 0.38,
  BACKWARD_PENALTY: 0.14,

  // Cache (L1 in-process + L2 Redis)
  MAX_CACHE_SIZE: 500,
  /** L1 in-process burst cache size (in front of Redis). */
  L1_CACHE_SIZE: 50,
  CACHE_TTL_MS: 60_000,
  /** Short TTL for null matches so sticky misses don't block recovery. */
  REDIS_NULL_CACHE_TTL_SECONDS: 5,
  /** Full shabad payload after first match — avoid re-fetching same shabad. */
  REDIS_SHABAD_TTL_SECONDS: 3600,
  REDIS_CORPUS_META_TTL_SECONDS: 3600,
  REDIS_WARMUP_META_TTL_SECONDS: 86_400,
  REDIS_IMPORT_LOCK_TTL_SECONDS: 7200,

  // Rate limits (Upstash)
  RATE_LIMIT_SEARCH_PER_MINUTE: 60,
  RATE_LIMIT_IMPORT_PER_MINUTE: 5,

  // STT debouncing (src/hooks/useGurbaniProjector.ts)
  MIN_QUERY_WORDS_DISCOVERY: 5,
  MIN_QUERY_WORDS_JUMP_SHABAD: 6,
  MAX_CONSECUTIVE_MISSES_BEFORE_DISCOVERY: 3,
  DEBOUNCE_FAST_MS: 600,
  DEBOUNCE_SLOW_MS: 1500,
  MAX_WAIT_SEARCH_MS: 450,
  PATIENCE_AFTER_MATCH_MS: 200,
  ALAAP_PROTECTION_TIMEOUT_MS: 12_000,
  ROLLING_WINDOW_WORDS: 8,

  // Input validation (src/app/api/search/route.ts)
  MAX_QUERY_LENGTH: 500,
  MIN_QUERY_LENGTH: 5,

  // Fuse.js fuzzy scorer (0 = exact in Fuse; we use confidence = 1 - fuseScore)
  FUSE_THRESHOLD: 0.45,
  FUSE_MIN_CONFIDENCE: 0.68,
  FUSE_DISTANCE_LINE: 100,
  FUSE_DISTANCE_WINDOW: 200,
  FUSE_MIN_MATCH_CHAR_LENGTH: 2,
  /** Primary match mode: first letter of each word (acronym / larivaar). */
  FUSE_WEIGHT_FIRST_LETTERS: 0.7,
  FUSE_WEIGHT_GURMUKHI: 0.15,
  FUSE_WEIGHT_TRANSLIT: 0.15,
  /** Minimum first-letters in query to use acronym search. */
  ACRONYM_MIN_LENGTH: 2,

  // Multi-line context for duplicate-line shabad disambiguation
  CONTEXT_WINDOW_SIZE: 3,
  CONTEXT_WINDOW_MIN: 2,
  /** Cold-start single phrase — aligned with MIN so new shabads can surface. */
  DISCOVERY_SINGLE_LINE_MIN_CONFIDENCE: 0.68,
  /** Gate when discovery uses 2–3 line windows. */
  DISCOVERY_WINDOW_MIN_CONFIDENCE: 0.68,
  /** Boost when locked-shabad context window aligns. */
  CONTEXT_ALIGN_BONUS: 0.05,
  /** Extra boost when spoken line ≈ window end line. */
  CONTEXT_END_LINE_BONUS: 0.06,
  /** Matching Engine v2 constants */
  SEQUENTIAL_NEXT_LINE_BONUS: 0.15,
  SEQUENTIAL_SKIP_LINE_BONUS: 0.08,
  PHONETIC_MATCH_BONUS: 0.08,
} as const;
