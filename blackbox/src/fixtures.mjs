export function toFixtureCandidate(record) {
  const result = record.correctlyResult;
  const scoring = record.scoring;
  return {
    id: record.id,
    original: record.generated?.original || record.original,
    level: result?.cascadeLevel || 1,
    rawResponse: result
      ? {
          corrected: result.corrected,
          changes: result.changes || [],
          confidence: normalizeConfidenceForFixture(result.confidence),
        }
      : null,
    expected: {
      accept: Boolean(scoring?.accepted),
      corrected: result?.corrected || "",
      displayChanges: scoring?.displayChanges?.map(({ original, replacement }) => ({ original, replacement })) || [],
      hiddenChangeCount: scoring?.hiddenChanges?.length || 0,
    },
    notes: record.judge?.reason || record.generated?.notes || "",
  };
}

function normalizeConfidenceForFixture(confidence) {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return 5;
  if (confidence >= 1 && confidence <= 10) return confidence;
  return Math.max(1, Math.min(10, Math.round(confidence / 10)));
}
