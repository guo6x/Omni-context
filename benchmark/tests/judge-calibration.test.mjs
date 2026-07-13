import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JudgeOutputSchema, validateJudgeOutput } from '../src/judge/schema.mjs';

const base = {
  binary_accuracy: 1,
  factual_score: 1,
  temporal_score: 1,
  contextual_score: 1,
  abstention_accuracy: 1,
  claim_evaluations: [{ claim_index: 0, evidence_id: 'a1', verdict: 'supports', used_in_answer: true }],
  rationale: 'The answer matches the supplied reference and evidence.',
};

// Fifty frozen, expectation-labelled cases exercise judge boundaries without
// invoking a provider. Provider calibration is reported separately from this
// schema/rubric calibration and may never be fabricated from these fixtures.
const samples = Array.from({ length: 50 }, (_, index) => {
  if (index % 10 === 0) return { name: `fractional binary ${index}`, value: { ...base, binary_accuracy: 0.5 }, valid: false };
  if (index % 10 === 1) return { name: `missing rationale ${index}`, value: { ...base, rationale: undefined }, valid: false };
  if (index % 10 === 2) return { name: `extra deterministic metric ${index}`, value: { ...base, evidence_precision: 1 }, valid: false };
  if (index % 10 === 3) return { name: `invalid verdict ${index}`, value: { ...base, claim_evaluations: [{ ...base.claim_evaluations[0], verdict: 'maybe' }] }, valid: false };
  if (index % 10 === 4) return { name: `negative claim index ${index}`, value: { ...base, claim_evaluations: [{ ...base.claim_evaluations[0], claim_index: -1 }] }, valid: false };
  const binary = index % 2;
  return {
    name: `valid semantic calibration ${index}`,
    value: {
      ...base,
      binary_accuracy: binary,
      factual_score: binary ? 1 : 0.25,
      temporal_score: index % 3 === 0 ? 0.8 : 1,
      contextual_score: binary ? 0.9 : 0.3,
      abstention_accuracy: index % 4 === 0 ? 0 : 1,
      claim_evaluations: [{
        claim_index: 0,
        evidence_id: 'a1',
        verdict: binary ? 'supports' : (index % 3 === 0 ? 'contradicts' : 'irrelevant'),
        used_in_answer: index % 4 !== 0,
      }],
    },
    valid: true,
  };
});

describe('judge calibration contract — 50 frozen cases', () => {
  it('contains at least 50 calibration samples', () => assert.ok(samples.length >= 50));
  for (const sample of samples) {
    it(sample.name, () => {
      const parsed = JudgeOutputSchema.safeParse(sample.value);
      assert.equal(parsed.success, sample.valid, parsed.success ? '' : parsed.error.message);
      if (sample.valid) assert.deepEqual(validateJudgeOutput(sample.value), sample.value);
    });
  }

  it('requires one strict pair-level classification shape', () => {
    assert.throws(() => validateJudgeOutput({
      ...base,
      claim_evaluations: [{ claim_index: 0, evidence_id: 'a1', verdict: 'supports' }],
    }), /schema validation/);
  });
});
