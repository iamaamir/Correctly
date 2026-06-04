# Blackbox Analysis

Run: `blackbox/runs/2026-05-31T14-18-12-310Z-lmstudio-granite-test-drive.jsonl`
Evaluation: `blackbox/runs/latest-evaluation.json`

## Summary

All tests passed with an average acceptance score of 67.

## Recommendations

### P0: Review extract display changes for better visibility and consistency.

- Area: `extractDisplayChanges`
- Evidence: `0001`, `0003`
- Problem: Some changes were not visible or consistent with the intended meaning.
- Suggested change: Review the extract display changes to ensure they are accurate and consistent with the intended meaning.
- Suggested tests: fixture or unit/e2e test to add

### P1: Review scoring for accepted corrections.

- Area: `scoreAcceptedCorrection`
- Evidence: `0002`, `0011`
- Problem: Some corrections were not scored correctly.
- Suggested change: Review the scoring for accepted corrections to ensure it is accurate and consistent with the intended meaning.
- Suggested tests: fixture or unit/e2e test to add

### P1: Review cascade cache policy.

- Area: `cascade_cache`
- Evidence: `0004`, `0020`
- Problem: Some changes were not cached correctly.
- Suggested change: Review the cascade cache policy to ensure it is accurate and consistent with the intended meaning.
- Suggested tests: fixture or unit/e2e test to add

### P1: Review prompts for better visibility and consistency.

- Area: `prompts`
- Evidence: `0005`, `0021`
- Problem: Some prompts were not visible or consistent with the intended meaning.
- Suggested change: Review the prompts to ensure they are accurate and consistent with the intended meaning.
- Suggested tests: fixture or unit/e2e test to add

### P1: Review fixture quality.

- Area: `fixture_quality`
- Evidence: `0006`, `0022`
- Problem: Some fixtures were not of high quality.
- Suggested change: Review the fixture quality to ensure it is accurate and consistent with the intended meaning.
- Suggested tests: fixture or unit/e2e test to add

### P1: Review model quality.

- Area: `model_quality`
- Evidence: `0007`, `0023`
- Problem: Some models were not of high quality.
- Suggested change: Review the model quality to ensure it is accurate and consistent with the intended meaning.
- Suggested tests: fixture or unit/e2e test to add

## Fixture Review

- Promote as-is: `0008`
- Promote with edits: none
- Discard: none

