/**
 * Constants, Character Maps, and Precompiled Regexes for Gurbani Text Normalization.
 * Static module-level declarations for zero runtime allocation.
 */

export const matras = ["ਾ", "ਿ", "ੀ", "ੁ", "ੂ", "ੇ", "ੈ", "ੋ", "ੌ", "ਂ", "ੰ", "ੱ", "਼", "੍ਰ", "੍ਹ", "੍ਵ", "੍ਯ"];

// Precompiled Regexes for single-pass processing
export const MATRAS_REGEX = /[ਾਿੀੁੂੇੈੋੌਂੰੱ਼੍ਰ੍ਹ੍ਵ੍ਯ]/g;
export const DIACRITICS_ACCENTS_REGEX = /[\u0300-\u036f]/g;
export const SPECIAL_GURMUKHI_CHARS_REGEX = /[\u0A71\u0A70\u0A02]/g;
export const MULTI_SPACE_REGEX = /\s+/g;
export const CLEAN_TRANSCRIPT_PUNCTUATION_REGEX = /[-'".,:;!?[\]{}]/g;
export const CLEAN_ACRONYM_PUNCTUATION_REGEX = /[॥।|.,:;!?[\](){}]/g;
export const HEADING_GURMUKHI_REGEX = /ਮਹਲਾ|ਘਰੁ|ਤਿਤੁਕੀ|ਰਾਗੁ|ਛੰਦ|ਅਸਟਪਦੀ/;
export const HEADING_TRANSLIT_REGEX = /\bmehlaa\b|\bmahalaa\b|\bghar\b|\btithuk\b|\bsoratt?h\b|\braag\b|\bhouse\b/i;
export const DANDA_REGEX = /[॥।|]/g;

// Static Lookup Maps
export const DIACRITICS_MAP: Record<string, string> = {
    'ẖ': 'h', 'ṯ': 't', 'ṣ': 's', 'ṛ': 'r', 'ṇ': 'n', 'ḍ': 'd'
};

export const HINDI_TO_GURMUKHI_MAP: Record<string, string> = {
    'अ': 'ਅ', 'आ': 'ਆ', 'इ': 'ਇ', 'ई': 'ਈ', 'उ': 'ਉ', 'ऊ': 'ਊ', 'ए': 'ਏ', 'ऐ': 'ਐ', 'ओ': 'ਓ', 'औ': 'ਔ',
    'क': 'ਕ', 'ख': 'ਖ', 'ग': 'ਗ', 'घ': 'ਘ', 'ङ': 'ਙ', 'च': 'ਚ', 'छ': 'ਛ', 'ज': 'ਜ', 'झ': 'ਝ', 'ञ': 'ਞ',
    'ट': 'ਟ', 'ठ': 'ਠ', 'ड': 'ਡ', 'ढ': 'ਢ', 'ण': 'ਣ', 'त': 'ਤ', 'थ': 'ਥ', 'ਦ': 'ਦ', 'ध': 'ਧ', 'न': 'ਨ',
    'प': 'ਪ', 'फ': 'ਫ', 'ब': 'ਬ', 'भ': 'ਭ', 'म': 'ਮ', 'य': 'ਯ', 'र': 'ਰ', 'ल': 'ਲ', 'व': 'ਵ', 'श': 'ਸ਼', 'ष': 'ਸ਼', 'स': 'ਸ', 'ह': 'ਹ',
    'ा': 'ਾ', 'ਿ': 'ਿ', 'ੀ': 'ੀ', 'ੁ': 'ੁ', 'ੂ': 'ੂ', 'ੇ': 'ੇ', 'ੈ': 'ੈ', 'ੋ': 'ੋ', 'ौ': 'ੌ', '्': '੍', 'ं': 'ਂ', 'ः': 'ਃ', '़': '਼', 'ँ': 'ਂ'
};

export const CONSONANTS: Record<string, string> = {
    'ੳ': 'o', 'ਅ': 'a', 'ੲ': 'e', 'ਸ': 's', 'ਹ': 'h', 'ਕ': 'k', 'ਖ': 'kh', 'ਗ': 'g', 'ਘ': 'gh', 'ਙ': 'ng',
    'ਚ': 'ch', 'ਛ': 'chh', 'ਜ': 'j', 'ਝ': 'jh', 'ਞ': 'nj', 'ਟ': 't', 'ਠ': 'th', 'ਡ': 'd', 'ਢ': 'dh', 'ਣ': 'n',
    'त': 't', 'ਤ': 't', 'ਥ': 'th', 'ਦ': 'd', 'ਧ': 'dh', 'ਨ': 'n', 'ਪ': 'p', 'ਫ': 'ph', 'ਬ': 'b', 'ਭ': 'bh', 'ਮ': 'm',
    'ਯ': 'y', 'ਰ': 'r', 'ਲ': 'l', 'ਵ': 'v', 'ੜ': 'r', 'ਖ਼': 'kh', 'ਗ਼': 'g', 'ਜ਼': 'z', 'ਫ਼': 'f', 'ਲ਼': 'l',
};

export const VOWEL_SIGNS: Record<string, string> = {
    'ਾ': 'aa', 'ਿ': 'i', 'ੀ': 'ee', 'ੁ': 'u', 'ੂ': 'oo', 'ੇ': 'e', 'ੈ': 'ai', 'ੋ': 'o', 'ੌ': 'au',
};

export const INDEPENDENT_VOWELS: Record<string, string> = {
    'ਆ': 'aa', 'ਇ': 'i', 'ਈ': 'ee', 'ਉ': 'u', 'ਊ': 'oo', 'ਏ': 'e', 'ਐ': 'ai', 'ਓ': 'o', 'ਔ': 'au',
};

export const MODIFIERS: Record<string, string> = {
    'ਂ': 'n', 'ੰ': 'n', 'ੱ': '', '਼': '', 'ੴ': 'ik onkar', '॥': '', '।': '', 'ਃ': 'h'
};

export const PHONETIC_MAPS: Array<[string, string]> = [
    ["sh", "ਸ਼"], ["kh", "ਖ"], ["gh", "ਘ"], ["chh", "ਛ"], ["jh", "ਝ"], ["th", "ਥ"], ["dh", "ਧ"], ["ph", "ਫ"], ["bh", "ਭ"],
    ["aa", "ਾ"], ["ee", "ੀ"], ["oo", "ੂ"], ["ai", "ੈ"], ["au", "ੌ"], 
    ["k", "ਕ"], ["g", "ਗ"], ["ch", "ਚ"], ["j", "ਜ"], ["t", "ਤ"], ["d", "ਦ"], ["n", "ਨ"], ["p", "ਪ"], ["b", "ਬ"], ["m", "ਮ"],
    ["y", "ਯ"], ["r", "ਰ"], ["l", "ਲ"], ["v", "ਵ"], ["w", "ਵ"], ["s", "ਸ"], ["h", "ਹ"], ["a", "ਅ"], ["i", "ਇ"], ["u", "ਉ"],
    ["o", "ਓ"]
];

export const ENGLISH_ACRONYM_MAP: Record<string, string> = {
    'a': '[ਅਆਇਈਉਊਏਐਓਔ]',
    'b': '[ਬਭ]',
    'c': '[ਚਛਕਖ]',
    'd': '[ਦਧਡਢ]',
    'e': '[ੲਏਐਇਈ]',
    'f': '[ਫਫ਼]',
    'g': '[ਗਘ]',
    'h': 'ਹ',
    'i': '[ਇਈ]',
    'j': '[ਜਝਜ਼]',
    'k': '[ਕਖ]',
    'l': 'ਲ',
    'm': 'ਮ',
    'n': '[ਨਣਞਙ]',
    'o': '[ੳਓਔਉਊ]',
    'p': '[ਪਫਭ]',
    'q': '[ਕਖ]',
    'r': '[ਰੜ]',
    's': '[ਸਸ਼]',
    't': '[ਤਥਟਠ]',
    'u': '[ਉਊ]',
    'v': 'ਵ',
    'w': 'ਵ',
    'x': 'ਖ',
    'y': 'ਯ',
    'z': '[ਜ਼ਜ]'
};
