/**
 * Goal24 Checkpoint 8 (Lane A) - deterministic fake outcome fixtures.
 *
 * Synthetic test.item.update / test.item.read / test.item.restore capability
 * set, trusted execution receipts (source: native_broker), structured
 * read-back observations and a deterministic structured item evaluator.
 *
 * No process execution, no network, no LLM judge. Randomness exists only in
 * server-generated outcome/attempt ids (randomUUID by design; assertions are
 * pattern-based).
 */

import { randomUUID } from 'node:crypto';
import {
  CapabilityDefinitionSchema,
  type CapabilityDefinition,
} from '../../src/capabilities/contracts.js';
import type { JsonObject } from '../../src/contracts/json-safe.js';
import {
  ApprovalReferenceSchema,
  ExecutionPlanSchema,
  type ExecutionPlan,
} from '../../src/execution/contracts.js';
import { canonicalJson } from '../../src/evidence/model.js';
import {
  observationPayloadDigest,
  recomputeReceiptDigest,
  sha256Hex,
  type OutcomeEvaluatorV1,
  type ReadbackObservationEnvelope,
  type TrustedExecutionReceipt,
  type ExecutionEffectState,
  type ParserStatus,
} from '../../src/outcome/index.js';
import { bareApprovalReference } from './fake-approval.js';

export const TEST_OUTCOME_NOW = new Date('2026-08-14T01:00:00.000Z');

export const TEST_ITEM_ID = 'item-1';
export const TEST_ITEM_SUBJECT = `test:item:${TEST_ITEM_ID}`;
export const TEST_ITEM_VALUE = 'new-value';
export const TEST_ITEM_OLD_VALUE = 'old-value';

export const TEST_ITEM_READ_CAPABILITY: CapabilityDefinition = CapabilityDefinitionSchema.parse({
  id: 'test.item.read',
  version: '1.0.0',
  description: 'Synthetic item read capability (trusted read-back source for CP8 tests).',
  input_schema: { type: 'object', additionalProperties: false, properties: { item_id: { type: 'string' } }, required: [] },
  required_authority: 'L0',
  risk_level: 'low',
  reversible: false,
  side_effect_class: 'read_only',
  required_evidence: [],
});

export const TEST_ITEM_RESTORE_CAPABILITY: CapabilityDefinition = CapabilityDefinitionSchema.parse({
  id: 'test.item.restore',
  version: '1.0.0',
  description: 'Synthetic item restore capability referenced by the synthetic write (never executed in CP8).',
  input_schema: { type: 'object', additionalProperties: false, properties: { item_id: { type: 'string' } }, required: [] },
  required_authority: 'L0',
  risk_level: 'low',
  reversible: false,
  side_effect_class: 'read_only',
  required_evidence: [],
});

export const TEST_ITEM_UPDATE_CAPABILITY: CapabilityDefinition = CapabilityDefinitionSchema.parse({
  id: 'test.item.update',
  version: '1.0.0',
  description: 'Synthetic reversible item write capability (CP8 test-only; no production write).',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: { item_id: { type: 'string' }, value: { type: 'string' } },
    required: ['item_id', 'value'],
  },
  required_authority: 'L2',
  risk_level: 'medium',
  reversible: true,
  side_effect_class: 'reversible_write',
  required_evidence: [],
  verification_capability: 'test.item.read',
  rollback_capability: 'test.item.restore',
});

export const TEST_ITEM_CAPABILITIES: readonly CapabilityDefinition[] = [
  TEST_ITEM_READ_CAPABILITY,
  TEST_ITEM_RESTORE_CAPABILITY,
  TEST_ITEM_UPDATE_CAPABILITY,
];

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export interface BuildItemWritePlanOptions {
  planId?: string;
  itemId?: string;
  value?: string;
  state?: ExecutionPlan['state'];
  createdAt?: Date;
  rollbackPlan?: boolean;
}

export function buildItemWritePlan(options: BuildItemWritePlanOptions = {}): ExecutionPlan {
  const planId = options.planId ?? `plan-write-${randomUUID().slice(0, 8)}`;
  const itemId = options.itemId ?? TEST_ITEM_ID;
  const value = options.value ?? TEST_ITEM_VALUE;
  const createdAt = options.createdAt ?? TEST_OUTCOME_NOW;
  return ExecutionPlanSchema.parse({
    plan_id: planId,
    decision_id: `decision-${randomUUID().slice(0, 8)}`,
    capability_id: 'test.item.update',
    capability_version: '1.0.0',
    adapter_id: 'test-item-adapter',
    normalized_inputs: { item_id: itemId, value },
    required_approval: true,
    approval: ApprovalReferenceSchema.parse(bareApprovalReference(planId, 'goal24-approval-policy-v1')),
    risk_snapshot: {
      risk_level: 'medium',
      reversible: true,
      side_effect_class: 'reversible_write',
      required_authority: 'L2',
      capability_version: '1.0.0',
    },
    evidence_coverage_snapshot: { entries: [] },
    timeout_ms: 5_000,
    verification_plan: {
      verification_capability_id: 'test.item.read',
      verification_inputs: { item_id: itemId },
    },
    rollback_plan: options.rollbackPlan === false
      ? null
      : {
          rollback_capability_id: 'test.item.restore',
          rollback_inputs: { item_id: itemId },
        },
    state: options.state ?? 'executing',
    created_at: createdAt.toISOString(),
    expires_at: new Date(createdAt.getTime() + 15 * 60_000).toISOString(),
  });
}

export function buildItemReadPlan(options: { planId?: string; itemId?: string; createdAt?: Date } = {}): ExecutionPlan {
  const planId = options.planId ?? `plan-read-${randomUUID().slice(0, 8)}`;
  const createdAt = options.createdAt ?? TEST_OUTCOME_NOW;
  return ExecutionPlanSchema.parse({
    plan_id: planId,
    decision_id: `decision-${randomUUID().slice(0, 8)}`,
    capability_id: 'test.item.read',
    capability_version: '1.0.0',
    adapter_id: 'test-item-adapter',
    normalized_inputs: { item_id: options.itemId ?? TEST_ITEM_ID },
    required_approval: false,
    approval: null,
    risk_snapshot: {
      risk_level: 'low',
      reversible: false,
      side_effect_class: 'read_only',
      required_authority: 'L0',
      capability_version: '1.0.0',
    },
    evidence_coverage_snapshot: { entries: [] },
    timeout_ms: 5_000,
    verification_plan: null,
    rollback_plan: null,
    state: 'executing',
    created_at: createdAt.toISOString(),
    expires_at: new Date(createdAt.getTime() + 15 * 60_000).toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Trusted execution receipts
// ---------------------------------------------------------------------------

export interface BuildReceiptOptions {
  receiptId?: string;
  plan: ExecutionPlan;
  executionState?: ExecutionEffectState;
  exitCode?: number;
  timedOut?: boolean;
  cancelled?: boolean;
  tamperDigest?: boolean;
}

export function buildReceipt(options: BuildReceiptOptions): TrustedExecutionReceipt {
  const receiptId = options.receiptId ?? `receipt-${randomUUID().slice(0, 8)}`;
  const state = options.executionState ?? 'process_succeeded';
  const spawnStartedAt = new Date(TEST_OUTCOME_NOW.getTime() + 1_000).toISOString();
  const finishedAt = new Date(TEST_OUTCOME_NOW.getTime() + 2_000).toISOString();
  const timedOut = options.timedOut ?? state === 'timed_out';
  const cancelled = options.cancelled ?? state === 'cancelled';
  const exitCode =
    state === 'process_succeeded'
      ? (options.exitCode ?? 0)
      : state === 'process_failed'
        ? (options.exitCode ?? 1)
        : undefined;
  const receipt: Record<string, unknown> = {
    receipt_id: receiptId,
    plan_id: options.plan.plan_id,
    capability_id: options.plan.capability_id,
    capability_version: options.plan.capability_version,
    adapter_id: options.plan.adapter_id,
    execution_state: state,
    timed_out: timedOut,
    cancelled,
    receipt_digest: '0'.repeat(64),
    source: 'native_broker',
  };
  if (state !== 'not_started') {
    receipt.spawn_started_at = spawnStartedAt;
    receipt.finished_at = finishedAt;
  }
  if (exitCode !== undefined) {
    receipt.exit_code = exitCode;
  }
  const content: Record<string, unknown> = { ...receipt };
  delete content.receipt_digest;
  receipt.receipt_digest = sha256Hex(canonicalJson(content));
  if (options.tamperDigest) {
    receipt.receipt_digest = sha256Hex(canonicalJson({ tampered: true }));
  }
  return receipt as unknown as TrustedExecutionReceipt;
}


// ---------------------------------------------------------------------------
// Structured read-back observations
// ---------------------------------------------------------------------------

export interface BuildObservationOptions {
  observationId?: string;
  attemptId: string;
  plan: ExecutionPlan;
  receiptId: string;
  payload?: JsonObject;
  subjectKey?: string;
  observedAt?: Date;
  parserStatus?: ParserStatus;
  truncated?: boolean;
  verificationLevel?: 'none' | 'asserted' | 'verified';
  verificationCapabilityId?: string;
  originPlanId?: string;
  originReceiptId?: string;
  tamperPayloadDigest?: boolean;
}

export function buildObservation(options: BuildObservationOptions): ReadbackObservationEnvelope {
  const payload = options.payload ?? { item_id: TEST_ITEM_ID, value: TEST_ITEM_VALUE };
  const payloadDigest = observationPayloadDigest(payload);
  return {
    observation_id: options.observationId ?? `obs-${randomUUID().slice(0, 8)}`,
    verification_attempt_id: options.attemptId,
    origin_plan_id: options.originPlanId ?? options.plan.plan_id,
    origin_execution_receipt_id: options.originReceiptId ?? options.receiptId,
    verification_capability_id: options.verificationCapabilityId ?? 'test.item.read',
    subject_key: options.subjectKey ?? TEST_ITEM_SUBJECT,
    observed_at: (options.observedAt ?? new Date(TEST_OUTCOME_NOW.getTime() + 3_000)).toISOString(),
    verification_source: 'synthetic_test',
    verification_level: options.verificationLevel ?? 'verified',
    payload,
    payload_digest: options.tamperPayloadDigest ? sha256Hex('tampered') : payloadDigest,
    truncated: options.truncated ?? false,
    parser_status: options.parserStatus ?? 'parsed',
  };
}

// ---------------------------------------------------------------------------
// Deterministic structured item evaluator
// ---------------------------------------------------------------------------

export const TEST_ITEM_EVALUATOR: OutcomeEvaluatorV1 = {
  metadata: {
    evaluator_id: 'test-item-update-evaluator',
    capability_id: 'test.item.update',
    verification_capability_id: 'test.item.read',
    version: '1.0.0',
  },
  deriveExpectation(plan) {
    const itemId = plan.normalized_inputs.item_id;
    const value = plan.normalized_inputs.value;
    return {
      evaluator_id: 'test-item-update-evaluator',
      capability_id: 'test.item.update',
      verification_capability_id: 'test.item.read',
      subject_key: `test:item:${itemId}`,
      assertions: { item_id: itemId, value },
    };
  },
  evaluate(expectation, observation) {
    const payload = observation.payload;
    if (typeof payload.item_id !== 'string' || typeof payload.value !== 'string') {
      return { status: 'inconclusive', reason_codes: ['OUTCOME_INCONCLUSIVE'] };
    }
    if (payload.item_id !== expectation.assertions.item_id) {
      return { status: 'mismatch', reason_codes: ['OUTCOME_MISMATCH'] };
    }
    if (payload.value !== expectation.assertions.value) {
      return { status: 'mismatch', reason_codes: ['OUTCOME_MISMATCH'] };
    }
    return { status: 'verified', reason_codes: ['OUTCOME_VERIFIED'] };
  },
};

export function fixedClock(start: Date = TEST_OUTCOME_NOW): () => Date {
  return () => new Date(start.getTime());
}

export function makeReceiptResolver(
  receipts: readonly TrustedExecutionReceipt[],
): (receiptId: string) => TrustedExecutionReceipt | null {
  const map = new Map(receipts.map((receipt) => [receipt.receipt_id, receipt]));
  return (receiptId) => map.get(receiptId) ?? null;
}

export function makeObservationResolver(
  observations: readonly ReadbackObservationEnvelope[],
): (observationId: string) => ReadbackObservationEnvelope | null {
  const map = new Map(observations.map((observation) => [observation.observation_id, observation]));
  return (observationId) => map.get(observationId) ?? null;
}
