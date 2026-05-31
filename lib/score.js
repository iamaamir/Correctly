/**
 * Score a model's grammar correction response.
 *
 * Goal: accept small, source-grounded grammar fixes; cascade on hallucinated,
 * ambiguous, structurally inconsistent, or broad rewrite responses.
 */

const LEVEL_PENALTIES = { 1: 0, 2: 12, 3: 20 };
const MAX_CHANGE_DENSITY = 0.45;
const MIN_ENTRY_SCORE = 55;

/**
 * Stage 1: Contract validation.
 * Validates that a provider response has the required shape for the given level.
 *
 * @param {unknown} result - raw provider result
 * @param {{ level: 1 | 2 | 3 }} options
 * @returns {{ ok: boolean, reason: string | null, value: { corrected: string, changes: Array, confidence: number } | null }}
 */
export function validateGrammarResponse(result, { level } = {}) {
  if (!result || typeof result !== "object") {
    return { ok: false, reason: "response is not an object", value: null };
  }

  if (typeof result.corrected !== "string") {
    return { ok: false, reason: 'missing or non-string "corrected"', value: null };
  }

  if (!Array.isArray(result.changes)) {
    return { ok: false, reason: 'missing or non-array "changes"', value: null };
  }

  if (level === 1 || level === 2) {
    const confidence = result.confidence;
    if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 1 || confidence > 10) {
      return { ok: false, reason: `missing or invalid "confidence" for level ${level}: expected 1-10`, value: null };
    }
  }

  return {
    ok: true,
    reason: null,
    value: { corrected: result.corrected, changes: result.changes, confidence: result.confidence },
  };
}

/**
 * Stage 2: Capability classification.
 * Classifies a provider error to determine cascade behavior and cache implications.
 *
 * @param {Error} error
 * @returns {{ kind: "supported" | "structured_output_unsupported" | "json_not_followed" | "network_or_auth_failure" | "rate_limit" | "unknown_failure", cascadeable: boolean, cacheLevelHint: (1 | 2 | 3 | null) }}
 */
export function classifyProviderFailure(error) {
  const msg = error?.message || "";
  const lowerMsg = msg.toLowerCase();

  if (error?.classification) {
    return error.classification;
  }

  if (error?.cacheLevelHint) {
    return {
      kind: error.kind || "structured_output_unsupported",
      cascadeable: error.cascadeable ?? true,
      cacheLevelHint: error.cacheLevelHint,
      cacheReason: error.cacheReason || "structured_output_unsupported",
    };
  }

  if (msg.includes("response_format") || msg.includes("json_schema")) {
    return {
      kind: "structured_output_unsupported",
      cascadeable: true,
      cacheLevelHint: 2,
      cacheReason: "structured_output_unsupported",
    };
  }

  if (
    msg.includes("Failed to parse") ||
    msg.includes("Provider returned invalid response") ||
    msg.includes("Provider response invalid") ||
    msg.includes("Provider response changes") ||
    msg.includes("Empty response from")
  ) {
    return { kind: "json_not_followed", cascadeable: true, cacheLevelHint: null };
  }

  if (
    lowerMsg.includes("rate limit") ||
    lowerMsg.includes("rate_limit") ||
    lowerMsg.includes("too many requests") ||
    lowerMsg.includes("quota") ||
    msg.includes("429")
  ) {
    return { kind: "rate_limit", cascadeable: false, cacheLevelHint: null };
  }

  if (
    msg.includes("API key") ||
    msg.includes("401") ||
    msg.includes("Unauthorized") ||
    msg.includes("403") ||
    lowerMsg.includes("auth") ||
    lowerMsg.includes("timeout") ||
    lowerMsg.includes("network") ||
    lowerMsg.includes("fetch")
  ) {
    return { kind: "network_or_auth_failure", cascadeable: false, cacheLevelHint: null };
  }

  return { kind: "unknown_failure", cascadeable: false, cacheLevelHint: null };
}

/**
 * Stage 4: Suggestion extraction.
 * Determines which individual changes are safe to display in the UI
 * and which should be hidden.
 *
 * @param {{ corrected: string, changes: Array }} parsed - validated response
 * @param {string} originalText
 * @returns {{ displayChanges: Array<{original: string, replacement: string, explanation: string}>, hiddenChanges: Array<{original: string, replacement: string, explanation: string, reason: string}> }}
 */
export function extractDisplayChanges(parsed, originalText) {
  const original = typeof originalText === "string" ? originalText : "";
  const displayChanges = [];
  const hiddenChanges = [];
  const spans = [];

  if (!Array.isArray(parsed?.changes)) {
    return { displayChanges, hiddenChanges };
  }

  for (let i = 0; i < parsed.changes.length; i++) {
    const change = parsed.changes[i];
    const entry = scoreChange(change, i, original, spans);
    spans.push(...entry.spans);

    const { _index, _entryScore, _issues, ...cleanChange } = entry.value;

    if (entry.suppress || entry.entryScore < MIN_ENTRY_SCORE) {
      const reasons = [];
      if (entry.benignSuppression) {
        reasons.push("insertion-only punctuation");
      }
      if (entry.issues.includes("phrase not found in source")) {
        reasons.push("original not found in source text");
      }
      if (entry.issues.includes("original phrase is ambiguous")) {
        reasons.push("ambiguous match in source");
      }
      if (entry.issues.includes("whole-text change")) {
        reasons.push("whole-text change not shown as individual suggestion");
      }
      if (entry.issues.includes("original equals replacement")) {
        reasons.push("original equals replacement");
      }
      if (entry.issues.includes("replacement looks like a rewrite")) {
        reasons.push("replacement is a broad rewrite");
      }
      if (entry.issues.includes("overlaps earlier change")) {
        reasons.push("overlaps another change");
      }
      if (entry.issues.includes("missing original")) {
        reasons.push("change has no original text");
      }
      hiddenChanges.push({
        ...cleanChange,
        reason: reasons.length > 0 ? reasons.join("; ") : `low confidence (score: ${entry.entryScore})`,
      });
    } else {
      displayChanges.push(cleanChange);
    }
  }

  return { displayChanges, hiddenChanges };
}

/**
 * Stage 3: Response trust scoring.
 * Decides if the full corrected text is safe to use.
 *
 * @param {{ corrected: string, changes: Array }} parsed - validated response
 * @param {string} originalText
 * @param {1|2|3} level
 * @param {{ displayChanges: Array, hiddenChanges: Array }} [extraction] - pre-computed from extractDisplayChanges
 * @returns {{ acceptanceScore: number, accepted: boolean, reasons: Array<{name: string, pass: boolean, detail: string, penalty: number}>, corrected: string }}
 */
export function scoreAcceptedCorrection(parsed, originalText, level = 1, extraction) {
  const reasons = [];
  const original = typeof originalText === "string" ? originalText : "";
  let score = 100;

  function penalize(amount, name, detail) {
    const penalty = Math.max(0, Math.min(100, amount));
    score -= penalty;
    reasons.push({ pass: false, name, detail, penalty });
  }

  function pass(name, detail) {
    reasons.push({ pass: true, name, detail, penalty: 0 });
  }

  if (!parsed || typeof parsed !== "object") {
    penalize(100, "structure", "response is not an object");
    return { acceptanceScore: 0, accepted: false, reasons, corrected: "" };
  }

  if (typeof parsed.corrected !== "string") {
    penalize(100, "corrected field", "missing or non-string");
    return { acceptanceScore: 0, accepted: false, reasons, corrected: "" };
  }

  if (!Array.isArray(parsed.changes)) {
    penalize(100, "changes field", "missing or non-array");
    return { acceptanceScore: 0, accepted: false, reasons, corrected: parsed.corrected };
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
    scoreEmptyResponse(parsed.corrected, original, level, reasons, pass, penalize);
    const acceptanceScore = Math.max(0, Math.min(100, Math.round(score)));
    return { acceptanceScore, accepted: acceptanceScore >= 60, reasons, corrected: parsed.corrected };
  }

  const ext = extraction || extractDisplayChanges(parsed, originalText);
  const spans = [];

  for (let i = 0; i < parsed.changes.length; i++) {
    const change = parsed.changes[i];
    const isHidden = ext.hiddenChanges.some(
      (h) => h.original === change.original && h.replacement === change.replacement,
    );
    const isBenign = isHidden && (!change.original || change.original.trim().length === 0);

    if (isBenign) {
      pass(`change #${i + 1}`, `insertion-only punctuation hidden: "${change.replacement}"`);
    } else if (isHidden) {
      penalize(
        30,
        `change #${i + 1}`,
        `${change.original} -> ${change.replacement} suppressed (${ext.hiddenChanges.find((h) => h.original === change.original && h.replacement === change.replacement)?.reason || "low quality"})`,
      );
    } else {
      pass(`change #${i + 1}`, `"${change.original}" -> "${change.replacement}"`);
    }

    if (typeof change.original === "string" && change.original.trim().length > 0) {
      const matches = findOccurrences(original, change.original.trim());
      if (matches.length > 0) {
        spans.push({ start: matches[0], end: matches[0] + change.original.trim().length, index: i });
      }
    }
  }

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

  if (changeCount > 0 && ext.displayChanges.length === 0) {
    penalize(25, "usable changes", "all listed changes were suppressed");
  } else {
    pass("usable changes", `${ext.displayChanges.length}/${changeCount} usable`);
  }

  const hasWholeText = parsed.changes.some(
    (c) => typeof c.original === "string" && isWholeTextChange(original, c.original),
  );
  if (hasWholeText) {
    penalize(18, "granularity", "model returned a whole-text edit instead of targeted changes");
  } else {
    pass("granularity", "targeted changes");
  }

  scoreCorrectedText(parsed.corrected, original, ext.displayChanges, pass, penalize);

  const levelPenalty = LEVEL_PENALTIES[level] ?? 0;
  if (levelPenalty > 0) penalize(levelPenalty, "cascade level", `level ${level}`);

  const acceptanceScore = Math.max(0, Math.min(100, Math.round(score)));
  return { acceptanceScore, accepted: acceptanceScore >= 60, reasons, corrected: parsed.corrected };
}

export async function scoreResponse(parsed, originalText, level = 1) {
  const extraction = extractDisplayChanges(parsed, originalText);
  const acceptance = scoreAcceptedCorrection(parsed, originalText, level, extraction);

  const usable = extraction.displayChanges.map((c, i) => ({
    ...c,
    _index: i + 1,
    _entryScore: 100,
    _issues: [],
  }));

  const issueMap = {
    "original not found in source text": "phrase not found in source",
    "insertion-only punctuation": "insertion-only change",
    "ambiguous match in source": "original phrase is ambiguous",
    "whole-text change not shown as individual suggestion": "whole-text change",
    "original equals replacement": "original equals replacement",
    "replacement is a broad rewrite": "replacement looks like a rewrite",
    "overlaps another change": "overlaps earlier change",
    "change has no original text": "missing original",
  };
  const suppressed = extraction.hiddenChanges.map((c) => ({
    ...c,
    _index: 0,
    _entryScore: 0,
    _issues: c.reason.split("; ").map((r) => issueMap[r] || r),
  }));

  const finalScore = Math.max(0, Math.min(100, Math.round(acceptance.acceptanceScore)));
  const tier = finalScore >= 80 ? "high" : finalScore >= 60 ? "medium" : finalScore >= 25 ? "low" : "reject";
  return { score: finalScore, tier, checks: acceptance.reasons, usable, suppressed };
}

/**
 * Stage 5: Confidence merge.
 * Combines modelConfidence (1-10) with acceptanceScore (0-100) into a single
 * displayConfidence (0-100) shown to the user.
 *
 * @param {number} modelConfidence - model's self-reported 1-10 confidence
 * @param {number} acceptanceScore - internal 0-100 trust score
 * @returns {number} displayConfidence 0-100
 */
export async function mergeConfidence(modelConfidence, acceptanceScore) {
  const modelNormalized = clampNumber(modelConfidence, 1, 10, 5) / 10;
  const ourNormalized = clampNumber(acceptanceScore, 0, 100, 0) / 100;

  // Trust model self-confidence only when our structural/evidence score is strong.
  const modelWeight = ourNormalized >= 0.75 ? 0.25 : ourNormalized >= 0.6 ? 0.15 : 0.05;
  const merged = modelNormalized * modelWeight + ourNormalized * (1 - modelWeight);
  return Math.round(merged * 100);
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
  let benignSuppression = false;

  if (!change || typeof change !== "object") {
    return {
      entryScore: 0,
      issues: ["change is not an object"],
      suppress: true,
      spans,
      value: { _index: index + 1, _entryScore: 0, _issues: ["change is not an object"] },
    };
  }

  const hasOriginalString = typeof change.original === "string";
  const originalValid = hasOriginalString && change.original.trim().length > 0;
  const replacementValid = typeof change.replacement === "string";

  if (!originalValid) {
    issues.push(hasOriginalString ? "insertion-only change" : "missing original");
    entryScore -= hasOriginalString ? 20 : 50;
    suppress = true;
    benignSuppression = hasOriginalString && replacementValid && isPunctuationOnly(change.replacement);
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

    if (normalizeText(originalPhrase) === normalizeText(replacementPhrase) && originalPhrase === replacementPhrase) {
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

  return { entryScore: value._entryScore, issues, suppress, benignSuppression, spans, value };
}

function scoreCorrectedText(corrected, original, usable, pass, penalize) {
  const reconstructed = applyUsableChanges(original, usable);

  if (normalizeText(reconstructed) === normalizeText(corrected)) {
    pass("corrected consistency", "corrected text matches usable changes");
    return;
  }

  if (normalizeTextWithoutPunctuation(reconstructed) === normalizeTextWithoutPunctuation(corrected)) {
    pass("corrected consistency", "corrected text matches usable changes aside from punctuation");
    return;
  }

  if (normalizeText(corrected) === normalizeText(original)) {
    penalize(35, "corrected consistency", "changes listed but corrected text matches source");
    return;
  }

  const similarity = tokenSimilarity(reconstructed, corrected);
  if (similarity >= 0.75) {
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
  if (isWordLike(phrase)) return findWordOccurrences(text, phrase);

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

function findWordOccurrences(text, phrase) {
  const matches = [];
  const escaped = escapeRegExp(phrase);
  const pattern = new RegExp(`(^|[^A-Za-z0-9'])(${escaped})(?=$|[^A-Za-z0-9'])`, "gi");
  let match = pattern.exec(text);
  while (match !== null) {
    matches.push(match.index + match[1].length);
    match = pattern.exec(text);
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

function normalizeTextWithoutPunctuation(text) {
  return normalizeText(text).replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, "");
}

function isPunctuationOnly(text) {
  return typeof text === "string" && /^[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]+$/.test(text);
}

function isWordLike(text) {
  return typeof text === "string" && /^[A-Za-z0-9']+$/.test(text);
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function clampNumber(value, min, max, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
