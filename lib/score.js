/**
 * Score a model's grammar correction response.
 *
 * Goal: accept small, source-grounded grammar fixes; cascade on hallucinated,
 * ambiguous, structurally inconsistent, or broad rewrite responses.
 */

const LEVEL_PENALTIES = { 1: 0, 2: 12, 3: 20 };
const MAX_CHANGE_DENSITY = 0.45;
const MIN_ENTRY_SCORE = 55;

export async function scoreResponse(parsed, originalText, level = 1) {
  const checks = [];
  const original = typeof originalText === "string" ? originalText : "";
  let score = 100;

  function penalize(amount, name, detail) {
    const penalty = Math.max(0, Math.min(100, amount));
    score -= penalty;
    checks.push({ pass: false, name, detail, penalty });
  }

  function pass(name, detail) {
    checks.push({ pass: true, name, detail, penalty: 0 });
  }

  if (!parsed || typeof parsed !== "object") {
    return reject("structure", "not an object");
  }

  if (typeof parsed.corrected !== "string") {
    return reject("corrected field", "missing or non-string");
  }

  if (!Array.isArray(parsed.changes)) {
    return reject("changes field", "missing or non-array");
  }

  pass("structure", "valid object with corrected string and changes array");

  const wordCount = countWords(original);
  const changeCount = parsed.changes.length;
  const densityLimit = Math.max(3, Math.ceil(wordCount * MAX_CHANGE_DENSITY));

  if (changeCount > densityLimit) {
    penalize(18, "change density", `${changeCount} changes exceeds ${densityLimit} expected for ${wordCount} word(s)`);
  } else {
    pass("change density", `${changeCount}/${wordCount} word(s) flagged`);
  }

  if (changeCount === 0) {
    scoreEmptyResponse(parsed.corrected, original, level, checks, pass, penalize);
    return finalize(score, checks, [], []);
  }

  const usable = [];
  const suppressed = [];
  const spans = [];

  parsed.changes.forEach((change, index) => {
    const entry = scoreChange(change, index, original, spans);
    spans.push(...entry.spans);

    if (entry.suppress || entry.entryScore < MIN_ENTRY_SCORE) {
      suppressed.push(entry.value);
      penalize(Math.max(25, entryPenalty(entry.entryScore)), `change #${index + 1}`, entry.issues.join("; "));
    } else {
      usable.push(entry.value);
      if (entry.issues.length > 0) {
        penalize(entryPenalty(entry.entryScore) / 2, `change #${index + 1}`, entry.issues.join("; "));
      } else {
        pass(`change #${index + 1}`, `"${change.original}" -> "${change.replacement}"`);
      }
    }
  });

  const duplicateCount = countDuplicateChanges(parsed.changes);
  if (duplicateCount > 0) {
    penalize(Math.min(16, duplicateCount * 8), "duplicate changes", `${duplicateCount} duplicate edit(s)`);
  } else {
    pass("duplicate changes", "none");
  }

  if (hasOverlappingSpans(spans)) {
    penalize(22, "overlapping changes", "two or more changes target overlapping source text");
  } else {
    pass("overlapping changes", "none");
  }

  if (changeCount > 0 && usable.length === 0) {
    penalize(25, "usable changes", "all listed changes were suppressed");
  } else {
    pass("usable changes", `${usable.length}/${changeCount} usable`);
  }

  if (usable.some((change) => change._issues.includes("whole-text change"))) {
    penalize(18, "granularity", "model returned a whole-text edit instead of targeted changes");
  } else {
    pass("granularity", "targeted changes");
  }

  scoreCorrectedText(parsed.corrected, original, usable, pass, penalize);

  const levelPenalty = LEVEL_PENALTIES[level] ?? 0;
  if (levelPenalty > 0) penalize(levelPenalty, "cascade level", `level ${level}`);

  return finalize(score, checks, usable, suppressed);
}

export async function mergeConfidence(modelScore, ourScore) {
  const modelNormalized = clampNumber(modelScore, 1, 10, 5) / 10;
  const ourNormalized = clampNumber(ourScore, 0, 100, 0) / 100;

  // Trust model self-confidence only when our structural/evidence score is strong.
  const modelWeight = ourNormalized >= 0.75 ? 0.25 : ourNormalized >= 0.6 ? 0.15 : 0.05;
  const merged = modelNormalized * modelWeight + ourNormalized * (1 - modelWeight);
  return Math.round(merged * 100);
}

function reject(name, detail) {
  return {
    score: 0,
    tier: "reject",
    checks: [{ pass: false, name, detail, penalty: 100 }],
    usable: [],
    suppressed: [],
  };
}

function finalize(rawScore, checks, usable, suppressed) {
  const finalScore = Math.max(0, Math.min(100, Math.round(rawScore)));
  const tier = finalScore >= 80 ? "high" : finalScore >= 60 ? "medium" : finalScore >= 25 ? "low" : "reject";
  return { score: finalScore, tier, checks, usable, suppressed };
}

function scoreEmptyResponse(corrected, original, level, checks, pass, penalize) {
  if (normalizeText(corrected) === normalizeText(original)) {
    pass("empty response", "no changes and corrected text matches source");
  } else if (level >= 3) {
    penalize(25, "empty response", "full-text correction without structured changes");
  } else {
    penalize(70, "empty response", "corrected text changed but changes array is empty");
  }

  const levelPenalty = LEVEL_PENALTIES[level] ?? 0;
  if (levelPenalty > 0) penalize(levelPenalty, "cascade level", `level ${level}`);
  checks.push({ pass: true, name: "corrected consistency", detail: "not applicable for empty changes", penalty: 0 });
}

function scoreChange(change, index, original, previousSpans) {
  let entryScore = 100;
  const issues = [];
  const spans = [];
  let suppress = false;

  if (!change || typeof change !== "object") {
    return {
      entryScore: 0,
      issues: ["change is not an object"],
      suppress: true,
      spans,
      value: { _index: index + 1, _entryScore: 0, _issues: ["change is not an object"] },
    };
  }

  const originalValid = typeof change.original === "string" && change.original.trim().length > 0;
  const replacementValid = typeof change.replacement === "string";

  if (!originalValid) {
    issues.push("missing original");
    entryScore -= 50;
    suppress = true;
  }

  if (!replacementValid) {
    issues.push("missing replacement");
    entryScore -= 35;
    suppress = true;
  }

  if (originalValid && replacementValid) {
    const originalPhrase = change.original.trim();
    const replacementPhrase = change.replacement;
    const matches = findOccurrences(original, originalPhrase);

    if (matches.length === 0) {
      issues.push("phrase not found in source");
      entryScore -= 55;
      suppress = true;
    } else {
      spans.push({ start: matches[0], end: matches[0] + originalPhrase.length, index });

      if (matches.length > 1) {
        issues.push("original phrase is ambiguous");
        entryScore -= 14;
      }
    }

    if (normalizeText(originalPhrase) === normalizeText(replacementPhrase)) {
      issues.push("original equals replacement");
      entryScore -= 40;
      suppress = true;
    }

    if (isLikelyRewrite(originalPhrase, replacementPhrase)) {
      issues.push("replacement looks like a rewrite");
      entryScore -= 18;
      suppress = true;
    }

    if (countWords(originalPhrase) > 8) {
      issues.push("original phrase too long");
      entryScore -= 12;
    }

    if (isWholeTextChange(original, originalPhrase) && countWords(originalPhrase) > 4) {
      issues.push("whole-text change");
      entryScore -= 18;
    }

    const ratio = replacementPhrase.length / Math.max(originalPhrase.length, 1);
    if (ratio > 3.5) {
      issues.push(`replacement is ${ratio.toFixed(1)}x longer`);
      entryScore -= 14;
    }
  }

  if (typeof change.explanation !== "string" || change.explanation.trim().length < 8) {
    issues.push("weak explanation");
    entryScore -= 6;
  }

  if (spans.some((span) => previousSpans.some((prev) => spansOverlap(span, prev)))) {
    issues.push("overlaps earlier change");
    entryScore -= 22;
  }

  const value = {
    ...change,
    _index: index + 1,
    _entryScore: Math.max(0, entryScore),
    _issues: issues,
  };

  return { entryScore: value._entryScore, issues, suppress, spans, value };
}

function scoreCorrectedText(corrected, original, usable, pass, penalize) {
  const reconstructed = applyUsableChanges(original, usable);

  if (normalizeText(reconstructed) === normalizeText(corrected)) {
    pass("corrected consistency", "corrected text matches usable changes");
    return;
  }

  if (normalizeText(corrected) === normalizeText(original)) {
    penalize(35, "corrected consistency", "changes listed but corrected text matches source");
    return;
  }

  const similarity = tokenSimilarity(reconstructed, corrected);
  if (similarity >= 0.85) {
    penalize(12, "corrected consistency", `corrected text differs slightly from changes (${similarity.toFixed(2)})`);
  } else {
    penalize(30, "corrected consistency", `corrected text does not match listed changes (${similarity.toFixed(2)})`);
  }
}

function applyUsableChanges(original, usable) {
  let result = original;
  for (const change of usable) {
    if (typeof change.original !== "string" || typeof change.replacement !== "string") continue;
    result = replaceFirstCaseInsensitive(result, change.original.trim(), change.replacement);
  }
  return result;
}

function replaceFirstCaseInsensitive(text, search, replacement) {
  const index = text.toLowerCase().indexOf(search.toLowerCase());
  if (index < 0) return text;
  return `${text.slice(0, index)}${replacement}${text.slice(index + search.length)}`;
}

function findOccurrences(text, phrase) {
  const haystack = text.toLowerCase();
  const needle = phrase.toLowerCase();
  const matches = [];
  let fromIndex = 0;

  while (needle && fromIndex < haystack.length) {
    const index = haystack.indexOf(needle, fromIndex);
    if (index === -1) break;
    matches.push(index);
    fromIndex = index + Math.max(1, needle.length);
  }

  return matches;
}

function hasOverlappingSpans(spans) {
  return spans.some((span, index) => spans.slice(index + 1).some((next) => spansOverlap(span, next)));
}

function spansOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function countDuplicateChanges(changes) {
  const seen = new Set();
  let duplicates = 0;

  for (const change of changes) {
    if (!change || typeof change !== "object") continue;
    const key = `${normalizeText(change.original || "")}\u0000${normalizeText(change.replacement || "")}`;
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
  }

  return duplicates;
}

function isLikelyRewrite(original, replacement) {
  const originalWords = countWords(original);
  const replacementWords = countWords(replacement);
  return replacementWords > originalWords + 4 || replacement.length > original.length * 3.5;
}

function isWholeTextChange(original, phrase) {
  return normalizeText(original) === normalizeText(phrase);
}

function countWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenSimilarity(a, b) {
  const aTokens = normalizeText(a).split(" ").filter(Boolean);
  const bTokens = normalizeText(b).split(" ").filter(Boolean);
  if (aTokens.length === 0 && bTokens.length === 0) return 1;
  if (aTokens.length === 0 || bTokens.length === 0) return 0;

  const bCounts = new Map();
  for (const token of bTokens) bCounts.set(token, (bCounts.get(token) || 0) + 1);

  let overlap = 0;
  for (const token of aTokens) {
    const count = bCounts.get(token) || 0;
    if (count > 0) {
      overlap += 1;
      bCounts.set(token, count - 1);
    }
  }

  return overlap / Math.max(aTokens.length, bTokens.length);
}

function entryPenalty(entryScore) {
  return Math.max(5, Math.round((100 - entryScore) * 0.22));
}

function clampNumber(value, min, max, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
