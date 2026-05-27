/**
 * Score a model's grammar correction response based on structural validity
 * and per-error quality checks. Produces a 0-100 score and a tier label.
 */

const LEVEL_PENALTIES = { 1: 0, 2: 15, 3: 30 };

export async function scoreResponse(parsed, originalText, level = 1) {
  const checks = [];
  let score = 100;

  function penalize(amount, name, detail) {
    score -= amount;
    checks.push({ pass: false, name, detail, penalty: amount });
  }
  function pass(name, detail) {
    checks.push({ pass: true, name, detail, penalty: 0 });
  }

  const levelPenalty = LEVEL_PENALTIES[level] ?? 0;

  // --- Structural guards ---
  if (!parsed || typeof parsed !== "object") {
    return {
      score: 0,
      tier: "reject",
      checks: [{ pass: false, name: "structure", detail: "not an object", penalty: 100 }],
      usable: [],
      suppressed: [],
    };
  }
  if (!Array.isArray(parsed.changes)) {
    return {
      score: 0,
      tier: "reject",
      checks: [{ pass: false, name: "changes field", detail: "missing or non-array", penalty: 100 }],
      usable: [],
      suppressed: [],
    };
  }
  pass("structure", "valid object with changes array");

  // --- Error density ---
  const wordCount = originalText.trim().split(/\s+/).filter(Boolean).length;
  const errorCount = parsed.changes.length;
  if (errorCount > wordCount / 2) {
    penalize(25, "error density", `${errorCount} changes for ${wordCount} word(s)`);
  } else {
    pass("error density", `${errorCount}/${wordCount} word(s) flagged`);
  }

  const origLower = originalText.toLowerCase();
  const usable = [];
  const suppressed = [];

  // --- Per-change scoring ---
  parsed.changes.forEach((ch, i) => {
    let entryScore = 100;
    const issues = [];
    let suppress = false;

    if (typeof ch.original !== "string" || !ch.original.trim()) {
      issues.push("missing original");
      entryScore -= 40;
      suppress = true;
    }
    if (typeof ch.replacement !== "string" || !ch.replacement.trim()) {
      issues.push("missing replacement");
      entryScore -= 40;
      suppress = true;
    }

    if (!suppress) {
      const origPhrase = ch.original.toLowerCase().trim();
      const replPhrase = ch.replacement.toLowerCase().trim();

      if (!origLower.includes(origPhrase)) {
        issues.push("hallucinated \u2014 phrase not in source");
        entryScore -= 35;
        suppress = true;
      }

      if (origPhrase === replPhrase) {
        issues.push("original equals replacement");
        entryScore -= 30;
        suppress = true;
      }

      if (ch.original.trim().split(/\s+/).length > 8) {
        issues.push("original phrase too long");
        entryScore -= 15;
      }

      const ratio = ch.replacement.length / Math.max(ch.original.length, 1);
      if (ratio > 4) {
        issues.push(`replacement is ${ratio.toFixed(1)}x longer`);
        entryScore -= 15;
      }

      if (typeof ch.explanation !== "string" || ch.explanation.trim().length < 3) {
        issues.push("no explanation given");
        entryScore -= 5;
      }
    }

    const entry = { ...ch, _index: i + 1, _entryScore: Math.max(0, entryScore), _issues: issues };

    if (suppress || entryScore < 50) {
      suppressed.push(entry);
      penalize(Math.max(5, Math.round((100 - entryScore) * 0.15)), `change #${i + 1}`, issues.join("; "));
    } else {
      usable.push(entry);
      pass(`change #${i + 1}`, `"${ch.original}" \u2192 "${ch.replacement}"`);
    }
  });

  if (levelPenalty > 0) penalize(levelPenalty, "cascade level", `level ${level}`);

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  const tier =
    finalScore >= 75 ? "high"
    : finalScore >= 50 ? "medium"
    : finalScore >= 25 ? "low"
    : "reject";

  return { score: finalScore, tier, checks, usable, suppressed };
}

export async function mergeConfidence(modelScore, ourScore) {
  const modelNormalized = modelScore / 10;
  const ourNormalized = ourScore / 100;
  const modelWeight = ourNormalized * 0.3;
  const ourWeight = 1 - modelWeight;
  const merged = (modelNormalized * modelWeight) + (ourNormalized * ourWeight);
  return Math.round(merged * 100);
}
