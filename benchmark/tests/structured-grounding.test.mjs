import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvidence, validateStructuredAnswer } from '../src/answer/schema.mjs';
import { computeGroundingMetrics, evidenceIsStale } from '../src/metrics/grounding.mjs';

const evidence = (id, overrides = {}) => ({
  id, type: 'assertion', source_span: 'Alice: fact', temporal_status: 'current',
  valid_from: '2023-01-01T00:00:00.000Z', valid_until: null,
  invalidated_at: null, provenance: { session_id: 's1' }, ...overrides,
});
const answer = (ids = ['a1']) => ({
  answer: 'Alice has a fact.', claims: [{ text: 'Alice has a fact.', evidence_ids: ids }],
  abstained: false, abstention_reason: null,
});
const evaluation = (id, verdict = 'supports', used = true, claimIndex = 0) => ({
  claim_index: claimIndex, evidence_id: id, verdict, used_in_answer: used,
});

describe('structured answer validation', () => {
  it('accepts a grounded strict answer', () => assert.equal(validateStructuredAnswer(answer(), [evidence('a1')]).answer, 'Alice has a fact.'));
  it('rejects unknown evidence IDs', () => assert.throws(() => validateStructuredAnswer(answer(['missing']), [evidence('a1')]), /unknown evidence/));
  it('rejects ungrounded factual claims', () => assert.throws(() => validateStructuredAnswer(answer([]), [evidence('a1')]), /ungrounded/));
  it('rejects extra answer keys', () => assert.throws(() => validateStructuredAnswer({ ...answer(), extra: true }, [evidence('a1')]), /schema validation/));
  it('requires abstention reason', () => assert.throws(() => validateStructuredAnswer({ answer: 'unknown', claims: [], abstained: true, abstention_reason: null }, []), /required/));
  it('accepts a legal abstention', () => assert.equal(validateStructuredAnswer({ answer: 'unknown', claims: [], abstained: true, abstention_reason: 'No evidence.' }, []).abstained, true));
  it('requires null reason when answering', () => assert.throws(() => validateStructuredAnswer({ ...answer(), abstention_reason: 'why' }, [evidence('a1')]), /must be null/));
  it('validates the retrieval evidence envelope', () => assert.equal(normalizeEvidence({ evidence: [evidence('a1')] })[0].id, 'a1'));
  it('rejects absent retrieval evidence as a citation target', () => assert.throws(() => validateStructuredAnswer(answer(), normalizeEvidence({ results: [{ id: 'a1' }] })), /unknown evidence/));
  it('rejects malformed evidence validity fields', () => assert.throws(() => normalizeEvidence({ evidence: [{ id: 'a1' }] }), /evidence schema/));
});

describe('deterministic evidence precision — 20 cases', () => {
  const cases = [
    { name: 'one support', ids: ['a1'], evals: [evaluation('a1')], expected: 1 },
    { name: 'one irrelevant', ids: ['a1'], evals: [evaluation('a1', 'irrelevant')], expected: 0 },
    { name: 'one contradiction', ids: ['a1'], evals: [evaluation('a1', 'contradicts')], expected: 0 },
    { name: 'support plus irrelevant', ids: ['a1', 'a2'], evals: [evaluation('a1'), evaluation('a2', 'irrelevant')], expected: 0.5 },
    { name: 'support plus contradiction', ids: ['a1', 'a2'], evals: [evaluation('a1'), evaluation('a2', 'contradicts')], expected: 0.5 },
    { name: 'two supports', ids: ['a1', 'a2'], evals: [evaluation('a1'), evaluation('a2')], expected: 1 },
    { name: 'one of three supports', ids: ['a1', 'a2', 'a3'], evals: [evaluation('a1'), evaluation('a2', 'irrelevant'), evaluation('a3', 'contradicts')], expected: 1 / 3 },
    { name: 'two of three support', ids: ['a1', 'a2', 'a3'], evals: [evaluation('a1'), evaluation('a2'), evaluation('a3', 'irrelevant')], expected: 2 / 3 },
    { name: 'all three irrelevant', ids: ['a1', 'a2', 'a3'], evals: ['a1', 'a2', 'a3'].map((id) => evaluation(id, 'irrelevant')), expected: 0 },
    { name: 'all three support', ids: ['a1', 'a2', 'a3'], evals: ['a1', 'a2', 'a3'].map((id) => evaluation(id)), expected: 1 },
  ];
  for (let repeat = 0; repeat < 2; repeat++) for (const c of cases) {
    it(`${c.name} pass ${repeat + 1}`, () => {
      const ev = c.ids.map((id) => evidence(id));
      const result = computeGroundingMetrics({ answer: answer(c.ids), evidence: ev, claimEvaluations: c.evals, temporalQuery: { mode: 'current' }, evaluatedAt: '2024-01-01T00:00:00Z' });
      assert.equal(result.evidence_precision, c.expected);
      assert.equal(result.evidence_counts.total_citations, c.ids.length);
    });
  }
  it('legal abstention with no citations scores precision zero', () => {
    const result = computeGroundingMetrics({ answer: { answer: 'unknown', claims: [], abstained: true, abstention_reason: 'none' }, evidence: [], claimEvaluations: [], temporalQuery: {}, evaluatedAt: '2024-01-01T00:00:00Z' });
    assert.equal(result.evidence_precision, 0);
  });
  it('rejects an omitted cited pair', () => assert.throws(() => computeGroundingMetrics({ answer: answer(), evidence: [evidence('a1')], claimEvaluations: [], temporalQuery: {}, evaluatedAt: '2024-01-01T00:00:00Z' }), /omitted/));
  it('rejects an uncited evaluated pair', () => assert.throws(() => computeGroundingMetrics({ answer: answer(), evidence: [evidence('a1'), evidence('a2')], claimEvaluations: [evaluation('a1'), evaluation('a2')], temporalQuery: {}, evaluatedAt: '2024-01-01T00:00:00Z' }), /uncited/));
  it('rejects a duplicate pair', () => assert.throws(() => computeGroundingMetrics({ answer: answer(), evidence: [evidence('a1')], claimEvaluations: [evaluation('a1'), evaluation('a1')], temporalQuery: {}, evaluatedAt: '2024-01-01T00:00:00Z' }), /duplicated/));
});

describe('deterministic stale-memory leakage — 20 cases', () => {
  const currentTime = '2024-06-01T00:00:00Z';
  const checks = [
    ['current open assertion', {}, { mode: 'current' }, false],
    ['expired before current', { valid_until: '2024-01-01T00:00:00Z' }, { mode: 'current' }, true],
    ['expires after current', { valid_until: '2025-01-01T00:00:00Z' }, { mode: 'current' }, false],
    ['invalidated before current', { invalidated_at: '2024-02-01T00:00:00Z' }, { mode: 'current' }, true],
    ['invalidated after current', { invalidated_at: '2025-02-01T00:00:00Z' }, { mode: 'current' }, false],
    ['not yet valid current', { valid_from: '2025-01-01T00:00:00Z' }, { mode: 'current' }, true],
    ['valid at as-of point', { valid_from: '2020-01-01T00:00:00Z', valid_until: '2023-01-01T00:00:00Z' }, { mode: 'as_of', as_of: '2022-01-01T00:00:00Z' }, false],
    ['expired at as-of point', { valid_until: '2021-01-01T00:00:00Z' }, { mode: 'as_of', as_of: '2022-01-01T00:00:00Z' }, true],
    ['invalidated at as-of point', { invalidated_at: '2021-01-01T00:00:00Z' }, { mode: 'as_of', as_of: '2022-01-01T00:00:00Z' }, true],
    ['future at as-of point', { valid_from: '2023-01-01T00:00:00Z' }, { mode: 'as_of', as_of: '2022-01-01T00:00:00Z' }, true],
  ];
  for (let repeat = 0; repeat < 2; repeat++) for (const [name, fields, query, expected] of checks) {
    it(`${name} pass ${repeat + 1}`, () => assert.equal(evidenceIsStale(evidence('a1', fields), query, currentTime), expected));
  }
  it('retrieved stale but uncited does not leak', () => {
    const result = computeGroundingMetrics({ answer: answer(['a1']), evidence: [evidence('a1'), evidence('old', { valid_until: '2020-01-01T00:00:00Z' })], claimEvaluations: [evaluation('a1')], temporalQuery: { mode: 'current' }, evaluatedAt: currentTime });
    assert.equal(result.stale_memory_leakage, 0);
  });
  it('cited stale but explicitly rejected does not leak', () => {
    const result = computeGroundingMetrics({ answer: answer(['old']), evidence: [evidence('old', { valid_until: '2020-01-01T00:00:00Z' })], claimEvaluations: [evaluation('old', 'contradicts', false)], temporalQuery: { mode: 'current' }, evaluatedAt: currentTime });
    assert.equal(result.stale_memory_leakage, 0);
  });
  it('cited and adopted stale evidence leaks', () => {
    const result = computeGroundingMetrics({ answer: answer(['old']), evidence: [evidence('old', { valid_until: '2020-01-01T00:00:00Z' })], claimEvaluations: [evaluation('old')], temporalQuery: { mode: 'current' }, evaluatedAt: currentTime });
    assert.equal(result.stale_memory_leakage, 1);
  });
  it('one stale adopted claim out of two yields one half', () => {
    const multi = { answer: 'two claims', abstained: false, abstention_reason: null, claims: [{ text: 'new', evidence_ids: ['new'] }, { text: 'old', evidence_ids: ['old'] }] };
    const result = computeGroundingMetrics({ answer: multi, evidence: [evidence('new'), evidence('old', { invalidated_at: '2020-01-01T00:00:00Z' })], claimEvaluations: [evaluation('new'), evaluation('old', 'supports', true, 1)], temporalQuery: { mode: 'current' }, evaluatedAt: currentTime });
    assert.equal(result.stale_memory_leakage, 0.5);
  });
});
