function instant(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function evidenceIsStale(evidence, temporalQuery = {}, evaluatedAt = new Date().toISOString()) {
  const point = temporalQuery.mode === 'as_of'
    ? instant(temporalQuery.as_of)
    : instant(evaluatedAt);
  if (point === null) throw new Error('Temporal evaluation point is invalid');
  const validFrom = instant(evidence.valid_from);
  const validUntil = instant(evidence.valid_until);
  const invalidatedAt = instant(evidence.invalidated_at);
  if (validFrom !== null && validFrom > point) return true;
  if (validUntil !== null && validUntil <= point) return true;
  if (invalidatedAt !== null && invalidatedAt <= point) return true;
  return false;
}

export function computeGroundingMetrics({ answer, evidence, claimEvaluations, temporalQuery, evaluatedAt }) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const expectedPairs = [];
  answer.claims.forEach((claim, claimIndex) => {
    claim.evidence_ids.forEach((evidenceId) => expectedPairs.push(`${claimIndex}:${evidenceId}`));
  });
  const evaluationByPair = new Map();
  for (const evaluation of claimEvaluations) {
    const pair = `${evaluation.claim_index}:${evaluation.evidence_id}`;
    if (!expectedPairs.includes(pair)) throw new Error(`Judge evaluated uncited claim/evidence pair: ${pair}`);
    if (evaluationByPair.has(pair)) throw new Error(`Judge duplicated claim/evidence pair: ${pair}`);
    evaluationByPair.set(pair, evaluation);
  }
  for (const pair of expectedPairs) {
    if (!evaluationByPair.has(pair)) throw new Error(`Judge omitted cited claim/evidence pair: ${pair}`);
  }

  const counts = { total_citations: expectedPairs.length, existing_citations: 0, supporting_citations: 0, irrelevant_citations: 0, contradictory_citations: 0 };
  for (const pair of expectedPairs) {
    const evidenceId = pair.slice(pair.indexOf(':') + 1);
    if (evidenceById.has(evidenceId)) counts.existing_citations++;
    const verdict = evaluationByPair.get(pair).verdict;
    if (verdict === 'supports') counts.supporting_citations++;
    else if (verdict === 'irrelevant') counts.irrelevant_citations++;
    else counts.contradictory_citations++;
  }
  const evidencePrecision = counts.total_citations === 0 ? 0 : counts.supporting_citations / counts.total_citations;

  let memoryGroundedClaims = 0;
  let staleUsedClaims = 0;
  answer.claims.forEach((claim, claimIndex) => {
    const adopted = claim.evidence_ids.filter((evidenceId) => evaluationByPair.get(`${claimIndex}:${evidenceId}`)?.used_in_answer);
    if (adopted.length === 0) return;
    memoryGroundedClaims++;
    if (adopted.some((id) => evidenceIsStale(evidenceById.get(id), temporalQuery, evaluatedAt))) staleUsedClaims++;
  });
  const staleMemoryLeakage = memoryGroundedClaims === 0 ? 0 : staleUsedClaims / memoryGroundedClaims;
  return {
    evidence_precision: evidencePrecision,
    stale_memory_leakage: staleMemoryLeakage,
    evidence_counts: counts,
    stale_counts: { stale_used_claims: staleUsedClaims, memory_grounded_claims: memoryGroundedClaims },
  };
}
