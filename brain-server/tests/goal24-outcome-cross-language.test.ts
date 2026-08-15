/**
 * Goal24 Checkpoint 8 (Integration) - cross-language golden vector tests.
 *
 * Reads the SHARED machine-readable fixtures under
 * docs/goal24/fixtures/cp8-outcome/ and asserts the Brain side produces
 * exactly the verdicts the fixtures declare. The Rust test suite validates
 * the same files from the native side; cross-language mismatch must be 0.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  EXECUTION_EFFECT_STATES,
  InMemoryOutcomeStore,
  OutcomeError,
  OutcomeEvaluatorRegistry,
  OutcomeService,
  ReadbackObservationEnvelopeSchema,
  mapNativeStateToEffectState,
  outcomeExpectationDigest,
  validateObservationEnvelope,
  verificationPlanDigest,
  type ExecutionEffectState,
  type ReadbackObservationEnvelope,
} from '../src/outcome/index.js';
import {
  TEST_ITEM_EVALUATOR,
  TEST_OUTCOME_NOW,
  buildItemReadPlan,
  buildItemWritePlan,
  buildReceipt,
  fixedClock,
  makeObservationResolver,
  makeReceiptResolver,
} from './helpers/fake-outcome.js';

const FIXTURE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'docs',
  'goal24',
  'fixtures',
  'cp8-outcome',
);

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, name), 'utf8')) as Record<string, unknown>;
}

interface StateMappingVector {
  id: string;
  state: string;
  recovered: boolean;
  exit_code: number | null;
  timed_out: boolean;
  cancelled: boolean;
  spawn_started_at_present: boolean;
  expected_effect_state: string | null;
  expected_error: string | null;
}

describe('execution state mapping cross-language vectors', () => {
  const fixture = loadFixture('execution-state-mapping.json');
  const vectors = fixture.vectors as StateMappingVector[];
  expect(vectors.length).toBeGreaterThanOrEqual(20);

  it.each(vectors.map((v) => [v.id, v] as const))('%s', (_id, vector) => {
    const result = mapNativeStateToEffectState({
      state: vector.state as never,
      recovered: vector.recovered,
      exit_code: vector.exit_code ?? undefined,
      timed_out: vector.timed_out,
      cancelled: vector.cancelled,
      spawn_started_at_present: vector.spawn_started_at_present,
    });
    if (vector.expected_effect_state === null) {
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error).toBe(vector.expected_error);
      }
    } else {
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.effect_state).toBe(vector.expected_effect_state);
      }
    }
  });
});

interface ObservationVector {
  id: string;
  category: string;
  envelope: Record<string, unknown>;
  payload_generator?: string | null;
  plan_overrides?: { item_id?: string; value?: string };
  expected_brain_envelope_valid: boolean;
  expected_service_verdict: string;
}

const PLAN_ID = 'plan-cp8-vec-0001';
const RECEIPT_ID = 'rcpt-cp8-vec-0001';
const ATTEMPT_ID = 'att-cp8-vec-0001';
const ATTEMPT_STARTED = '2026-08-14T01:00:00.000Z';

describe('readback observation vectors cross-language', () => {
  const fixture = loadFixture('readback-observation-vectors.json');
  const vectors = fixture.vectors as ObservationVector[];
  expect(vectors.length).toBeGreaterThanOrEqual(30);

  function materialize(vector: ObservationVector): ReadbackObservationEnvelope {
    const envelope = JSON.parse(JSON.stringify(vector.envelope)) as Record<string, unknown>;
    if (vector.payload_generator === 'nan') {
      envelope.payload = { x: Number.NaN };
    }
    return envelope as unknown as ReadbackObservationEnvelope;
  }

  for (const vector of vectors) {
    it(`${vector.id} ${vector.category}`, async () => {
      const envelope = materialize(vector);
      const schemaOk = ReadbackObservationEnvelopeSchema.safeParse(envelope).success;
      expect(schemaOk).toBe(vector.expected_brain_envelope_valid);

      const verdict = vector.expected_service_verdict;
      if (verdict === 'ENVELOPE_REJECTED') {
        expect(() => validateObservationEnvelope(envelope)).toThrow(OutcomeError);
        return;
      }
      if (verdict === 'ENVELOPE_ACCEPTED') {
        expect(() => validateObservationEnvelope(envelope)).not.toThrow();
        return;
      }
      if (verdict === 'SERVICE_OUTCOME_OBSERVATION_INVALID') {
        expect(() => validateObservationEnvelope(envelope)).toThrowError(
          expect.objectContaining({ code: 'OUTCOME_OBSERVATION_INVALID' }),
        );
        return;
      }

      // Full service scenario for binding / freshness / attempt verdicts.
      const plan = buildItemWritePlan({
        planId: PLAN_ID,
        itemId: vector.plan_overrides?.item_id ?? 'item-1',
        value: vector.plan_overrides?.value ?? 'new-value',
      });
      const receipt = buildReceipt({
        receiptId: RECEIPT_ID,
        plan,
        executionState: 'process_succeeded',
      });
      const registry = new OutcomeEvaluatorRegistry();
      registry.register(TEST_ITEM_EVALUATOR);
      const store = new InMemoryOutcomeStore();
      const observations = new Map<string, ReadbackObservationEnvelope>();
      const service = new OutcomeService({
        receiptResolver: makeReceiptResolver([receipt]),
        observationResolver: (observationId) => observations.get(observationId) ?? null,
        evaluatorRegistry: registry,
        store,
        clock: fixedClock(TEST_OUTCOME_NOW),
      });
      const outcome = await service.openOutcome({ plan, receipt_id: receipt.receipt_id });

      const expectServiceError = async (run: () => Promise<unknown>, code: string) => {
        await expect(run()).rejects.toThrowError(
          expect.objectContaining({ code }),
        );
      };

      switch (vector.category) {
        case 'attempt-before-spawn': {
          // The corrupted attempt START time is rejected when the bridge
          // reserves the attempt, before anything spawns.
          const corrupted = materialize(vector);
          await expectServiceError(
            () =>
              service.beginVerificationAttempt(outcome.outcome_id, {
                attempt_id: ATTEMPT_ID,
                started_at: corrupted.attempt_started_at,
              }),
            'OUTCOME_FRESHNESS_INVALID',
          );
          return;
        }
        case 'duplicate-observation': {
          // Cross-outcome reuse: a second outcome consuming an already
          // claimed observation id must be rejected by the store index.
          const otherPlan = buildItemWritePlan({ planId: 'plan-cp8-vec-0002' });
          const otherReceipt = buildReceipt({
            receiptId: 'rcpt-cp8-vec-0002',
            plan: otherPlan,
            executionState: 'process_succeeded',
          });
          const registry2 = new OutcomeEvaluatorRegistry();
          registry2.register(TEST_ITEM_EVALUATOR);
          const service2 = new OutcomeService({
            receiptResolver: makeReceiptResolver([otherReceipt]),
            observationResolver: (observationId) => observations.get(observationId) ?? null,
            evaluatorRegistry: registry2,
            store,
            clock: fixedClock(TEST_OUTCOME_NOW),
          });
          const outcome2 = await service2.openOutcome({
            plan: otherPlan,
            receipt_id: otherReceipt.receipt_id,
          });
          const begun1 = await service.beginVerificationAttempt(outcome.outcome_id);
          const begun2 = await service2.beginVerificationAttempt(outcome2.outcome_id);
          // Attempt 1 consumes observation X (mismatch keeps the outcome pending).
          const firstEnvelope = {
            ...materialize(vector),
            verification_attempt_id: begun1.attempt_id,
            origin_plan_id: plan.plan_id,
            origin_execution_receipt_id: receipt.receipt_id,
            payload: { item_id: 'item-1', value: 'old-value' },
            payload_digest: 'x'.repeat(64),
          } as unknown as ReadbackObservationEnvelope;
          const digest = await import('../src/outcome/digests.js');
          (firstEnvelope as Record<string, unknown>).payload_digest =
            digest.observationPayloadDigest(firstEnvelope.payload);
          observations.set(firstEnvelope.observation_id, firstEnvelope);
          await service.completeVerificationAttempt({
            outcome_id: outcome.outcome_id,
            attempt_id: begun1.attempt_id,
            observation_id: firstEnvelope.observation_id,
          });
          // Attempt 2 tries to reuse the same observation id: binding ids are
          // rewritten to outcome2's context so only the duplicate check can
          // fire.
          const secondEnvelope = {
            ...materialize(vector),
            verification_attempt_id: begun2.attempt_id,
            origin_plan_id: otherPlan.plan_id,
            origin_execution_receipt_id: otherReceipt.receipt_id,
          };
          observations.set(secondEnvelope.observation_id, secondEnvelope);
          await expectServiceError(
            () =>
              service2.completeVerificationAttempt({
                outcome_id: outcome2.outcome_id,
                attempt_id: begun2.attempt_id,
                observation_id: secondEnvelope.observation_id,
              }),
            'OUTCOME_DUPLICATE_OBSERVATION',
          );
          return;
        }
        case 'replay-same-observation': {
          const begun1 = await service.beginVerificationAttempt(outcome.outcome_id);
          const firstEnvelope = {
            ...materialize(vector),
            verification_attempt_id: begun1.attempt_id,
            payload: { item_id: 'item-1', value: 'old-value' },
          };
          const digest = await import('../src/outcome/digests.js');
          (firstEnvelope as Record<string, unknown>).payload_digest =
            digest.observationPayloadDigest(firstEnvelope.payload);
          observations.set(firstEnvelope.observation_id, firstEnvelope);
          await service.completeVerificationAttempt({
            outcome_id: outcome.outcome_id,
            attempt_id: begun1.attempt_id,
            observation_id: firstEnvelope.observation_id,
          });
          const begun2 = await service.beginVerificationAttempt(outcome.outcome_id);
          const secondEnvelope = {
            ...materialize(vector),
            verification_attempt_id: begun2.attempt_id,
          };
          observations.set(secondEnvelope.observation_id, secondEnvelope);
          await expectServiceError(
            () =>
              service.completeVerificationAttempt({
                outcome_id: outcome.outcome_id,
                attempt_id: begun2.attempt_id,
                observation_id: secondEnvelope.observation_id,
              }),
            'OUTCOME_DUPLICATE_OBSERVATION',
          );
          return;
        }
        default: {
          const begun = await service.beginVerificationAttempt(outcome.outcome_id, {
            attempt_id: ATTEMPT_ID,
            started_at: ATTEMPT_STARTED,
          });
          const bound = { ...envelope };
          const observationId = bound.observation_id;
          observations.set(observationId, bound);
          const run = () =>
            service.completeVerificationAttempt({
              outcome_id: outcome.outcome_id,
              attempt_id: ATTEMPT_ID,
              observation_id: observationId,
            });
          if (verdict.startsWith('SERVICE_')) {
            await expectServiceError(run, verdict.replace('SERVICE_', ''));
            return;
          }
          const updated = await run();
          const attempt = updated.verification_attempts[updated.verification_attempts.length - 1];
          if (verdict === 'ATTEMPT_VERIFIED') {
            expect(attempt.status).toBe('verified');
            expect(attempt.reason_codes).toContain('OUTCOME_VERIFIED');
            expect(updated.verification_status).toBe('verified');
          } else if (verdict.startsWith('ATTEMPT_VERIFICATION_FAILED:')) {
            expect(attempt.status).toBe('verification_failed');
            expect(attempt.reason_codes).toContain(
              verdict.replace('ATTEMPT_VERIFICATION_FAILED:', ''),
            );
          }
        }
      }
    });
  }
});

describe('deterministic expectation vectors', () => {
  const fixture = loadFixture('expectation-vectors.json');
  const vectors = fixture.vectors as Array<{
    id: string;
    category: string;
    variation: Record<string, unknown>;
    expected_relation: string;
    expected_verdict: string;
  }>;
  expect(vectors.length).toBeGreaterThanOrEqual(20);

  let baseDigest: string | null = null;
  for (const vector of vectors) {
    it(`${vector.id} ${vector.category}`, async () => {
      const variation = vector.variation;
      if (variation.readOnlyPlan === true) {
        const registry = new OutcomeEvaluatorRegistry();
        registry.register(TEST_ITEM_EVALUATOR);
        const readPlan = buildItemReadPlan({ planId: 'plan-cp8-vec-read' });
        const readReceipt = buildReceipt({ plan: readPlan, executionState: 'process_succeeded' });
        const service = new OutcomeService({
          receiptResolver: makeReceiptResolver([readReceipt]),
          observationResolver: () => null,
          evaluatorRegistry: registry,
          store: new InMemoryOutcomeStore(),
          clock: fixedClock(TEST_OUTCOME_NOW),
        });
        const outcome = await service.openOutcome({
          plan: readPlan,
          receipt_id: readReceipt.receipt_id,
        });
        expect(outcome.verification_status).toBe('not_required');
        expect(outcome.expected_outcome_digest).toBeUndefined();
        expect(vector.expected_verdict).toBe('NOT_REQUIRED');
        return;
      }
      const createdAt =
        variation.createdAtShift !== undefined
          ? new Date(TEST_OUTCOME_NOW.getTime() + (variation.createdAtShift as number))
          : undefined;
      const plan = buildItemWritePlan({
        planId: PLAN_ID,
        itemId: (variation.itemId as string) ?? 'item-1',
        value: (variation.value as string) ?? 'new-value',
        rollbackPlan: (variation.rollbackPlan as boolean | undefined) ?? true,
        ...(createdAt !== undefined ? { createdAt } : {}),
      });
      if (variation.capabilityId !== undefined) {
        plan.capability_id = variation.capabilityId as string;
      }
      if (variation.state !== undefined) {
        plan.state = variation.state as never;
      }
      if (variation.capabilityVersion !== undefined) {
        plan.capability_version = variation.capabilityVersion as string;
      }
      if (variation.timeoutMs !== undefined) {
        plan.timeout_ms = variation.timeoutMs as number;
      }
      if (variation.verificationCapabilityId !== undefined && plan.verification_plan) {
        plan.verification_plan.verification_capability_id = variation.verificationCapabilityId as string;
      }
      if (variation.verificationPlan === null) {
        plan.verification_plan = null;
      }
      if (variation.verificationInputs !== undefined && plan.verification_plan) {
        plan.verification_plan.verification_inputs = variation.verificationInputs as never;
      }
      if (variation.emptyInputs === true) {
        plan.normalized_inputs = {};
      }
      if (variation.missingItemId === true) {
        plan.normalized_inputs = { value: 'new-value' };
      }
      if (variation.valueAsNumber === true) {
        plan.normalized_inputs = { item_id: 'item-1', value: 5 };
      }
      if (variation.nestedInputs === true) {
        plan.normalized_inputs = {
          item_id: 'item-1',
          value: { nested: { z: 1, a: 2 } },
        };
      }
      if (variation.alternateEvaluator === true) {
        const alternate = {
          ...TEST_ITEM_EVALUATOR,
          metadata: { ...TEST_ITEM_EVALUATOR.metadata, evaluator_id: 'alt-evaluator' },
          deriveExpectation(altPlan: typeof plan) {
            return { ...TEST_ITEM_EVALUATOR.deriveExpectation(altPlan), evaluator_id: 'alt-evaluator' };
          },
        };
        expect(outcomeExpectationDigest(alternate.deriveExpectation(plan))).not.toBe(baseDigest);
        return;
      }
      if (variation.reorderInputs === true) {
        // Canonical JSON sorts keys: reversed assertion order must not
        // change the digest.
        const derived = TEST_ITEM_EVALUATOR.deriveExpectation(plan);
        const reversed = {
          ...derived,
          assertions: { value: derived.assertions.value, item_id: derived.assertions.item_id },
        };
        expect(outcomeExpectationDigest(reversed)).toBe(outcomeExpectationDigest(derived));
        return;
      }

      const registry = new OutcomeEvaluatorRegistry();
      registry.register(TEST_ITEM_EVALUATOR);
      const receipt = buildReceipt({ plan, executionState: 'process_succeeded' });
      const store = new InMemoryOutcomeStore();
      const service = new OutcomeService({
        receiptResolver: makeReceiptResolver([receipt]),
        observationResolver: () => null,
        evaluatorRegistry: registry,
        store,
        clock: fixedClock(TEST_OUTCOME_NOW),
      });

      if (vector.expected_verdict.startsWith('REJECT:')) {
        await expect(
          service.openOutcome({ plan, receipt_id: receipt.receipt_id }),
        ).rejects.toThrowError(
          expect.objectContaining({
            code: vector.expected_verdict.replace('REJECT:', ''),
          }),
        );
        return;
      }
      if (vector.expected_verdict === 'RECEIPT_VERIFICATION_PLAN_DIGEST_DIFFERS') {
        const basePlan = buildItemWritePlan({ planId: PLAN_ID });
        expect(verificationPlanDigest(plan)).not.toBe(verificationPlanDigest(basePlan));
        const outcome = await service.openOutcome({ plan, receipt_id: receipt.receipt_id });
        expect(outcome.expected_outcome_digest).toBe(baseDigest);
        return;
      }

      const outcome = await service.openOutcome({ plan, receipt_id: receipt.receipt_id });
      expect(outcome.expected_outcome_digest).toBeDefined();
      const digest = outcome.expected_outcome_digest as string;
      if (vector.expected_relation === 'BASE') {
        baseDigest = digest;
        return;
      }
      if (vector.expected_relation === 'SAME_AS_BASE') {
        expect(digest).toBe(baseDigest);
      } else if (vector.expected_relation === 'DIFFERENT_FROM_BASE') {
        expect(digest).not.toBe(baseDigest);
      } else if (vector.expected_relation === 'DIGEST_STABLE_WITHIN_VECTOR') {
        // The expectation is a pure function of the approved plan; a fresh
        // derivation must reproduce the exact persisted digest.
        expect(outcomeExpectationDigest(TEST_ITEM_EVALUATOR.deriveExpectation(plan))).toBe(digest);
      }
    });
  }
});
