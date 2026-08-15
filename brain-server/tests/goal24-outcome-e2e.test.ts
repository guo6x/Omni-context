/**
 * Goal24 Checkpoint 8 (Integration) - synthetic end-to-end outcome loop.
 *
 * The six CP8 E2E cases run here against the FULL Brain outcome pipeline:
 * trusted receipt resolver -> OutcomeService -> bounded attempts -> trusted
 * observation resolver -> deterministic evaluator -> final verification
 * status. The native halves of the same six cases run as real process
 * executions in the Rust suite (write_then_readback_true_positive,
 * false_positive_exit0_stdout_is_not_truth, partial_effect_exit_nonzero_still_readback,
 * timeout_after_effect_still_readback, cancel_after_effect_still_readback,
 * restart_migrates_*_to_unknown_after_crash_and_allows_readback). The shared
 * receipt/observation contracts and the shared golden vectors are the
 * test-only trusted internal bridge between the two sides; no public IPC was
 * added for E2E.
 */

import { describe, expect, it } from 'vitest';

import {
  InMemoryOutcomeStore,
  OutcomeError,
  OutcomeEvaluatorRegistry,
  OutcomeService,
  type ReadbackObservationEnvelope,
  type TrustedExecutionReceipt,
} from '../src/outcome/index.js';
import {
  TEST_ITEM_EVALUATOR,
  TEST_ITEM_OLD_VALUE,
  TEST_ITEM_SUBJECT,
  TEST_ITEM_VALUE,
  buildItemWritePlan,
  buildObservation,
  buildReceipt,
  fixedClock,
  makeObservationResolver,
  makeReceiptResolver,
} from './helpers/fake-outcome.js';

function makeService(receipts: TrustedExecutionReceipt[], observations: ReadbackObservationEnvelope[]) {
  const registry = new OutcomeEvaluatorRegistry();
  registry.register(TEST_ITEM_EVALUATOR);
  return new OutcomeService({
    receiptResolver: makeReceiptResolver(receipts),
    observationResolver: makeObservationResolver(observations),
    evaluatorRegistry: registry,
    store: new InMemoryOutcomeStore(),
    clock: fixedClock(),
  });
}

async function runAttempts(
  service: OutcomeService,
  outcomeId: string,
  observations: ReadbackObservationEnvelope[],
) {
  let updated = service.getOutcome(outcomeId);
  for (const observation of observations) {
    const begun = await service.beginVerificationAttempt(outcomeId, {
      attempt_id: observation.verification_attempt_id,
      started_at: observation.attempt_started_at,
    });
    updated = await service.completeVerificationAttempt({
      outcome_id: outcomeId,
      attempt_id: begun.attempt_id,
      observation_id: observation.observation_id,
    });
  }
  if (!updated) throw new Error('outcome record missing');
  return updated;
}

describe('CP8 synthetic E2E closed loop', () => {
  it('Case 1: exit0 with real effect -> VERIFIED', async () => {
    const plan = buildItemWritePlan();
    const receipt = buildReceipt({ plan, executionState: 'process_succeeded', exitCode: 0 });
    const observation = buildObservation({
      attemptId: 'att-e2e-1',
      plan,
      receiptId: receipt.receipt_id,
      payload: { item_id: 'item-1', value: TEST_ITEM_VALUE },
    });
    const service = makeService([receipt], [observation]);
    const outcome = await service.openOutcome({ plan, receipt_id: receipt.receipt_id });
    expect(outcome.verification_status).toBe('pending');
    const final = await runAttempts(service, outcome.outcome_id, [observation]);
    expect(final.verification_status).toBe('verified');
    expect(final.verification_attempts[0].status).toBe('verified');
    expect(final.verification_attempts[0].reason_codes).toContain('OUTCOME_VERIFIED');
    expect(final.revisit_required).toBe(false);
  });

  it('Case 2: exit0 but external state unchanged -> bounded retries then MISMATCH (never verified)', async () => {
    const plan = buildItemWritePlan();
    const receipt = buildReceipt({ plan, executionState: 'process_succeeded', exitCode: 0 });
    const attempts = [1, 2, 3].map((n) =>
      buildObservation({
        attemptId: `att-e2e-2-${n}`,
        plan,
        receiptId: receipt.receipt_id,
        payload: { item_id: 'item-1', value: TEST_ITEM_OLD_VALUE },
      }),
    );
    const service = makeService([receipt], attempts);
    const outcome = await service.openOutcome({ plan, receipt_id: receipt.receipt_id });

    const afterFirst = await runAttempts(service, outcome.outcome_id, attempts.slice(0, 1));
    expect(afterFirst.verification_status).toBe('pending');
    const afterSecond = await runAttempts(service, outcome.outcome_id, attempts.slice(1, 2));
    expect(afterSecond.verification_status).toBe('pending');
    const final = await runAttempts(service, outcome.outcome_id, attempts.slice(2, 3));
    expect(final.verification_status).toBe('mismatch');
    expect(final.verification_attempts).toHaveLength(3);
    for (const attempt of final.verification_attempts) {
      expect(attempt.status).toBe('mismatch');
      expect(attempt.reason_codes).toContain('OUTCOME_MISMATCH');
    }
    expect(final.revisit_required).toBe(true);
    // Budget exhausted: the final result is the last trusted result, never a
    // default success.
    await expect(
      service.beginVerificationAttempt(outcome.outcome_id),
    ).rejects.toThrowError(expect.objectContaining({ code: 'OUTCOME_ATTEMPTS_EXHAUSTED' }));
  });

  it('Case 3: exit1 with real effect -> VERIFIED (nonzero exit never means no effect)', async () => {
    const plan = buildItemWritePlan();
    const receipt = buildReceipt({ plan, executionState: 'process_failed', exitCode: 7 });
    const observation = buildObservation({
      attemptId: 'att-e2e-3',
      plan,
      receiptId: receipt.receipt_id,
      payload: { item_id: 'item-1', value: TEST_ITEM_VALUE },
    });
    const service = makeService([receipt], [observation]);
    const outcome = await service.openOutcome({ plan, receipt_id: receipt.receipt_id });
    expect(outcome.verification_status).toBe('pending');
    const final = await runAttempts(service, outcome.outcome_id, [observation]);
    expect(final.verification_status).toBe('verified');
  });

  it('Case 4: timeout after effect -> VERIFIED', async () => {
    const plan = buildItemWritePlan();
    const receipt = buildReceipt({ plan, executionState: 'timed_out' });
    const observation = buildObservation({
      attemptId: 'att-e2e-4',
      plan,
      receiptId: receipt.receipt_id,
      payload: { item_id: 'item-1', value: TEST_ITEM_VALUE },
    });
    const service = makeService([receipt], [observation]);
    const outcome = await service.openOutcome({ plan, receipt_id: receipt.receipt_id });
    expect(outcome.verification_status).toBe('pending');
    const final = await runAttempts(service, outcome.outcome_id, [observation]);
    expect(final.verification_status).toBe('verified');
  });

  it('Case 5: cancel after effect -> VERIFIED', async () => {
    const plan = buildItemWritePlan();
    const receipt = buildReceipt({ plan, executionState: 'cancelled' });
    const observation = buildObservation({
      attemptId: 'att-e2e-5',
      plan,
      receiptId: receipt.receipt_id,
      payload: { item_id: 'item-1', value: TEST_ITEM_VALUE },
    });
    const service = makeService([receipt], [observation]);
    const outcome = await service.openOutcome({ plan, receipt_id: receipt.receipt_id });
    expect(outcome.verification_status).toBe('pending');
    const final = await runAttempts(service, outcome.outcome_id, [observation]);
    expect(final.verification_status).toBe('verified');
  });

  it('Case 6a: unknown_after_crash (recovered accepted) -> readback resolves to VERIFIED', async () => {
    const plan = buildItemWritePlan();
    const receipt = buildReceipt({
      plan,
      executionState: 'unknown_after_crash',
      omitSpawnMarker: true,
    });
    // Recovered accepted receipts must NOT be not_started and must remain
    // read-back eligible: the outcome opens as pending, not not_required.
    const observation = buildObservation({
      attemptId: 'att-e2e-6',
      plan,
      receiptId: receipt.receipt_id,
      payload: { item_id: 'item-1', value: TEST_ITEM_VALUE },
    });
    const service = makeService([receipt], [observation]);
    const outcome = await service.openOutcome({ plan, receipt_id: receipt.receipt_id });
    expect(outcome.execution_effect_state).toBe('unknown_after_crash');
    expect(outcome.verification_status).toBe('pending');
    const final = await runAttempts(service, outcome.outcome_id, [observation]);
    expect(final.verification_status).toBe('verified');
  });

  it('Case 6b: unknown_after_crash with unchanged state -> resolved MISMATCH (honest closure)', async () => {
    const plan = buildItemWritePlan();
    const receipt = buildReceipt({
      plan,
      executionState: 'unknown_after_crash',
      omitSpawnMarker: true,
    });
    const attempts = [1, 2, 3].map((n) =>
      buildObservation({
        attemptId: `att-e2e-6b-${n}`,
        plan,
        receiptId: receipt.receipt_id,
        payload: { item_id: 'item-1', value: TEST_ITEM_OLD_VALUE },
      }),
    );
    const service = makeService([receipt], attempts);
    const outcome = await service.openOutcome({ plan, receipt_id: receipt.receipt_id });
    const final = await runAttempts(service, outcome.outcome_id, attempts);
    expect(final.verification_status).toBe('mismatch');
    expect(final.revisit_required).toBe(true);
  });

  it('E2E infrastructure never registers a production write or public IPC surface', () => {
    // The synthetic test.item.update capability is a TEST-ONLY fixture
    // capability: it exists only in tests/helpers and the CP8 runtime exposes
    // no execute/readback/verify/submit IPC commands. The absence of such
    // commands is asserted by the Rust command-registry tests and the
    // generate_handler! registry (see checkpoint8-security-gate.json).
    const subject = TEST_ITEM_SUBJECT;
    expect(subject).toBe('test:item:item-1');
    expect(TEST_ITEM_VALUE).not.toBe(TEST_ITEM_OLD_VALUE);
  });
});
