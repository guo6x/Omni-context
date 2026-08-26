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
import type { ExecutionPlan } from '../execution/contracts.js';
import type { ControlVerificationResult } from './verification-facade.js';
import type { PlanAuthorizationRecord } from '../approval/contracts.js';
import type { JsonObject } from '../contracts/json-safe.js';
import {
  InMemoryOutcomeStore,
  OutcomeEvaluatorRegistry,
  OutcomeService,
  observationPayloadDigest,
  normalizedInputsDigest,
  recomputeReceiptDigest,
  verificationPlanDigest,
  type ReadbackObservationEnvelope,
  type TrustedExecutionReceipt,
  type OutcomeRecord,
} from '../outcome/index.js';
import { GITHUB_ISSUE_CLOSE_EVALUATOR } from '../outcome/evaluators/github-issue-close-evaluator.js';
import { VerificationError } from './verification-facade.js';

interface RegisteredCase {
  plan: ExecutionPlan;
  receipt: TrustedExecutionReceipt;
  observation: ReadbackObservationEnvelope | null;
  outcomeId?: string;
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

  private toPublic(planId: string, record: OutcomeRecord): ControlVerificationResult {
    const status = record.verification_status === 'verified'
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
