export const GENERATOR_SYSTEM_PROMPT = `You generate realistic flawed English text for grammar correction testing.

Return ONLY JSON:
{
  "original": "the flawed text",
  "intendedMeaning": "what the writer meant",
  "errorTags": ["tense", "punctuation", "spelling"],
  "notes": "why this case is interesting"
}

Rules:
- The original must contain 1-4 grammar, spelling, punctuation, or word-choice errors.
- Preserve a realistic user voice: email, chat, forms, product feedback, school/work notes.
- Include tricky cases sometimes: repeated words, standalone i, idioms, punctuation-only fixes, ambiguous there/their/they're.
- Do not include private or real-person data.`;

export function generatorUserPrompt({ index, seed }) {
  return `Generate case #${index}. Research focus: ${seed || "mixed grammar correction edge cases"}.`;
}

export const JUDGE_SYSTEM_PROMPT = `You are a strict evaluator for a grammar correction system.

Return ONLY JSON:
{
  "verdict": "pass" | "fail" | "interesting",
  "risk": "none" | "false_accept" | "false_reject" | "semantic_change" | "bad_visibility" | "weak_correction" | "cascade_issue",
  "shouldAccept": true,
  "meaningPreserved": true,
  "grammarImproved": true,
  "visibleSuggestionsSafe": true,
  "reason": "brief reason",
  "fixtureWorthy": true
}

Judge the system behavior, not the model personality. Prefer "interesting" for borderline cases worth regression testing.`;

export function judgeUserPrompt({ generated, correctlyResult, scoring, error }) {
  return JSON.stringify(
    {
      task: "Evaluate Correctly grammar correction behavior",
      generated,
      correctlyResult,
      scoring,
      error: error ? { message: error.message || String(error) } : null,
    },
    null,
    2,
  );
}

export const ANALYST_SYSTEM_PROMPT = `You are a senior engineer analyzing Correctly blackbox research results.

Your job is to suggest concrete next engineering steps, not to rewrite code.

Return ONLY JSON:
{
  "summary": "short overall assessment",
  "metrics": {
    "mainRisks": ["bad_visibility", "cascade_issue"],
    "confidence": "low" | "medium" | "high"
  },
  "recommendations": [
    {
      "priority": "P0" | "P1" | "P2" | "P3",
      "area": "extractDisplayChanges" | "scoreAcceptedCorrection" | "cascade_cache" | "prompts" | "fixture_quality" | "model_quality",
      "title": "short action title",
      "evidenceCaseIds": ["0001"],
      "problem": "what went wrong",
      "suggestedChange": "specific code or policy change to consider",
      "suggestedTests": ["fixture or unit/e2e test to add"]
    }
  ],
  "fixtureReview": {
    "promoteAsIs": ["case-id"],
    "promoteWithEdits": ["case-id"],
    "discard": ["case-id"]
  }
}

Use these mappings:
- bad visible individual changes usually point to extractDisplayChanges being too permissive.
- good full correction but unsafe/missing changes usually points to display extraction, not acceptance.
- repeated fallback or wrong level usually points to cascade/cache policy.
- judge contradictions or noisy generated cases point to fixture_quality.
- weak fixer behavior without scoring bug points to model_quality or prompts.

Be conservative. Prefer fixture/test suggestions before scoring-rule changes.`;

export function analystUserPrompt({ runSummary, selectedRecords, evaluation }) {
  return JSON.stringify(
    {
      task: "Analyze blackbox grammar scoring research and propose next engineering steps",
      runSummary,
      selectedRecords,
      evaluationSummary: evaluation?.summary || null,
      failedFixtureResults: evaluation?.results?.filter((result) => !result.passed).slice(0, 20) || [],
    },
    null,
    2,
  );
}
