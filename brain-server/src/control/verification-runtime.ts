/**
 * Server-owned D1B-2 verification runtime.
 *
 * This is the only composition point that may hand receipts and read-back
 * observations to OutcomeService.  The public route receives no receipt,
 * observation, expectation or verdict.  Production authorization plans with
 * no native execution receipt remain INCONCLUSIVE (fail closed); the explicit
 * controlled fixture below is used only for non-network gate evidence.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ExecutionPlan } from '../execution/contracts.js';
import type { ControlVerificationResult } from './verification-facade.js';
import type { PlanAuthorizationRecord } from '../approval/contracts.js';
import { JsonObjectSchema, type JsonObject } from '../contracts/json-safe.js';
import {
  InMemoryOutcomeStore,
  OutcomeEvaluatorRegistry,
  OutcomeService,
  observationPayloadDigest,
  normalizedInputsDigest,
  recomputeReceiptDigest,
  sha256Hex,
  verificationPlanDigest,
  type ExecutionEffectState,
  type ReadbackObservationEnvelope,
  type TrustedExecutionReceipt,
  type OutcomeRecord,
} from '../outcome/index.js';
import { GITHUB_ISSUE_CLOSE_EVALUATOR } from '../outcome/evaluators/github-issue-close-evaluator.js';
import { VerificationError } from './verification-facade.js';
import { canonicalJson } from '../evidence/model.js';

/**
 * Exact native receipt envelope accepted by the private loopback bridge.
 * These fields mirror the Rust ReceiptStore record.  The bridge validates the
 * native identity digest before converting the record to the narrower Brain
 * outcome receipt; renderer, MCP and Agent callers never reach this schema.
 */
const NativeReceiptSchema = z.strictObject({
  receipt_id: z.string().trim().min(1).max(200),
  plan_id: z.string().trim().min(8).max(200),
  decision_id: z.string().trim().min(1).max(200),
  source: z.literal('native_broker'),
  capability_id: z.string().trim().min(1).max(200),
  capability_version: z.string().trim().min(1).max(50),
  adapter_id: z.string().trim().min(1).max(200),
  binding_id: z.string().trim().min(1).max(200),
  execution_id: z.string().trim().min(1).max(200).nullable().optional(),
  normalized_inputs_digest: z.string().regex(/^[0-9a-f]{64}$/),
  verification_plan_digest: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
  verification_capability_id: z.string().trim().min(1).max(200).nullable().optional(),
  verification_inputs: JsonObjectSchema.nullable().optional(),
  execution_state: z.enum(['accepted', 'spawn_started', 'completed', 'spawn_failed', 'unknown_after_crash']),
  accepted_at: z.string().datetime({ offset: true }),
  spawn_started_at: z.string().datetime({ offset: true }).nullable().optional(),
  finished_at: z.string().datetime({ offset: true }).nullable().optional(),
  exit_code: z.number().int().min(0).max(4_294_967_295).nullable().optional(),
  timed_out: z.boolean(),
  cancelled: z.boolean(),
  stdout_digest: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
  stderr_digest: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
  output_truncated: z.boolean(),
  output_redacted: z.boolean(),
  resolved_executable_fingerprint: z.string().trim().min(1).max(500).nullable().optional(),
  receipt_digest: z.string().regex(/^[0-9a-f]{64}$/),
  verification_attempts: z.array(z.unknown()).optional(),
});
type NativeReceipt = z.infer<typeof NativeReceiptSchema>;

function nativeReceiptIdentity(receipt: NativeReceipt): Record<string, unknown> {
  return {
    receipt_id: receipt.receipt_id,
    plan_id: receipt.plan_id,
    decision_id: receipt.decision_id,
    capability_id: receipt.capability_id,
    capability_version: receipt.capability_version,
    adapter_id: receipt.adapter_id,
    binding_id: receipt.binding_id,
    normalized_inputs_digest: receipt.normalized_inputs_digest,
    verification_plan_digest: receipt.verification_plan_digest ?? null,
    verification_capability_id: receipt.verification_capability_id ?? null,
    verification_inputs: receipt.verification_inputs ?? null,
    accepted_at: receipt.accepted_at,
    source: receipt.source,
  };
}

function parseNativeReceipt(raw: unknown): NativeReceipt {
  const parsed = NativeReceiptSchema.safeParse(raw);
  if (!parsed.success) {
    throw new VerificationError('NATIVE_RECEIPT_INVALID', 'native receipt failed the strict bridge contract');
  }
  let expected: string;
  try {
    expected = sha256Hex(canonicalJson(nativeReceiptIdentity(parsed.data)));
  } catch {
    throw new VerificationError('NATIVE_RECEIPT_INVALID', 'native receipt identity is not canonical JSON');
  }
  if (expected !== parsed.data.receipt_digest) {
    throw new VerificationError('NATIVE_RECEIPT_INVALID', 'native receipt identity digest mismatch');
  }
  return parsed.data;
}

function mapNativeEffectState(receipt: NativeReceipt): ExecutionEffectState {
  if (receipt.timed_out && receipt.cancelled) throw new VerificationError('NATIVE_RECEIPT_INVALID', 'native receipt has conflicting timeout/cancel flags');
  switch (receipt.execution_state) {
    case 'completed':
      if (receipt.timed_out) return 'timed_out';
      if (receipt.cancelled) return 'cancelled';
      if (receipt.exit_code === null || receipt.exit_code === undefined) throw new VerificationError('NATIVE_RECEIPT_INVALID', 'completed native receipt has no exit code');
      return receipt.exit_code === 0 ? 'process_succeeded' : 'process_failed';
    case 'spawn_failed':
      if (receipt.spawn_started_at || receipt.exit_code !== null && receipt.exit_code !== undefined || receipt.timed_out || receipt.cancelled) throw new VerificationError('NATIVE_RECEIPT_INVALID', 'spawn_failed native receipt carries lifecycle fields');
      return 'not_started';
    case 'unknown_after_crash':
      if (receipt.exit_code !== null && receipt.exit_code !== undefined || receipt.timed_out || receipt.cancelled) throw new VerificationError('NATIVE_RECEIPT_INVALID', 'unknown native receipt carries completion fields');
      return 'unknown_after_crash';
    case 'accepted':
    case 'spawn_started':
      throw new VerificationError('NATIVE_RECEIPT_IN_FLIGHT', 'native receipt is not a completed execution');
  }
}

function materializeTrustedReceipt(native: NativeReceipt): TrustedExecutionReceipt {
  const effectState = mapNativeEffectState(native);
  const candidate = {
    receipt_id: native.receipt_id,
    plan_id: native.plan_id,
    decision_id: native.decision_id,
    capability_id: native.capability_id,
    capability_version: native.capability_version,
    adapter_id: native.adapter_id,
    normalized_inputs_digest: native.normalized_inputs_digest,
    ...(native.verification_plan_digest ? { verification_plan_digest: native.verification_plan_digest } : {}),
    execution_state: effectState,
    accepted_at: native.accepted_at,
    ...(native.spawn_started_at ? { spawn_started_at: native.spawn_started_at } : {}),
    ...(native.finished_at ? { finished_at: native.finished_at } : {}),
    ...(native.exit_code !== null && native.exit_code !== undefined ? { exit_code: native.exit_code } : {}),
    timed_out: native.timed_out,
    cancelled: native.cancelled,
    source: 'native_broker' as const,
    receipt_digest: '0'.repeat(64),
  };
  const digest = recomputeReceiptDigest(candidate as TrustedExecutionReceipt);
  return { ...candidate, receipt_digest: digest } as TrustedExecutionReceipt;
}

interface RegisteredCase {
  plan: ExecutionPlan;
  receipt: TrustedExecutionReceipt;
  observation: ReadbackObservationEnvelope | null;
  outcomeId?: string;
}

/**
 * Narrow server-internal source for a revision.  It is intentionally not a
 * public control response and carries only the immutable judgment context
 * needed for a new decision: no broker command, raw output, approval grant or
 * mutable store handle can cross this boundary.
 */
export interface TrustedRevisionOutcomeContext {
  outcome_id: string;
  verification_status: 'not_required' | 'pending' | 'verified' | 'mismatch' | 'inconclusive' | 'verification_failed';
  revisit_required: boolean;
  execution_receipt_id: string;
  receipt_digest: string;
  expected_outcome_digest: string | null;
  latest_observation_digest: string | null;
  observation_id: string | null;
  expected_state: JsonObject | null;
  trusted_observed_state: JsonObject | null;
  reason_codes: string[];
}

/**
 * Desktop renderer-safe read-only outcome projection. This intentionally omits
 * receipt digests, bridge handles, approval/grant data, process output and
 * mutable runtime objects while retaining the expected-vs-observed facts a
 * human needs before deciding whether to reopen.
 */
export interface BoundedOutcomeProjection {
  outcome_id: string;
  verification_status: TrustedRevisionOutcomeContext['verification_status'];
  revisit_required: boolean;
  expected_state: JsonObject | null;
  trusted_observed_state: JsonObject | null;
  reason_codes: string[];
}

const MAX_BOUNDED_OUTCOME_STATE_BYTES = 8 * 1024;
const MAX_BOUNDED_OUTCOME_REASON_CODES = 50;

function boundedOutcomeState(state: JsonObject | null): JsonObject | null {
  if (state === null) return null;
  const canonical = canonicalJson(state);
  if (Buffer.byteLength(canonical, 'utf8') <= MAX_BOUNDED_OUTCOME_STATE_BYTES) {
    return structuredClone(state);
  }
  // Preserve verifiability without sending a large or unreviewed payload to
  // the renderer/agent. This is a display projection, never a substitute for
  // the trusted state retained inside the verification runtime.
  return {
    projection: 'TRUNCATED',
    canonical_sha256: sha256Hex(canonical),
    max_bytes: MAX_BOUNDED_OUTCOME_STATE_BYTES,
  };
}

export type VerificationPlanLookup = (planId: string) => PlanAuthorizationRecord | undefined;

export class ServerVerificationRuntime {
  private readonly cases = new Map<string, RegisteredCase>();
  private readonly observations = new Map<string, ReadbackObservationEnvelope>();
  private readonly receipts = new Map<string, TrustedExecutionReceipt>();
  private readonly store = new InMemoryOutcomeStore();
  private readonly registry = new OutcomeEvaluatorRegistry();
  private readonly service: OutcomeService;

  constructor(private readonly lookupPlan: VerificationPlanLookup, private readonly clock: () => Date = () => new Date()) {
    this.registry.register(GITHUB_ISSUE_CLOSE_EVALUATOR);
    this.service = new OutcomeService({
      receiptResolver: (receiptId) => this.receipts.get(receiptId) ?? null,
      observationResolver: (observationId) => this.observations.get(observationId) ?? null,
      evaluatorRegistry: this.registry,
      store: this.store,
      clock: this.clock,
      // The public runtime performs one bounded read-back per request. A
      // later native bridge may reserve additional attempts (up to the CP8
      // Brain bound of three); it can never retry the original write.
      maxVerificationAttempts: 1,
    });
  }

  registerControlledCase(input: {
    plan: ExecutionPlan;
    receipt: TrustedExecutionReceipt;
    observation: ReadbackObservationEnvelope | null;
  }): void {
    if (this.cases.has(input.plan.plan_id)) throw new Error(`duplicate verification fixture '${input.plan.plan_id}'`);
    this.cases.set(input.plan.plan_id, { ...input });
    this.receipts.set(input.receipt.receipt_id, input.receipt);
    if (input.observation) this.observations.set(input.observation.observation_id, input.observation);
  }

  /**
   * Materialize one receipt emitted by the native broker.  The only caller is
   * the loopback bridge authenticated with the process-local native secret;
   * the public API, MCP and Agent surfaces cannot submit receipts.  The
   * native identity digest is checked before a Brain receipt is derived.
   */
  async registerNativeReceipt(planId: string, rawReceipt: unknown): Promise<Record<string, unknown>> {
    const authorization = this.lookupPlan(planId);
    if (!authorization) throw new VerificationError('VERIFY_PLAN_NOT_FOUND', 'plan was not found in the server-owned authorization store');
    if (authorization.plan.state !== 'ready') {
      throw new VerificationError('NATIVE_RECEIPT_INVALID', 'a native receipt may only be registered for a server-owned ready plan');
    }
    const native = parseNativeReceipt(rawReceipt);
    if (native.plan_id !== planId) throw new VerificationError('NATIVE_RECEIPT_INVALID', 'native receipt plan_id does not match the bridge locator');
    if (native.decision_id !== authorization.plan.decision_id
      || native.capability_id !== authorization.plan.capability_id
      || native.capability_version !== authorization.plan.capability_version
      || native.adapter_id !== authorization.plan.adapter_id) {
      throw new VerificationError('NATIVE_RECEIPT_INVALID', 'native receipt identity does not match the approved plan');
    }
    const existing = this.cases.get(planId);
    if (existing) {
      if (existing.receipt.receipt_id === native.receipt_id) {
        const current = existing.outcomeId ? this.service.getOutcome(existing.outcomeId) : null;
        return current ? { ...this.toPublic(planId, current) } : {
          plan_id: planId,
          status: 'PENDING',
          revisit_required: false,
          verification_attempts: 0,
          readback_attempts: 0,
          execution_started: true,
          original_write_retried: false,
          automatic_rollback: false,
          source: 'trusted_server_runtime',
          evidence: 'trusted_readback_unavailable',
        };
      }
      throw new VerificationError('NATIVE_RECEIPT_DUPLICATE', 'a different native receipt is already registered for this plan');
    }
    const receipt = materializeTrustedReceipt(native);
    this.receipts.set(receipt.receipt_id, receipt);
    const registered: RegisteredCase = { plan: authorization.plan, receipt, observation: null };
    this.cases.set(planId, registered);
    try {
      const opened = await this.service.openOutcome({ plan: authorization.plan, receipt_id: receipt.receipt_id });
      registered.outcomeId = opened.outcome_id;
      return { ...this.toPublic(planId, opened) };
    } catch (error) {
      this.cases.delete(planId);
      this.receipts.delete(receipt.receipt_id);
      throw error;
    }
  }

  /**
   * Accept one native read-back observation after the native runner has
   * already reserved its single-use attempt.  Brain injects that same
   * attempt id into OutcomeService and remains the sole semantic evaluator.
   */
  async completeNativeVerification(planId: string, rawObservation: unknown): Promise<ControlVerificationResult> {
    const registered = this.cases.get(planId);
    if (!registered) throw new VerificationError('VERIFY_PLAN_NOT_FOUND', 'no native receipt is registered for this plan');
    if (!registered.outcomeId) {
      const opened = await this.service.openOutcome({ plan: registered.plan, receipt_id: registered.receipt.receipt_id });
      registered.outcomeId = opened.outcome_id;
    }
    const parsed = z.object({
      observation: z.unknown(),
    }).strict().safeParse(rawObservation);
    if (!parsed.success) throw new VerificationError('NATIVE_OBSERVATION_INVALID', 'native observation bridge body is invalid');
    const observation = parsed.data.observation as unknown;
    const { ReadbackObservationEnvelopeSchema } = await import('../outcome/contracts.js');
    const envelope = ReadbackObservationEnvelopeSchema.safeParse(observation);
    if (!envelope.success) throw new VerificationError('NATIVE_OBSERVATION_INVALID', 'native observation failed the strict bridge contract');
    const typed = envelope.data;
    if (typed.origin_plan_id !== planId || typed.origin_execution_receipt_id !== registered.receipt.receipt_id) {
      throw new VerificationError('NATIVE_OBSERVATION_INVALID', 'native observation is bound to a different plan or receipt');
    }
    this.observations.set(typed.observation_id, typed);
    const current = this.service.getOutcome(registered.outcomeId);
    if (!current) throw new VerificationError('VERIFY_RUNTIME_UNAVAILABLE', 'verification outcome was not persisted');
    if (current.verification_status !== 'pending') return this.toPublic(planId, current);
    const attempt = await this.service.beginVerificationAttempt(registered.outcomeId, {
      attempt_id: typed.verification_attempt_id,
      started_at: typed.attempt_started_at,
    });
    const completed = await this.service.completeVerificationAttempt({
      outcome_id: registered.outcomeId,
      attempt_id: attempt.attempt_id,
      observation_id: typed.observation_id,
    });
    registered.observation = typed;
    return this.toPublic(planId, completed);
  }

  async verifyPlan(planId: string): Promise<ControlVerificationResult> {
    const registered = this.cases.get(planId);
    if (!registered) {
      const authorization = this.lookupPlan(planId);
      if (!authorization) throw new VerificationError('VERIFY_PLAN_NOT_FOUND', 'plan was not found in the server-owned authorization store');
      // A plan without a trusted native execution receipt cannot be upgraded
      // by a caller-provided result.  It remains explicitly inconclusive.
      return {
        plan_id: planId,
        status: 'INCONCLUSIVE',
        revisit_required: true,
        verification_attempts: 0,
        readback_attempts: 0,
        execution_started: false,
        original_write_retried: false,
        automatic_rollback: false,
        source: 'trusted_server_runtime',
        evidence: 'trusted_readback_unavailable',
      };
    }

    if (!registered.outcomeId) {
      const opened = await this.service.openOutcome({ plan: registered.plan, receipt_id: registered.receipt.receipt_id });
      registered.outcomeId = opened.outcome_id;
    }
    const current = this.service.getOutcome(registered.outcomeId);
    if (!current) throw new VerificationError('VERIFY_RUNTIME_UNAVAILABLE', 'verification outcome was not persisted');
    if (current.verification_status !== 'pending') return this.toPublic(registered.plan.plan_id, current);

    const attemptId = `att-${randomUUID()}`;
    const attempt = await this.service.beginVerificationAttempt(registered.outcomeId, {
      attempt_id: attemptId,
      started_at: registered.observation?.attempt_started_at ?? this.clock().toISOString(),
    });
    if (!registered.observation) {
      // No observation is a normal fail-closed result, never a success.  The
      // native read-back bridge will replace this controlled path in a later
      // checkpoint; D1B-2 does not fabricate an observation.
      return {
        plan_id: registered.plan.plan_id,
        status: 'INCONCLUSIVE',
        revisit_required: true,
        verification_attempts: current.verification_attempts.length,
        readback_attempts: 1,
        execution_started: false,
        original_write_retried: false,
        automatic_rollback: false,
        source: 'trusted_server_runtime',
        evidence: 'trusted_readback_unavailable',
      };
    }
    const observation = {
      ...registered.observation,
      verification_attempt_id: attempt.attempt_id,
      attempt_started_at: attempt.started_at,
    } as ReadbackObservationEnvelope;
    this.observations.set(observation.observation_id, observation);
    const completed = await this.service.completeVerificationAttempt({
      outcome_id: registered.outcomeId,
      attempt_id: attempt.attempt_id,
      observation_id: observation.observation_id,
    });
    return this.toPublic(registered.plan.plan_id, completed);
  }

  /**
   * Read-only outcome observation for Goal26 Agent Pilot. Unlike verifyPlan,
   * this method never starts a read-back attempt and never mutates outcome
   * state; it only exposes the already-materialized status (or a fail-closed
   * inconclusive result for a plan without a trusted receipt).
   */
  observePlan(planId: string): ControlVerificationResult | null {
    const registered = this.cases.get(planId);
    if (!registered) {
      return this.lookupPlan(planId) ? {
        plan_id: planId,
        status: 'INCONCLUSIVE',
        revisit_required: true,
        verification_attempts: 0,
        readback_attempts: 0,
        execution_started: false,
        original_write_retried: false,
        automatic_rollback: false,
        source: 'trusted_server_runtime',
        evidence: 'trusted_readback_unavailable',
      } : null;
    }
    if (!registered.outcomeId) {
      return {
        plan_id: planId,
        status: 'PENDING',
        revisit_required: false,
        verification_attempts: 0,
        readback_attempts: 0,
        execution_started: false,
        original_write_retried: false,
        automatic_rollback: false,
        source: 'trusted_server_runtime',
        evidence: 'trusted_readback_unavailable',
      };
    }
    const current = this.service.getOutcome(registered.outcomeId);
    return current ? this.toPublic(planId, current) : null;
  }

  /**
   * Resolve only the trusted outcome bound to a server-owned plan.  A
   * DecisionRevision uses this internal method to snapshot historical
   * expectation/read-back context before it requalifies evidence.  No caller
   * can supply a receipt, observation, or alternate outcome id.
   */
  getTrustedRevisionContext(planId: string): TrustedRevisionOutcomeContext | null {
    const registered = this.cases.get(planId);
    if (!registered?.outcomeId) return null;
    const context = this.service.getTrustedRevisionContext(registered.outcomeId);
    if (!context) return null;
    const finalAttempt = context.outcome.verification_attempts[context.outcome.verification_attempts.length - 1];
    return {
      outcome_id: context.outcome.outcome_id,
      verification_status: context.outcome.verification_status,
      revisit_required: context.outcome.revisit_required,
      execution_receipt_id: context.outcome.execution_receipt_id,
      receipt_digest: registered.receipt.receipt_digest,
      expected_outcome_digest: context.outcome.expected_outcome_digest ?? null,
      latest_observation_digest: context.outcome.latest_observation_digest ?? null,
      observation_id: context.observation_id,
      expected_state: context.expected_state,
      trusted_observed_state: context.trusted_observed_state,
      reason_codes: [...(finalAttempt?.reason_codes ?? [])],
    };
  }

  /** Read-only bounded facts for Desktop/Agent display; no control authority. */
  getBoundedOutcomeProjection(planId: string): BoundedOutcomeProjection | null {
    const context = this.getTrustedRevisionContext(planId);
    if (!context) return null;
    return {
      outcome_id: context.outcome_id,
      verification_status: context.verification_status,
      revisit_required: context.revisit_required,
      expected_state: boundedOutcomeState(context.expected_state),
      trusted_observed_state: boundedOutcomeState(context.trusted_observed_state),
      reason_codes: context.reason_codes.slice(0, MAX_BOUNDED_OUTCOME_REASON_CODES),
    };
  }

  private toPublic(planId: string, record: OutcomeRecord): ControlVerificationResult {
    const status = record.verification_status === 'pending'
      ? 'PENDING'
      : record.verification_status === 'verified'
      ? 'VERIFIED'
      : record.verification_status === 'mismatch'
        ? 'MISMATCH'
        : 'INCONCLUSIVE';
    return {
      plan_id: planId,
      status,
      revisit_required: record.revisit_required,
      verification_attempts: record.verification_attempts.length,
      readback_attempts: record.verification_attempts.length,
      execution_started: false,
      original_write_retried: false,
      automatic_rollback: false,
      source: 'trusted_server_runtime',
      evidence: status === 'VERIFIED' ? 'trusted_receipt_and_readback' : status === 'MISMATCH' ? 'trusted_readback_mismatch' : 'trusted_readback_unavailable',
    };
  }
}

function fixturePlan(planId: string, number: number): ExecutionPlan {
  const now = new Date();
  return {
    plan_id: planId,
    decision_id: `decision-${planId}`,
    capability_id: 'github.issue.close',
    capability_version: '1.0.0',
    adapter_id: 'github-cli',
    normalized_inputs: { owner: 'omni-context-fixture', repo: 'd1b2-controlled', number },
    required_approval: true,
    approval: {
      approval_id: `approval-${planId}`,
      plan_id: planId,
      granted_by: 'local-owner',
      granted_at: new Date(now.getTime() - 1_000).toISOString(),
      policy_version: 'goal24-approval-policy-v1',
      token_reference: `native-ref-${planId}`,
      token_digest: 'a'.repeat(64),
    },
    risk_snapshot: {
      risk_level: 'high',
      reversible: false,
      side_effect_class: 'destructive_write',
      required_authority: 'L3',
      capability_version: '1.0.0',
    },
    evidence_coverage_snapshot: { entries: [] },
    timeout_ms: 5_000,
    verification_plan: {
      verification_capability_id: 'github.issue.read',
      verification_inputs: { owner: 'omni-context-fixture', repo: 'd1b2-controlled', number },
    },
    rollback_plan: null,
    state: 'succeeded',
    created_at: new Date(now.getTime() - 5_000).toISOString(),
    expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
  };
}

function fixtureReceipt(plan: ExecutionPlan, receiptId: string): TrustedExecutionReceipt {
  const accepted = new Date(Date.parse(plan.created_at) + 500).toISOString();
  const spawned = new Date(Date.parse(plan.created_at) + 700).toISOString();
  const finished = new Date(Date.parse(plan.created_at) + 900).toISOString();
  const draft: Omit<TrustedExecutionReceipt, 'receipt_digest'> = {
    receipt_id: receiptId,
    plan_id: plan.plan_id,
    decision_id: plan.decision_id,
    capability_id: plan.capability_id,
    capability_version: plan.capability_version,
    adapter_id: plan.adapter_id,
    normalized_inputs_digest: normalizedInputsDigest(plan.normalized_inputs),
    verification_plan_digest: verificationPlanDigest(plan) ?? undefined,
    execution_state: 'process_failed',
    accepted_at: accepted,
    spawn_started_at: spawned,
    finished_at: finished,
    exit_code: 1,
    timed_out: false,
    cancelled: false,
    source: 'native_broker',
  };
  const digest = recomputeReceiptDigest({ ...draft, receipt_digest: '0'.repeat(64) } as TrustedExecutionReceipt);
  return { ...draft, receipt_digest: digest };
}

function fixtureObservation(plan: ExecutionPlan, receipt: TrustedExecutionReceipt, attemptId: string, payload: JsonObject, observationId: string): ReadbackObservationEnvelope {
  const attemptStarted = new Date(Date.parse(receipt.spawn_started_at!) + 100).toISOString();
  const observed = new Date(Date.parse(attemptStarted) + 100).toISOString();
  return {
    observation_id: observationId,
    verification_attempt_id: attemptId,
    origin_plan_id: plan.plan_id,
    origin_execution_receipt_id: receipt.receipt_id,
    verification_capability_id: 'github.issue.read',
    subject_key: `issue:omni-context-fixture/d1b2-controlled#${plan.normalized_inputs.number}`,
    attempt_started_at: attemptStarted,
    observed_at: observed,
    verification_source: 'synthetic_test',
    verification_level: 'verified',
    payload,
    payload_digest: observationPayloadDigest(payload),
    truncated: false,
    parser_status: 'parsed',
    source_adapter: 'github-cli',
    source_binding: 'github.issue.read.binding',
    process_exit_code: 0,
    process_timed_out: false,
    process_cancelled: false,
    resolved_executable_fingerprint: 'controlled-fixture-readback',
    process_duration_ms: 10,
  };
}

/** Register the three deterministic, server-owned gate fixtures. */
export function registerD1b2ControlledCases(runtime: ServerVerificationRuntime): {
  verified_plan_id: string;
  mismatch_plan_id: string;
  inconclusive_plan_id: string;
} {
  const verified = fixturePlan('plan-d1b2-verified', 101);
  const mismatch = fixturePlan('plan-d1b2-mismatch', 102);
  const inconclusive = fixturePlan('plan-d1b2-inconclusive', 103);
  const vReceipt = fixtureReceipt(verified, 'receipt-d1b2-verified');
  const mReceipt = fixtureReceipt(mismatch, 'receipt-d1b2-mismatch');
  const iReceipt = fixtureReceipt(inconclusive, 'receipt-d1b2-inconclusive');
  runtime.registerControlledCase({
    plan: verified,
    receipt: vReceipt,
    observation: fixtureObservation(verified, vReceipt, 'server-generated', { number: 101, state: 'CLOSED' }, 'obs-d1b2-verified'),
  });
  runtime.registerControlledCase({
    plan: mismatch,
    receipt: mReceipt,
    observation: fixtureObservation(mismatch, mReceipt, 'server-generated', { number: 102, state: 'OPEN' }, 'obs-d1b2-mismatch'),
  });
  runtime.registerControlledCase({ plan: inconclusive, receipt: iReceipt, observation: null });
  return {
    verified_plan_id: verified.plan_id,
    mismatch_plan_id: mismatch.plan_id,
    inconclusive_plan_id: inconclusive.plan_id,
  };
}
