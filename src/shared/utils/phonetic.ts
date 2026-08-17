/**
 * Phonetic collapse mappings and distance functions for Gurbani search.
 * Groups sound-alike consonants and vowels for error-tolerant matching.
 */

/**
 * Collapses Gurmukhi acronym characters into their base phonetic classes.
 */
export const collapseGurmukhiPhonetics = (text: string): string => {
  if (!text) return "";
  const res = text.trim();
  
  const map: Record<string, string> = {
    // Velars (k, kh, g, gh)
    'ਕ': 'ਕ', 'ਖ': 'ਕ', 'ਗ': 'ਕ', 'ਘ': 'ਕ', 'ਖ਼': 'ਕ', 'ਗ਼': 'ਕ', 'ਖ਼': 'ਕ', 'ਗ਼': 'ਕ',
    // Palatals (ch, chh, j, jh, z)
    'ਚ': 'ਚ', 'ਛ': 'ਚ', 'ਜ': 'ਚ', 'ਝ': 'ਚ', 'ਜ਼': 'ਚ',
    // Retroflex (t, th, d, dh, r)
    'ਟ': 'ਟ', 'ਠ': 'ਟ', 'ਡ': 'ਟ', 'ਢ': 'ਟ', 'ੜ': 'ਟ',
    // Dentals (t, th, d, dh)
    'ਤ': 'ਤ', 'ਥ': 'ਤ', 'ਦ': 'ਤ', 'ਧ': 'ਤ',
    // Labials / Semivowels (p, ph, b, bh, f, v)
    'ਪ': 'ਪ', 'ਫ': 'ਪ', 'ਬ': 'ਪ', 'ਭ': 'ਪ', 'ਫ਼': 'ਪ', 'ਵ': 'ਪ',
    // Sibilants (s, sh)
    'ਸ': 'ਸ', 'ਸ਼': 'ਸ',
    // Nasals (n, m, ng, nj)
    'ਨ': 'ਨ', 'ਣ': 'ਨ', 'ਙ': 'ਨ', 'ਞ': 'ਨ', 'ਮ': 'ਨ',
    // Liquids (r, l)
    'ਰ': 'ਰ', 'ਲ': 'ਰ', 'ਲ਼': 'ਰ',
    // Vowels / Carriers
    'ਅ': 'ਅ', 'ਆ': 'ਅ', 'ਇ': 'ਅ', 'ਈ': 'ਅ', 'ਉ': 'ਅ', 'ਊ': 'ਅ', 'ਏ': 'ਅ', 'ਐ': 'ਅ', 'ਓ': 'ਅ', 'ਔ': 'ਅ', 'ੲ': 'ਅ', 'ੳ': 'ਅ', 'ੴ': 'ਅ'
  };

  return [...res].map(char => map[char] || char).join("");
};

export const collapseLatinPhonetics = (text: string): string => {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    // Collapse sound-alike groups
    .replace(/[bfpvw]/g, "p")  // bilabial/labiodental: b, f, p, v, w
    .replace(/[cgkxq]/g, "k")  // velar/palatal: c, g, k, x, q
    .replace(/[jz]/g, "j")     // affricates/sibilants: j, z
    .replace(/[dt]/g, "t")     // dentals: d, t
    .replace(/[lr]/g, "r")     // liquids: l, r
    .replace(/[nm]/g, "n")     // nasals: n, m
    .replace(/[aeiouwy]/g, "a"); // vowels: collapse all vowels/semivowels
};

/**
 * Computes standard Levenshtein distance between two strings.
 */
export const getLevenshteinDistance = (a: string, b: string): number => {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1,   // insertion
            matrix[i - 1][j] + 1    // deletion
          )
        );
      }
    }
  }

  return matrix[b.length][a.length];
};

/**
 * Checks if query acronym matches line acronym phonetically under distance threshold.
 */
export const isPhoneticMatch = (query: string, lineAcronym: string, isGurmukhi: boolean): boolean => {
  if (!query || !lineAcronym) return false;
  
  if (isGurmukhi) {
    const collapsedQ = collapseGurmukhiPhonetics(query);
    const collapsedL = collapseGurmukhiPhonetics(lineAcronym);
    if (collapsedL === collapsedQ) return true;
    if (collapsedL.startsWith(collapsedQ)) return true;
    return false;
  } else {
    const collapsedQ = collapseLatinPhonetics(query);
    const collapsedL = collapseLatinPhonetics(lineAcronym);
    if (collapsedL === collapsedQ) return true;
    if (collapsedL.startsWith(collapsedQ)) return true;
    
    // Check close Levenshtein distance for longer queries
    if (collapsedQ.length >= 4) {
      const dist = getLevenshteinDistance(collapsedQ, collapsedL.slice(0, collapsedQ.length));
      return dist <= 1; // Allow max 1 edit distance in collapsed space
    }
    return false;
  }
};
