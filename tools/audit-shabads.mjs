/**
 * audit-shabads.mjs
 *
 * Connects directly to MongoDB Atlas and audits every Shabad document for
 * corruption that would cause silent search failures during live Kirtan.
 *
 * Run from project root:  node tools/audit-shabads.mjs
 * (No ts-node needed — plain ESM, reads .env automatically)
 *
 * Checks performed per Shabad:
 *  1.  lines array is missing or empty
 *  2.  Any line has empty / missing gurmukhi
 *  3.  Any line has empty / missing transliteration
 *  4.  Any line has empty / missing larivaar  (breaks first-letter search)
 *  5.  larivaar word-count doesn't match gurmukhi word-count (mis-tokenised)
 *  6.  transliteration is an object instead of a string (schema mismatch)
 *  7.  gurmukhi contains non-Gurmukhi Unicode block chars (garbled encoding)
 *  8.  Duplicate shabadId values in the collection
 *  9.  shabadId missing or not a number
 * 10.  Lines without an `id` field (breaks line-tracking)
 */

import { MongoClient } from "mongodb";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env manually (no dotenv dependency needed) ──────────────────────────
const envPath = resolve(process.cwd(), ".env");
try {
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  console.warn("⚠️  Could not read .env — using environment variables only.");
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is not set. Aborting.");
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const GURMUKHI_RANGE = /^[\u0A00-\u0A7F\s|॥।\u200D\u200C\u0964\u0965]+$/;
const ACRONYM_STRIP_REGEX = /[॥।|.,:;!?[\](){}]/g;

function isGurmukhiClean(str) {
  return GURMUKHI_RANGE.test(str.trim());
}

/**
 * Replicates getAcronym() from gurbani-text-normalizer.ts exactly.
 * Returns the first Gurmukhi char of each word after stripping dandas/pipes.
 */
function computeAcronym(text) {
  if (!text) return "";
  const cleaned = text.replace(ACRONYM_STRIP_REGEX, "");
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .filter((c) => /[\u0A00-\u0A7F]/.test(c))
    .join("");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🔌 Connecting to MongoDB Atlas…");
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
  await client.connect();
  console.log("✅ Connected.\n");

  const db = client.db(); // uses DB from URI
  const col = db.collection("shabads");

  const totalDocs = await col.countDocuments();
  console.log(`📦 Total shabads in collection: ${totalDocs}\n`);

  // ── Corruption counters ───────────────────────────────────────────────────
  const issues = {
    missingOrEmptyLines: [],
    missingGurmukhi: [],
    missingTransliteration: [],
    missingLarivaar: [],
    larivaarWordMismatch: [],
    transliterationWrongType: [],
    garbledGurmukhi: [],
    missingShabadId: [],
    missingLineId: [],
  };

  const seenShabadIds = new Map(); // shabadId -> _id, for duplicate detection
  const duplicateShabadIds = [];

  let processed = 0;
  const cursor = col.find({}, { projection: { shabadId: 1, bani: 1, page: 1, lines: 1 } });

  for await (const doc of cursor) {
    processed++;
    if (processed % 1000 === 0) {
      process.stdout.write(`\r  … scanning ${processed}/${totalDocs}`);
    }

    const sid = doc.shabadId;
    const docRef = `shabadId=${sid ?? "MISSING"} (_id=${doc._id})`;

    // Check 9: shabadId
    if (sid === undefined || sid === null || typeof sid !== "number") {
      issues.missingShabadId.push(docRef);
    }

    // Check 8: duplicates
    if (sid !== undefined && sid !== null) {
      if (seenShabadIds.has(sid)) {
        duplicateShabadIds.push({ shabadId: sid, ids: [seenShabadIds.get(sid), doc._id] });
      } else {
        seenShabadIds.set(sid, doc._id);
      }
    }

    // Check 1: lines
    if (!Array.isArray(doc.lines) || doc.lines.length === 0) {
      issues.missingOrEmptyLines.push(docRef);
      continue; // can't check lines further
    }

    for (let i = 0; i < doc.lines.length; i++) {
      const line = doc.lines[i];
      const lineRef = `${docRef} line[${i}]`;

      // Check 10: line id
      if (!line.id && line.id !== 0) {
        issues.missingLineId.push(lineRef);
      }

      // Check 2: gurmukhi
      const gurmukhi = (line.gurmukhi || "").trim();
      if (!gurmukhi) {
        issues.missingGurmukhi.push(lineRef);
      } else if (!isGurmukhiClean(gurmukhi)) {
        // Check 7: garbled encoding
        issues.garbledGurmukhi.push(`${lineRef} → "${gurmukhi.slice(0, 40)}"`);
      }

      // Check 6: transliteration type
      if (line.transliteration !== undefined && typeof line.transliteration === "object" && line.transliteration !== null) {
        issues.transliterationWrongType.push(`${lineRef} → type=object keys=${Object.keys(line.transliteration).join(",")}`);
      }

      // Check 3: transliteration empty
      const translit =
        typeof line.transliteration === "string"
          ? line.transliteration.trim()
          : typeof line.transliteration === "object" && line.transliteration
          ? (line.transliteration.english || "").trim()
          : "";
      if (!translit) {
        issues.missingTransliteration.push(lineRef);
      }

      // Check 4 & 5: larivaar
      const larivaar = (line.larivaar || "").trim();
      if (!larivaar) {
        issues.missingLarivaar.push(lineRef);
      } else if (gurmukhi) {
        // Check 5: recompute acronym and compare to stored larivaar
        const expected = computeAcronym(gurmukhi);
        if (expected !== larivaar) {
          issues.larivaarWordMismatch.push(
            `${lineRef} expected="${expected.slice(0, 30)}" stored="${larivaar.slice(0, 30)}" gur="${gurmukhi.slice(0, 30)}"`
          );
        }
      }
    }
  }

  process.stdout.write("\n");
  await client.close();

  // ── Report ────────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("                   SHABAD AUDIT REPORT");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const totalIssues =
    issues.missingOrEmptyLines.length +
    issues.missingGurmukhi.length +
    issues.missingTransliteration.length +
    issues.missingLarivaar.length +
    issues.larivaarWordMismatch.length +
    issues.transliterationWrongType.length +
    issues.garbledGurmukhi.length +
    issues.missingShabadId.length +
    issues.missingLineId.length +
    duplicateShabadIds.length;

  if (totalIssues === 0) {
    console.log("🎉 No corruption found! All shabads look healthy.\n");
  } else {
    console.log(`⚠️  Found ${totalIssues} issue(s) across ${processed} shabads.\n`);

    printSection("1. Shabads with missing/empty lines array", issues.missingOrEmptyLines);
    printSection("2. Lines with missing gurmukhi text", issues.missingGurmukhi);
    printSection("3. Lines with missing transliteration", issues.missingTransliteration);
    printSection("4. Lines with missing larivaar (breaks first-letter search)", issues.missingLarivaar);
    printSection("5. Lines where larivaar char count ≠ gurmukhi word count", issues.larivaarWordMismatch);
    printSection("6. Lines where transliteration is an object (schema mismatch)", issues.transliterationWrongType);
    printSection("7. Lines with garbled / non-Gurmukhi gurmukhi text", issues.garbledGurmukhi);
    printSection("8. Duplicate shabadId values", duplicateShabadIds.map(d => `shabadId=${d.shabadId}`));
    printSection("9. Shabads with missing/invalid shabadId", issues.missingShabadId);
    printSection("10. Lines with missing id field", issues.missingLineId);
  }

  console.log(`\nScanned ${processed} documents. Done.\n`);

  // Return non-zero exit code if issues found (useful for CI)
  if (totalIssues > 0) process.exit(2);
}

function printSection(title, items) {
  const icon = items.length === 0 ? "✅" : "❌";
  console.log(`${icon} ${title}: ${items.length}`);
  const preview = items.slice(0, 20);
  for (const item of preview) {
    console.log(`     • ${item}`);
  }
  if (items.length > 20) {
    console.log(`     … and ${items.length - 20} more`);
  }
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
