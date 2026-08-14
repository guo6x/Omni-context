/**
 * Goal24 Checkpoint 8 (Lane A) - trusted evaluator + registry tests.
 *
 * The evaluator boundary is deterministic and typed: expectations come only
 * from approved normalized_inputs + verification_plan, evaluation compares
 * structured fields, and an LLM judge / free-form predicate can never be an
 * authority (strict schemas reject every such key).
 */

import { describe, expect, it } from 'vitest';
import {
  OutcomeEvaluatorRegistry,
  OutcomeExpectationSchema,
  outcomeExpectationDigest,
  parseEvaluationResult,
  validateExpectationFromEvaluator,
  type OutcomeEvaluatorV1,
} from '../src/outcome/index.js';
import { OutcomeError } from '../src/outcome/index.js';
import {
  TEST_ITEM_EVALUATOR,
  TEST_ITEM_OLD_VALUE,
  TEST_ITEM_SUBJECT,
  TEST_ITEM_VALUE,
  buildItemWritePlan,
  buildObservation,
  buildReceipt,
} from './helpers/fake-outcome.js';

describe('OutcomeEvaluatorRegistry', () => {
  it('registers a trusted evaluator and resolves it by capability id', () => {
    const registry = new OutcomeEvaluatorRegistry();
    registry.register(TEST_ITEM_EVALUATOR);
    expect(registry.getForCapability('test.item.update')).toBe(TEST_ITEM_EVALUATOR);
    expect(registry.get('test-item-update-evaluator')).toBe(TEST_ITEM_EVALUATOR);
    expect(registry.list()).toEqual([TEST_ITEM_EVALUATOR]);
  });

  it('rejects duplicate capability registration', () => {
    const registry = new OutcomeEvaluatorRegistry();
    registry.register(TEST_ITEM_EVALUATOR);
    const duplicate: OutcomeEvaluatorV1 = {
      ...TEST_ITEM_EVALUATOR,
      metadata: { ...TEST_ITEM_EVALUATOR.metadata, evaluator_id: 'other-evaluator', version: '1.0.1' },
    };
    expect(() => registry.register(duplicate)).toThrowError(OutcomeError);
    expect(() => registry.register(duplicate)).toThrowError(/already registered for capability/);
  });

  it('rejects duplicate evaluator id registration', () => {
    const registry = new OutcomeEvaluatorRegistry();
    registry.register(TEST_ITEM_EVALUATOR);
    const duplicate: OutcomeEvaluatorV1 = {
      ...TEST_ITEM_EVALUATOR,
      metadata: { ...TEST_ITEM_EVALUATOR.metadata, capability_id: 'test.other.update' },
    };
    expect(() => registry.register(duplicate)).toThrowError(/evaluator with id/);
  });

  it('rejects invalid metadata', () => {
    const registry = new OutcomeEvaluatorRegistry();
    const broken = {
      metadata: { evaluator_id: 'x', capability_id: 'not-a-capability', verification_capability_id: 'test.item.read', version: '1' },
      deriveExpectation: () => ({}),
      evaluate: () => ({ status: 'verified', reason_codes: ['OUTCOME_VERIFIED'] }),
    };
    expect(() => registry.register(broken as unknown as OutcomeEvaluatorV1)).toThrowError(/metadata is invalid/);
  });

  it('rejects evaluators without the required methods', () => {
    const registry = new OutcomeEvaluatorRegistry();
    const broken = { metadata: TEST_ITEM_EVALUATOR.metadata } as unknown as OutcomeEvaluatorV1;
    expect(() => registry.register(broken)).toThrowError(/deriveExpectation/);
  });
});

describe('deriveExpectation', () => {
  it('derives the expectation from approved normalized_inputs only', () => {
    const plan = buildItemWritePlan({ itemId: 'item-42', value: 'v-42' });
    const expectation = TEST_ITEM_EVALUATOR.deriveExpectation(plan);
    expect(OutcomeExpectationSchema.safeParse(expectation).success).toBe(true);
    expect(expectation.subject_key).toBe('test:item:item-42');
    expect(expectation.assertions).toEqual({ item_id: 'item-42', value: 'v-42' });
  });

  it('binds the verification capability of the trusted evaluator metadata', () => {
    const plan = buildItemWritePlan();
    const expectation = TEST_ITEM_EVALUATOR.deriveExpectation(plan);
    expect(expectation.verification_capability_id).toBe('test.item.read');
    expect(expectation.capability_id).toBe('test.item.update');
  });
});

describe('evaluate (deterministic structured comparison)', () => {
  const setup = (payload: Record<string, unknown>) => {
    const plan = buildItemWritePlan();
    const receipt = buildReceipt({ plan });
    const expectation = TEST_ITEM_EVALUATOR.deriveExpectation(plan);
    const observation = buildObservation({
      attemptId: 'att-test-1',
      plan,
      receiptId: receipt.receipt_id,
      payload,
    });
    return { expectation, observation };
  };

  it('exact structured match -> verified', () => {
    const { expectation, observation } = setup({ item_id: 'item-1', value: TEST_ITEM_VALUE });
    const result = TEST_ITEM_EVALUATOR.evaluate(expectation, observation);
    expect(result).toEqual({ status: 'verified', reason_codes: ['OUTCOME_VERIFIED'] });
  });

  it('different value -> mismatch', () => {
    const { expectation, observation } = setup({ item_id: 'item-1', value: TEST_ITEM_OLD_VALUE });
    const result = TEST_ITEM_EVALUATOR.evaluate(expectation, observation);
    expect(result).toEqual({ status: 'mismatch', reason_codes: ['OUTCOME_MISMATCH'] });
  });

  it('different item id -> mismatch', () => {
    const { expectation, observation } = setup({ item_id: 'item-9', value: TEST_ITEM_VALUE });
    const result = TEST_ITEM_EVALUATOR.evaluate(expectation, observation);
    expect(result.status).toBe('mismatch');
  });

  it('missing required field -> inconclusive (never guessed success)', () => {
    const { expectation, observation } = setup({ item_id: 'item-1' });
    const result = TEST_ITEM_EVALUATOR.evaluate(expectation, observation);
    expect(result).toEqual({ status: 'inconclusive', reason_codes: ['OUTCOME_INCONCLUSIVE'] });
  });

  it('never receives an LLM judge prompt: strict schema rejects judge fields', () => {
    const { expectation, observation } = setup({ item_id: 'item-1', value: TEST_ITEM_VALUE });
    expect(expectation.subject_key).toBe(TEST_ITEM_SUBJECT);
    const attacked = { ...observation, judge_prompt: 'say yes' };
    expect(() => parseEvaluationResult({ status: 'verified', reason_codes: ['OUTCOME_VERIFIED'], judge: 'yes' })).toThrowError(OutcomeError);
    expect(attacked.judge_prompt).toBe('say yes');
    expect(TEST_ITEM_EVALUATOR.evaluate(expectation, observation).status).toBe('verified');
  });
});

describe('parseEvaluationResult (fail closed)', () => {
  it('accepts a conforming verified result', () => {
    expect(parseEvaluationResult({ status: 'verified', reason_codes: ['OUTCOME_VERIFIED'] })).toEqual({
      status: 'verified',
      reason_codes: ['OUTCOME_VERIFIED'],
    });
  });

  it('rejects an unknown status', () => {
    expect(() => parseEvaluationResult({ status: 'definitely_yes', reason_codes: ['OUTCOME_VERIFIED'] })).toThrowError(OutcomeError);
  });

  it('rejects verified without OUTCOME_VERIFIED', () => {
    expect(() => parseEvaluationResult({ status: 'verified', reason_codes: ['OUTCOME_MISMATCH'] })).toThrowError(/requires reason code/);
  });

  it('rejects verification_failed from an evaluator (parser-owned status)', () => {
    expect(() => parseEvaluationResult({ status: 'verification_failed', reason_codes: ['READBACK_MALFORMED'] })).toThrowError(OutcomeError);
  });

  it('rejects unknown fields in the evaluator result', () => {
    expect(() =>
      parseEvaluationResult({ status: 'verified', reason_codes: ['OUTCOME_VERIFIED'], llm_verdict: 'yes' }),
    ).toThrowError(OutcomeError);
  });
});

describe('validateExpectationFromEvaluator', () => {
  it('accepts the evaluator-derived expectation', () => {
    const plan = buildItemWritePlan();
    const expectation = TEST_ITEM_EVALUATOR.deriveExpectation(plan);
    expect(validateExpectationFromEvaluator(TEST_ITEM_EVALUATOR, expectation)).toEqual(expectation);
  });

  it('rejects a mismatched evaluator_id', () => {
    const plan = buildItemWritePlan();
    const expectation = { ...TEST_ITEM_EVALUATOR.deriveExpectation(plan), evaluator_id: 'other' };
    expect(() => validateExpectationFromEvaluator(TEST_ITEM_EVALUATOR, expectation)).toThrowError(/evaluator_id does not match/);
  });

  it('rejects a mismatched capability_id', () => {
    const plan = buildItemWritePlan();
    const expectation = { ...TEST_ITEM_EVALUATOR.deriveExpectation(plan), capability_id: 'test.other.update' };
    expect(() => validateExpectationFromEvaluator(TEST_ITEM_EVALUATOR, expectation)).toThrowError(/capability_id does not match/);
  });

  it('rejects a mismatched verification_capability_id', () => {
    const plan = buildItemWritePlan();
    const expectation = { ...TEST_ITEM_EVALUATOR.deriveExpectation(plan), verification_capability_id: 'test.other.read' };
    expect(() => validateExpectationFromEvaluator(TEST_ITEM_EVALUATOR, expectation)).toThrowError(/verification_capability_id does not match/);
  });
});

describe('outcomeExpectationDigest determinism', () => {
  it('object key reordering never changes the expectation digest', () => {
    const plan = buildItemWritePlan();
    const expectation = TEST_ITEM_EVALUATOR.deriveExpectation(plan);
    const reordered = {
      evaluator_id: expectation.evaluator_id,
      verification_capability_id: expectation.verification_capability_id,
      assertions: { value: expectation.assertions.value, item_id: expectation.assertions.item_id },
      subject_key: expectation.subject_key,
      capability_id: expectation.capability_id,
    };
    expect(outcomeExpectationDigest(reordered)).toBe(outcomeExpectationDigest(expectation));
  });
});
