import { filterKirtanFillers, isAcronymQuery } from "../src/shared/utils/gurbani-text-normalizer";
import { collapseLatinPhonetics, collapseGurmukhiPhonetics, isPhoneticMatch } from "../src/shared/utils/phonetic";

console.log("=== Running Matching Engine v2 Unit Tests ===\n");

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

// 1. Test Kirtan Filler Filtering
console.log("--- 1. Testing Kirtan Filler Filtering ---");
assert(
  filterKirtanFillers("satnam waheguru mere sahiba har ji") === "mere sahiba",
  "Should filter out satnam, waheguru, and har ji"
);
assert(
  filterKirtanFillers("waheguru") === "waheguru",
  "Should fall back to original if query consists entirely of fillers"
);
assert(
  filterKirtanFillers("ji") === "ji",
  "Should fall back to original if query consists entirely of a single filler"
);
assert(
  filterKirtanFillers("satgur prasad ji") === "satgur prasad",
  "Should strip trailing 'ji'"
);

// 2. Test Auto-Mode Acronym Detection
console.log("\n--- 2. Testing Acronym Detection ---");
assert(isAcronymQuery("m s h h") === true, "Spaced single letters should be acronym");
assert(isAcronymQuery("mshh") === true, "Vowelless 4-letter string should be acronym");
assert(isAcronymQuery("hbd") === true, "Vowelless 3-letter string should be acronym");
assert(isAcronymQuery("satgur prasad") === false, "Full Gurmukhi/translit words should not be acronym");
assert(isAcronymQuery("guru") === false, "Standard word with vowels should not be acronym");
assert(isAcronymQuery("ਵਾਹਿਗੁਰੂ") === false, "Full Gurmukhi word with matras should not be acronym");
assert(isAcronymQuery("ਮਸਹਹ") === true, "Consonant-only Gurmukhi letters should be acronym");

// 3. Test Latin & Gurmukhi Phonetic Collapsing
console.log("\n--- 3. Testing Phonetic Collapsing ---");
assert(collapseLatinPhonetics("b") === "p", "b -> p");
assert(collapseLatinPhonetics("v") === "p", "v -> p");
assert(collapseLatinPhonetics("w") === "p", "w -> p");
assert(collapseLatinPhonetics("kh") === "kh", "kh -> kh");
assert(collapseLatinPhonetics("k") === "k", "k -> k");
assert(collapseLatinPhonetics("dh") === "th", "dh -> th");
assert(collapseLatinPhonetics("d") === "t", "d -> t");
assert(collapseLatinPhonetics("ee") === "aa", "ee -> aa");
assert(collapseLatinPhonetics("i") === "a", "i -> a");
assert(collapseGurmukhiPhonetics("ਗ") === "ਕ", "ਗ -> ਕ");
assert(collapseGurmukhiPhonetics("ਬ") === "ਪ", "ਬ -> ਪ");
assert(collapseGurmukhiPhonetics("ਮਸਹਹ") === "ਨਸਹਹ", "ਮਸਹਹ -> ਨਸਹਹ");

// 4. Test Phonetic Match Check
console.log("\n--- 4. Testing Phonetic Matching ---");
assert(isPhoneticMatch("hvd", "hbd", false) === true, "hvd vs hbd (har vin duji vs har bin duji) should match");
assert(isPhoneticMatch("wgr", "vgr", false) === true, "wgr vs vgr should match");
assert(isPhoneticMatch("vgr", "sgr", false) === false, "vgr vs sgr should NOT match");
assert(isPhoneticMatch("satgur", "satigur", false) === false, "Should not treat full words as acronym phonetic matches");

console.log("\n🎉 ALL TESTS PASSED SUCCESSFULLY!");
