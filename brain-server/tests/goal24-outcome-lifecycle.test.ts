/**
 * Goal24 Checkpoint 8 (Lane A) - execution vs outcome separation and the
 * trusted verification lifecycle.
 *
 * exit_code=0 / process_succeeded can NEVER produce a verified outcome.
 * Writes stay pending until a trusted read-back observation verifies the
 * post-state; ambiguous execution (failed/timeout/cancel/crash after spawn)
 * also requires read-back. Binding, parser, truncation, retry budget,
 * revisit and rollback-candidate semantics are all exercised fail-closed.
 */

import { describe, expect, it } from 'vitest';
import {
  InMemoryOutcomeStore,
  OutcomeError,
  OutcomeEvaluatorRegistry,
  OutcomeService,
  assertExpectationMatchesRecord,
  deriveRevisitRequired,
  deriveRollbackCandidate,
  initialVerificationStatus,
  nextVerificationStatus,
  sha256Hex,
  type OutcomeRecord,
  type ReadbackObservationEnvelope,
  type TrustedExecutionReceipt,
  type VerificationStatus,
} from '../src/outcome/index.js';
import { canonicalJson } from '../src/evidence/model.js';
import type { ExecutionPlan } from '../src/execution/contracts.js';
import {
  TEST_ITEM_EVALUATOR,
  TEST_ITEM_OLD_VALUE,
  TEST_ITEM_VALUE,
  TEST_OUTCOME_NOW,
  buildItemReadPlan,
  buildItemWritePlan,
  buildObservation,
  buildReceipt,
  fixedClock,
  makeObservationResolver,
  makeReceiptResolver,
} from './helpers/fake-outcome.js';

interface ServiceFixture {
  service: OutcomeService;
  store: InMemoryOutcomeStore;
  receipts: TrustedExecutionReceipt[];
  observations: ReadbackObservationEnvelope[];
  plan: ExecutionPlan;
  receipt: TrustedExecutionReceipt;
}

function registryWithItemEvaluator(): OutcomeEvaluatorRegistry {
  const registry = new OutcomeEvaluatorRegistry();
  registry.register(TEST_ITEM_EVALUATOR);
  return registry;
}

function setupService(options: { maxAttempts?: number; clockIso?: string } = {}): ServiceFixture {
  const plan = buildItemWritePlan();
  const receipt = buildReceipt({ plan });
  const clockIso = options.clockIso ?? TEST_OUTCOME_NOW.toISOString();
  const store = new InMemoryOutcomeStore();
  const observations: ReadbackObservationEnvelope[] = [];
  const service = new OutcomeService({
    receiptResolver: makeReceiptResolver([receipt]),
    // The resolver consults the mutable array so tests can register
    // observations after the service was constructed.
    observationResolver: (observationId) =>
      observations.find((observation) => observation.observation_id === observationId) ?? null,
    evaluatorRegistry: registryWithItemEvaluator(),
    store,
    clock: fixedClock(new Date(clockIso)),
    maxVerificationAttempts: options.maxAttempts ?? 3,
  });
  return { service, store, receipts: [receipt], observations, plan, receipt };
}

function serviceWith(overrides: {
  fixture: ServiceFixture;
  receipts?: TrustedExecutionReceipt[];
  observations?: ReadbackObservationEnvelope[];
}): OutcomeService {
  return new OutcomeService({
    receiptResolver: makeReceiptResolver(overrides.receipts ?? overrides.fixture.receipts),
    observationResolver: makeObservationResolver(overrides.observations ?? []),
    evaluatorRegistry: registryWithItemEvaluator(),
    store: overrides.fixture.store,
    clock: fixedClock(),
  });
}

describe('execution success is NOT a verified outcome', () => {
  it('exit0 + no readback -> pending, never verified', async () => {
    const fixture = setupService();
    const receipt = buildReceipt({ plan: fixture.plan, executionState: 'process_succeeded', exitCode: 0 });
    const service = serviceWith({ fixture, receipts: [receipt] });
    const outcome = await service.openOutcome({ plan: fixture.plan, receipt_id: receipt.receipt_id });
    expect(outcome.verification_status).toBe('pending');
    expect(outcome.verification_status).not.toBe('verified');
  });

  it('process_succeeded + write -> pending', async () => {
    const fixture = setupService();
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    expect(outcome.execution_effect_state).toBe('process_succeeded');
    expect(outcome.verification_status).toBe('pending');
  });

  it('process_failed after spawn -> pending (readback required)', async () => {
    const fixture = setupService();
    const receipt = buildReceipt({ plan: fixture.plan, executionState: 'process_failed', exitCode: 1 });
    const service = serviceWith({ fixture, receipts: [receipt] });
    const outcome = await service.openOutcome({ plan: fixture.plan, receipt_id: receipt.receipt_id });
    expect(outcome.execution_effect_state).toBe('process_failed');
    expect(outcome.verification_status).toBe('pending');
  });

  it('timeout after spawn -> pending (readback required)', async () => {
    const fixture = setupService();
    const receipt = buildReceipt({ plan: fixture.plan, executionState: 'timed_out' });
    const service = serviceWith({ fixture, receipts: [receipt] });
    const outcome = await service.openOutcome({ plan: fixture.plan, receipt_id: receipt.receipt_id });
    expect(outcome.verification_status).toBe('pending');
  });

  it('cancel after spawn -> pending (readback required)', async () => {
    const fixture = setupService();
    const receipt = buildReceipt({ plan: fixture.plan, executionState: 'cancelled' });
    const service = serviceWith({ fixture, receipts: [receipt] });
    const outcome = await service.openOutcome({ plan: fixture.plan, receipt_id: receipt.receipt_id });
    expect(outcome.verification_status).toBe('pending');
  });

  it('unknown_after_crash -> pending (readback required)', async () => {
    const fixture = setupService();
    const receipt = buildReceipt({ plan: fixture.plan, executionState: 'unknown_after_crash' });
    const service = serviceWith({ fixture, receipts: [receipt] });
    const outcome = await service.openOutcome({ plan: fixture.plan, receipt_id: receipt.receipt_id });
    expect(outcome.verification_status).toBe('pending');
  });

  it('not_started -> not_required (no external effect)', async () => {
    const fixture = setupService();
    const receipt = buildReceipt({ plan: fixture.plan, executionState: 'not_started' });
    const service = serviceWith({ fixture, receipts: [receipt] });
    const outcome = await service.openOutcome({ plan: fixture.plan, receipt_id: receipt.receipt_id });
    expect(outcome.verification_status).toBe('not_required');
    expect(outcome.revisit_required).toBe(false);
  });

  it('read_only -> not_required even with process_succeeded', async () => {
    const plan = buildItemReadPlan();
    const receipt = buildReceipt({ plan, executionState: 'process_succeeded', exitCode: 0 });
    const fixture = setupService();
    const service = serviceWith({ fixture, receipts: [receipt] });
    const outcome = await service.openOutcome({ plan, receipt_id: receipt.receipt_id });
    expect(outcome.verification_status).toBe('not_required');
    expect(outcome.expected_outcome_digest).toBeUndefined();
  });
});

describe('verification lifecycle via trusted read-back', () => {
  it('exact structured read-back -> verified', async () => {
    const fixture = setupService();
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    const { attempt_id } = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    const observation = buildObservation({
      attemptId: attempt_id,
      plan: fixture.plan,
      receiptId: fixture.receipt.receipt_id,
      payload: { item_id: 'item-1', value: TEST_ITEM_VALUE },
    });
    fixture.observations.push(observation);
    const updated = await fixture.service.completeVerificationAttempt({
      outcome_id: outcome.outcome_id,
      attempt_id,
      observation_id: observation.observation_id,
    });
    expect(updated.verification_status).toBe('verified');
    expect(updated.revisit_required).toBe(false);
    expect(updated.rollback_candidate).toBe(false);
    expect(updated.verification_attempts).toHaveLength(1);
    expect(updated.verification_attempts[0].status).toBe('verified');
    expect(updated.verification_attempts[0].reason_codes).toContain('OUTCOME_VERIFIED');
    expect(updated.latest_observation_digest).toBeDefined();
  });

  it('mismatch attempt keeps the outcome pending while retry budget remains', async () => {
    const fixture = setupService();
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    const { attempt_id } = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    const observation = buildObservation({
      attemptId: attempt_id,
      plan: fixture.plan,
      receiptId: fixture.receipt.receipt_id,
      payload: { item_id: 'item-1', value: TEST_ITEM_OLD_VALUE },
    });
    fixture.observations.push(observation);
    const updated = await fixture.service.completeVerificationAttempt({
      outcome_id: outcome.outcome_id,
      attempt_id,
      observation_id: observation.observation_id,
    });
    expect(updated.verification_status).toBe('pending');
    expect(updated.revisit_required).toBe(false);
    expect(updated.rollback_candidate).toBe(false);
    expect(updated.verification_attempts).toHaveLength(1);
    expect(updated.verification_attempts[0].status).toBe('mismatch');
  });

  it('eventual consistency: mismatch -> retry -> verified', async () => {
    const fixture = setupService();
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    const first = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    const bad = buildObservation({ attemptId: first.attempt_id, plan: fixture.plan, receiptId: fixture.receipt.receipt_id, payload: { item_id: 'item-1', value: TEST_ITEM_OLD_VALUE } });
    fixture.observations.push(bad);
    const afterMismatch = await fixture.service.completeVerificationAttempt({ outcome_id: outcome.outcome_id, attempt_id: first.attempt_id, observation_id: bad.observation_id });
    expect(afterMismatch.verification_status).toBe('pending');

    const second = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    const good = buildObservation({ attemptId: second.attempt_id, plan: fixture.plan, receiptId: fixture.receipt.receipt_id, payload: { item_id: 'item-1', value: TEST_ITEM_VALUE } });
    fixture.observations.push(good);
    const final = await fixture.service.completeVerificationAttempt({ outcome_id: outcome.outcome_id, attempt_id: second.attempt_id, observation_id: good.observation_id });
    expect(final.verification_status).toBe('verified');
    expect(final.verification_attempts).toHaveLength(2);
  });

  it('retry is bounded: exhausted mismatch attempts finalize as mismatch', async () => {
    const fixture = setupService({ maxAttempts: 2 });
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    for (let index = 0; index < 2; index += 1) {
      const { attempt_id } = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
      const observation = buildObservation({ attemptId: attempt_id, plan: fixture.plan, receiptId: fixture.receipt.receipt_id, payload: { item_id: 'item-1', value: TEST_ITEM_OLD_VALUE } });
      fixture.observations.push(observation);
      const updated = await fixture.service.completeVerificationAttempt({ outcome_id: outcome.outcome_id, attempt_id, observation_id: observation.observation_id });
      if (index === 0) {
        expect(updated.verification_status).toBe('pending');
      } else {
        expect(updated.verification_status).toBe('mismatch');
        expect(updated.revisit_required).toBe(true);
        expect(updated.rollback_candidate).toBe(true); // mismatch + rollback_plan + reversible
      }
    }
    await expect(fixture.service.beginVerificationAttempt(outcome.outcome_id)).rejects.toThrowError(/exhausted/);
  });

  it('inconclusive observations retry then finalize inconclusive (never guessed success)', async () => {
    const fixture = setupService({ maxAttempts: 1 });
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    const { attempt_id } = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    const observation = buildObservation({ attemptId: attempt_id, plan: fixture.plan, receiptId: fixture.receipt.receipt_id, payload: { item_id: 'item-1' } });
    fixture.observations.push(observation);
    const updated = await fixture.service.completeVerificationAttempt({ outcome_id: outcome.outcome_id, attempt_id, observation_id: observation.observation_id });
    expect(updated.verification_status).toBe('inconclusive');
    expect(updated.revisit_required).toBe(true);
    expect(updated.verification_attempts[0].status).toBe('inconclusive');
  });

  it('malformed read-back -> verification_failed before the evaluator', async () => {
    const fixture = setupService();
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    const { attempt_id } = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    const observation = buildObservation({ attemptId: attempt_id, plan: fixture.plan, receiptId: fixture.receipt.receipt_id, parserStatus: 'malformed' });
    fixture.observations.push(observation);
    const updated = await fixture.service.completeVerificationAttempt({ outcome_id: outcome.outcome_id, attempt_id, observation_id: observation.observation_id });
    expect(updated.verification_status).toBe('pending'); // retry budget remains
    expect(updated.verification_attempts[0].status).toBe('verification_failed');
    expect(updated.verification_attempts[0].reason_codes).toContain('READBACK_MALFORMED');
  });

  it('truncated observation -> verification_failed (fail closed)', async () => {
    const fixture = setupService({ maxAttempts: 1 });
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    const { attempt_id } = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    const observation = buildObservation({ attemptId: attempt_id, plan: fixture.plan, receiptId: fixture.receipt.receipt_id, truncated: true });
    fixture.observations.push(observation);
    const updated = await fixture.service.completeVerificationAttempt({ outcome_id: outcome.outcome_id, attempt_id, observation_id: observation.observation_id });
    expect(updated.verification_status).toBe('verification_failed');
    expect(updated.verification_attempts[0].reason_codes).toContain('READBACK_TRUNCATED');
  });

  it('unsupported parser status -> verification_failed', async () => {
    const fixture = setupService({ maxAttempts: 1 });
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    const { attempt_id } = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    const observation = buildObservation({ attemptId: attempt_id, plan: fixture.plan, receiptId: fixture.receipt.receipt_id, parserStatus: 'unsupported' });
    fixture.observations.push(observation);
    const updated = await fixture.service.completeVerificationAttempt({ outcome_id: outcome.outcome_id, attempt_id, observation_id: observation.observation_id });
    expect(updated.verification_status).toBe('verification_failed');
    expect(updated.verification_attempts[0].reason_codes).toContain('READBACK_UNSUPPORTED');
  });

  it('verification_failed keeps retrying until the budget is exhausted', async () => {
    const fixture = setupService({ maxAttempts: 2 });
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    for (let index = 0; index < 2; index += 1) {
      const { attempt_id } = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
      const observation = buildObservation({ attemptId: attempt_id, plan: fixture.plan, receiptId: fixture.receipt.receipt_id, parserStatus: 'malformed' });
      fixture.observations.push(observation);
      const updated = await fixture.service.completeVerificationAttempt({ outcome_id: outcome.outcome_id, attempt_id, observation_id: observation.observation_id });
      if (index === 0) expect(updated.verification_status).toBe('pending');
      else {
        expect(updated.verification_status).toBe('verification_failed');
        expect(updated.revisit_required).toBe(true);
      }
    }
  });

  it('pending is awaiting verification, not a revisit failure', () => {
    expect(deriveRevisitRequired('pending')).toBe(false);
  });
});

describe('binding rejections (fail closed)', () => {
  it('subject mismatch -> OUTCOME_SUBJECT_MISMATCH', async () => {
    const fixture = setupService();
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    const { attempt_id } = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    const observation = buildObservation({ attemptId: attempt_id, plan: fixture.plan, receiptId: fixture.receipt.receipt_id, subjectKey: 'test:item:other' });
    fixture.observations.push(observation);
    await expect(
      fixture.service.completeVerificationAttempt({ outcome_id: outcome.outcome_id, attempt_id, observation_id: observation.observation_id }),
    ).rejects.toThrowError(/subject_key does not match/);
  });

  it('origin plan mismatch -> OUTCOME_PLAN_MISMATCH', async () => {
    const fixture = setupService();
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    const { attempt_id } = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    const observation = buildObservation({ attemptId: attempt_id, plan: fixture.plan, receiptId: fixture.receipt.receipt_id, originPlanId: 'plan-write-other' });
    fixture.observations.push(observation);
    await expect(
      fixture.service.completeVerificationAttempt({ outcome_id: outcome.outcome_id, attempt_id, observation_id: observation.observation_id }),
    ).rejects.toThrowError(/origin_plan_id does not match/);
  });

  it('origin receipt mismatch -> OUTCOME_RECEIPT_MISMATCH', async () => {
    const fixture = setupService();
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    const { attempt_id } = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    const observation = buildObservation({ attemptId: attempt_id, plan: fixture.plan, receiptId: fixture.receipt.receipt_id, originReceiptId: 'receipt-other' });
    fixture.observations.push(observation);
    await expect(
      fixture.service.completeVerificationAttempt({ outcome_id: outcome.outcome_id, attempt_id, observation_id: observation.observation_id }),
    ).rejects.toThrowError(/origin_execution_receipt_id does not match/);
  });

  it('verification capability mismatch -> OUTCOME_VERIFICATION_CAPABILITY_MISMATCH', async () => {
    const fixture = setupService();
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    const { attempt_id } = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    const observation = buildObservation({ attemptId: attempt_id, plan: fixture.plan, receiptId: fixture.receipt.receipt_id, verificationCapabilityId: 'test.other.read' });
    fixture.observations.push(observation);
    await expect(
      fixture.service.completeVerificationAttempt({ outcome_id: outcome.outcome_id, attempt_id, observation_id: observation.observation_id }),
    ).rejects.toThrowError(/verification_capability_id does not match/);
  });

  it('attempt id mismatch -> OUTCOME_ATTEMPT_MISMATCH', async () => {
    const fixture = setupService();
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    const observation = buildObservation({ attemptId: 'att-other-1', plan: fixture.plan, receiptId: fixture.receipt.receipt_id });
    fixture.observations.push(observation);
    await expect(
      fixture.service.completeVerificationAttempt({ outcome_id: outcome.outcome_id, attempt_id: 'att-other-1', observation_id: observation.observation_id }),
    ).rejects.toThrowError(/not the in-flight attempt/);
  });

  it('payload digest mismatch -> OUTCOME_OBSERVATION_INVALID', async () => {
    const fixture = setupService();
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    const { attempt_id } = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    const observation = buildObservation({ attemptId: attempt_id, plan: fixture.plan, receiptId: fixture.receipt.receipt_id, tamperPayloadDigest: true });
    fixture.observations.push(observation);
    await expect(
      fixture.service.completeVerificationAttempt({ outcome_id: outcome.outcome_id, attempt_id, observation_id: observation.observation_id }),
    ).rejects.toThrowError(/payload_digest does not match/);
  });
});

describe('trusted resolver authority boundaries', () => {
  it('unknown receipt id -> OUTCOME_RECEIPT_UNAVAILABLE', async () => {
    const fixture = setupService();
    await expect(fixture.service.openOutcome({ plan: fixture.plan, receipt_id: 'receipt-unknown' })).rejects.toThrowError(/no trusted receipt/);
  });

  it('tampered receipt digest -> OUTCOME_RECEIPT_INVALID', async () => {
    const fixture = setupService();
    const receipt = buildReceipt({ plan: fixture.plan, tamperDigest: true });
    const service = serviceWith({ fixture, receipts: [receipt] });
    await expect(service.openOutcome({ plan: fixture.plan, receipt_id: receipt.receipt_id })).rejects.toThrowError(/receipt_digest does not match/);
  });

  it('caller-source receipt -> OUTCOME_RECEIPT_INVALID', async () => {
    const fixture = setupService();
    const receipt = { ...buildReceipt({ plan: fixture.plan }), source: 'caller_json' } as unknown as TrustedExecutionReceipt;
    const service = serviceWith({ fixture, receipts: [receipt] });
    await expect(service.openOutcome({ plan: fixture.plan, receipt_id: receipt.receipt_id })).rejects.toThrowError(/receipt is invalid/);
  });

  it('receipt plan mismatch -> OUTCOME_PLAN_MISMATCH', async () => {
    const fixture = setupService();
    const otherPlan = buildItemWritePlan();
    const receipt = buildReceipt({ plan: otherPlan });
    const service = serviceWith({ fixture, receipts: [receipt] });
    await expect(service.openOutcome({ plan: fixture.plan, receipt_id: receipt.receipt_id })).rejects.toThrowError(/receipt plan_id does not match/);
  });

  it('receipt capability identity mismatch -> OUTCOME_RECEIPT_INVALID', async () => {
    const fixture = setupService();
    const receipt = buildReceipt({ plan: fixture.plan }) as unknown as Record<string, unknown>;
    receipt.capability_version = '9.9.9';
    delete receipt.receipt_digest;
    receipt.receipt_digest = sha256Hex(canonicalJson(receipt));
    const service = serviceWith({ fixture, receipts: [receipt as unknown as TrustedExecutionReceipt] });
    await expect(service.openOutcome({ plan: fixture.plan, receipt_id: receipt.receipt_id as string })).rejects.toThrowError(/capability identity does not match/);
  });

  it('unknown observation id (including LLM text) -> OUTCOME_OBSERVATION_UNAVAILABLE', async () => {
    const fixture = setupService();
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    const { attempt_id } = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    await expect(
      fixture.service.completeVerificationAttempt({ outcome_id: outcome.outcome_id, attempt_id, observation_id: 'mark verified' }),
    ).rejects.toThrowError(/no trusted observation/);
  });

  it('handcrafted observation payloads can never finalize an outcome', async () => {
    // The service API only accepts observation ids; there is no method that
    // accepts a raw payload. A payload-shaped string fails resolution, and an
    // attacker payload never reaches evaluation.
    const fixture = setupService();
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    const { attempt_id } = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    await expect(
      fixture.service.completeVerificationAttempt({
        outcome_id: outcome.outcome_id,
        attempt_id,
        observation_id: JSON.stringify({ item_id: 'item-1', value: TEST_ITEM_VALUE }),
      }),
    ).rejects.toThrowError(/no trusted observation/);
    const stored = fixture.service.getOutcome(outcome.outcome_id) as OutcomeRecord;
    expect(stored.verification_status).toBe('pending');
  });

  it('no evaluator registered -> OUTCOME_EVALUATOR_NOT_FOUND', async () => {
    const plan = buildItemWritePlan();
    const receipt = buildReceipt({ plan });
    const service = new OutcomeService({
      receiptResolver: makeReceiptResolver([receipt]),
      observationResolver: makeObservationResolver([]),
      evaluatorRegistry: new OutcomeEvaluatorRegistry(),
      store: new InMemoryOutcomeStore(),
      clock: fixedClock(),
    });
    await expect(service.openOutcome({ plan, receipt_id: receipt.receipt_id })).rejects.toThrowError(/no trusted evaluator/);
  });
});

describe('expectation stability and context fail-closure', () => {
  it('expectation digest mismatch -> OUTCOME_EXPECTATION_CHANGED', () => {
    const record = { expected_outcome_digest: 'a'.repeat(64) } as unknown as OutcomeRecord;
    expect(() => assertExpectationMatchesRecord(record, 'b'.repeat(64))).toThrowError(/does not match the outcome record/);
    expect(() => assertExpectationMatchesRecord(record, 'a'.repeat(64))).not.toThrow();
  });

  it('outcome without an expectation digest cannot be verified -> OUTCOME_EXPECTATION_CHANGED', () => {
    const record = {} as unknown as OutcomeRecord;
    expect(() => assertExpectationMatchesRecord(record, 'a'.repeat(64))).toThrowError(/carries no expected_outcome_digest/);
  });

  it('Brain restart invalidates in-flight verification context (fail closed)', async () => {
    const fixture = setupService();
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    const { attempt_id } = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    const observation = buildObservation({ attemptId: attempt_id, plan: fixture.plan, receiptId: fixture.receipt.receipt_id });
    // A new service over the same store has no in-memory plan/expectation context.
    const restarted = new OutcomeService({
      receiptResolver: makeReceiptResolver(fixture.receipts),
      observationResolver: makeObservationResolver([observation]),
      evaluatorRegistry: registryWithItemEvaluator(),
      store: fixture.store,
      clock: fixedClock(),
    });
    await expect(
      restarted.completeVerificationAttempt({ outcome_id: outcome.outcome_id, attempt_id, observation_id: observation.observation_id }),
    ).rejects.toThrowError(/no runtime context/);
  });
});

describe('lifecycle policy helpers', () => {
  it('initialVerificationStatus: writes are never auto-verified', () => {
    expect(initialVerificationStatus('read_only', 'process_succeeded')).toBe('not_required');
    expect(initialVerificationStatus('reversible_write', 'process_succeeded')).toBe('pending');
    expect(initialVerificationStatus('destructive_write', 'process_succeeded')).toBe('pending');
    expect(initialVerificationStatus('external_effect', 'process_succeeded')).toBe('pending');
    expect(initialVerificationStatus('reversible_write', 'not_started')).toBe('not_required');
    expect(initialVerificationStatus('reversible_write', 'spawn_started')).toBe('pending');
  });

  it('nextVerificationStatus: verified is terminal; failures respect the budget', () => {
    expect(nextVerificationStatus({ attemptStatus: 'verified', attemptCount: 1, maxAttempts: 3 })).toBe('verified');
    expect(nextVerificationStatus({ attemptStatus: 'mismatch', attemptCount: 1, maxAttempts: 3 })).toBe('pending');
    expect(nextVerificationStatus({ attemptStatus: 'mismatch', attemptCount: 3, maxAttempts: 3 })).toBe('mismatch');
    expect(nextVerificationStatus({ attemptStatus: 'inconclusive', attemptCount: 3, maxAttempts: 3 })).toBe('inconclusive');
    expect(nextVerificationStatus({ attemptStatus: 'verification_failed', attemptCount: 3, maxAttempts: 3 })).toBe('verification_failed');
  });

  it('revisit signal: only terminal bad states require revisit', () => {
    const expected: Record<VerificationStatus, boolean> = {
      not_required: false,
      pending: false,
      verified: false,
      mismatch: true,
      inconclusive: true,
      verification_failed: true,
    };
    for (const [status, revisit] of Object.entries(expected)) {
      expect(deriveRevisitRequired(status as VerificationStatus)).toBe(revisit);
    }
  });

  it('rollback candidate requires mismatch + rollback plan + reversible', () => {
    expect(deriveRollbackCandidate({ verificationStatus: 'mismatch', hasRollbackPlan: true, reversible: true })).toBe(true);
    expect(deriveRollbackCandidate({ verificationStatus: 'mismatch', hasRollbackPlan: false, reversible: true })).toBe(false);
    expect(deriveRollbackCandidate({ verificationStatus: 'mismatch', hasRollbackPlan: true, reversible: false })).toBe(false);
    expect(deriveRollbackCandidate({ verificationStatus: 'verified', hasRollbackPlan: true, reversible: true })).toBe(false);
    expect(deriveRollbackCandidate({ verificationStatus: 'inconclusive', hasRollbackPlan: true, reversible: true })).toBe(false);
    expect(deriveRollbackCandidate({ verificationStatus: 'pending', hasRollbackPlan: true, reversible: true })).toBe(false);
  });

  it('attempt budget bounds are enforced at construction', () => {
    const options = {
      receiptResolver: () => null,
      observationResolver: () => null,
      evaluatorRegistry: registryWithItemEvaluator(),
      store: new InMemoryOutcomeStore(),
      clock: fixedClock(),
    };
    expect(() => new OutcomeService({ ...options, maxVerificationAttempts: 0 })).toThrowError(/between 1 and 5/);
    expect(() => new OutcomeService({ ...options, maxVerificationAttempts: 6 })).toThrowError(/between 1 and 5/);
  });

  it('begin attempts on terminal / not_required outcomes fail closed', async () => {
    const fixture = setupService();
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    const { attempt_id } = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    const observation = buildObservation({ attemptId: attempt_id, plan: fixture.plan, receiptId: fixture.receipt.receipt_id });
    fixture.observations.push(observation);
    await fixture.service.completeVerificationAttempt({ outcome_id: outcome.outcome_id, attempt_id, observation_id: observation.observation_id });
    await expect(fixture.service.beginVerificationAttempt(outcome.outcome_id)).rejects.toThrowError(/terminal/);

    const readPlan = buildItemReadPlan();
    const readReceipt = buildReceipt({ plan: readPlan });
    const readService = new OutcomeService({
      receiptResolver: makeReceiptResolver([readReceipt]),
      observationResolver: makeObservationResolver([]),
      evaluatorRegistry: registryWithItemEvaluator(),
      store: new InMemoryOutcomeStore(),
      clock: fixedClock(),
    });
    const readOutcome = await readService.openOutcome({ plan: readPlan, receipt_id: readReceipt.receipt_id });
    await expect(readService.beginVerificationAttempt(readOutcome.outcome_id)).rejects.toThrowError(/does not require verification/);
  });

  it('only one in-flight attempt per outcome', async () => {
    const fixture = setupService();
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    await expect(fixture.service.beginVerificationAttempt(outcome.outcome_id)).rejects.toThrowError(/in-flight verification attempt/);
  });

  it('server ids are core-generated and pattern-safe', async () => {
    const fixture = setupService();
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    expect(outcome.outcome_id).toMatch(/^out-[0-9a-f-]{36}$/);
    const { attempt_id } = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    expect(attempt_id).toMatch(/^att-[0-9a-f-]{36}$/);
  });
});

describe('no automatic rollback and no LLM authority', () => {
  it('rollback_candidate is a boolean eligibility flag only; nothing executes', async () => {
    const fixture = setupService({ maxAttempts: 1 });
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    const { attempt_id } = await fixture.service.beginVerificationAttempt(outcome.outcome_id);
    const observation = buildObservation({ attemptId: attempt_id, plan: fixture.plan, receiptId: fixture.receipt.receipt_id, payload: { item_id: 'item-1', value: TEST_ITEM_OLD_VALUE } });
    fixture.observations.push(observation);
    const updated = await fixture.service.completeVerificationAttempt({ outcome_id: outcome.outcome_id, attempt_id, observation_id: observation.observation_id });
    expect(updated.rollback_candidate).toBe(true);
    expect(updated.verification_status).toBe('mismatch');
    // CP8 marks eligibility only: the record carries a boolean, and no
    // rollback execution path exists anywhere in brain-server/src/outcome.
  });

  it('write outcomes bind the plan verification capability and expectation digest', async () => {
    const fixture = setupService();
    const outcome = await fixture.service.openOutcome({ plan: fixture.plan, receipt_id: fixture.receipt.receipt_id });
    expect(outcome.verification_capability_id).toBe('test.item.read');
    expect(outcome.expected_outcome_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.execution_receipt_id).toBe(fixture.receipt.receipt_id);
    expect(outcome.plan_id).toBe(fixture.plan.plan_id);
  });
});
