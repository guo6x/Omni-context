/**
 * vNext local-only supersession fixture.
 *
 * This fixture exists only for an explicitly opted-in installed Desktop gate.
 * It creates one real CP6/CP7 decision, registers a deterministic in-memory
 * mismatch receipt/read-back, and asks the real Goal27 revision service to
 * produce a fresh judgment.  It never invokes the native broker or GitHub and
 * never reuses historical approval/grant/plan authority.
 */

import type { ProductionAuthorizationRuntime } from '../approval/production-runtime.js';
import type { ExecutionPlan } from '../execution/contracts.js';
import {
  normalizedInputsDigest,
  observationPayloadDigest,
  recomputeReceiptDigest,
  verificationPlanDigest,
  type ReadbackObservationEnvelope,
  type TrustedExecutionReceipt,
} from '../outcome/index.js';
import type { DecisionRevisionService } from './service.js';

const CAPABILITY_ID = 'github.issue.close';
const CAPABILITY_VERSION = '1.0.0';
const INPUTS = { owner: 'fixture-owner', repo: 'fixture-repo', number: 909 };

export interface VnextSupersessionFixtureResult {
  fixture: 'VNEXT_SUPERSESSION_CONTROLLED_LOCAL_ONLY';
  creation_path: 'CP6 -> CP7 -> controlled mismatch -> Goal27 reopen';
  original_plan_id: string;
  original_decision_id: string;
  original_outcome_status: 'MISMATCH';
  revision_id: string;
  current_decision_id: string;
  current_plan_id: string;
  current_plan_state: 'awaiting_approval';
  requires_new_approval: true;
  native_execution_started: false;
  external_github_writes: 0;
  synthetic_receipt_registered: true;
  synthetic_readback_registered: true;
  reopen_execution_count: 0;
  old_approval_reused: false;
  old_grant_reused: false;
  old_plan_reused: false;
}

function controlledReceipt(plan: ExecutionPlan): TrustedExecutionReceipt {
  const now = Date.now();
  const draft: TrustedExecutionReceipt = {
    receipt_id: `receipt-vnext-supersession-${plan.plan_id.slice(-12)}`,
    plan_id: plan.plan_id,
    decision_id: plan.decision_id,
    capability_id: plan.capability_id,
    capability_version: plan.capability_version,
    adapter_id: plan.adapter_id,
    normalized_inputs_digest: normalizedInputsDigest(plan.normalized_inputs),
    verification_plan_digest: verificationPlanDigest(plan) ?? undefined,
    execution_state: 'process_succeeded',
    accepted_at: new Date(now - 3_000).toISOString(),
    spawn_started_at: new Date(now - 2_000).toISOString(),
    finished_at: new Date(now - 1_000).toISOString(),
    exit_code: 0,
    timed_out: false,
    cancelled: false,
    source: 'native_broker',
    receipt_digest: '0'.repeat(64),
  };
  return { ...draft, receipt_digest: recomputeReceiptDigest(draft) };
}

function controlledMismatchObservation(
  plan: ExecutionPlan,
  receipt: TrustedExecutionReceipt,
): ReadbackObservationEnvelope {
  const payload = { number: INPUTS.number, state: 'OPEN' };
  const observedAt = new Date().toISOString();
  return {
    observation_id: `observation-vnext-supersession-${plan.plan_id.slice(-12)}`,
    verification_attempt_id: 'server-generated-attempt',
    origin_plan_id: plan.plan_id,
    origin_execution_receipt_id: receipt.receipt_id,
    verification_capability_id: 'github.issue.read',
    subject_key: `issue:${INPUTS.owner}/${INPUTS.repo}#${INPUTS.number}`,
    attempt_started_at: observedAt,
    observed_at: observedAt,
    verification_source: 'synthetic_test',
    verification_level: 'verified',
    payload,
    payload_digest: observationPayloadDigest(payload),
    truncated: false,
    parser_status: 'parsed',
    source_adapter: 'github-cli',
    source_binding: 'vnext-supersession-controlled-readback',
    process_exit_code: 0,
    process_timed_out: false,
    process_cancelled: false,
    resolved_executable_fingerprint: 'vnext-supersession-controlled-local',
    process_duration_ms: 1,
  };
}

export async function createVnextSupersessionControlledFixture(
  runtime: ProductionAuthorizationRuntime,
  revisions: DecisionRevisionService,
): Promise<VnextSupersessionFixtureResult> {
  const evidence = await runtime.evidenceRuntime.evaluateForCapability({
    capability_id: CAPABILITY_ID,
    capability_version: CAPABILITY_VERSION,
    normalized_inputs: INPUTS,
    correlation_id: 'vnext-supersession-original',
  });
  if (evidence.action !== 'proceed') {
    throw new Error(`VNEXT_SUPERSESSION_EVIDENCE_NOT_PROCEED:${evidence.action}`);
  }

  const authorization = runtime.authorizationService.authorize({
    decision_id: 'decision-vnext-supersession-original',
    capability_id: CAPABILITY_ID,
    capability_version: CAPABILITY_VERSION,
    adapter_id: 'github-cli',
    normalized_inputs: INPUTS,
    guard_run_id: evidence.guard_run_id,
    timeout_ms: 15 * 60_000,
    verification_plan: {
      verification_capability_id: 'github.issue.read',
      verification_inputs: INPUTS,
    },
    rollback_plan: null,
    requested_by: 'vnext-supersession-controlled-fixture',
    correlation_id: 'vnext-supersession-original',
  });
  if (authorization.plan.state !== 'awaiting_approval') {
    throw new Error(`VNEXT_SUPERSESSION_ORIGINAL_PLAN_STATE:${authorization.plan.state}`);
  }

  const receipt = controlledReceipt(authorization.plan);
  const observation = controlledMismatchObservation(authorization.plan, receipt);
  runtime.verificationRuntime.registerControlledCase({
    plan: authorization.plan,
    receipt,
    observation,
  });
  const outcome = await runtime.verificationRuntime.verifyPlan(authorization.plan.plan_id);
  if (outcome.status !== 'MISMATCH' || !outcome.revisit_required) {
    throw new Error(`VNEXT_SUPERSESSION_EXPECTED_MISMATCH:${outcome.status}`);
  }
  const trustedOutcome = runtime.verificationRuntime.getTrustedRevisionContext(authorization.plan.plan_id);
  if (!trustedOutcome) {
    throw new Error('VNEXT_SUPERSESSION_TRUSTED_OUTCOME_MISSING');
  }

  const reopened = await revisions.reopen({
    decision_id: authorization.plan.decision_id,
    outcome_id: trustedOutcome.outcome_id,
    reason: 'controlled installed supersession visibility proof',
  }, {
    actor_id: 'local-owner',
    actor_kind: 'owner',
    scope: 'control:reopen',
  });
  if (
    reopened.new_disposition !== 'DECIDE'
    || !reopened.new_plan_id
    || !reopened.requires_new_approval
  ) {
    throw new Error(`VNEXT_SUPERSESSION_REOPEN_NOT_DECIDE:${reopened.new_disposition}`);
  }
  const current = runtime.authorizationService.getAuthorizationRecord(reopened.new_plan_id);
  if (!current || current.plan.state !== 'awaiting_approval') {
    throw new Error('VNEXT_SUPERSESSION_CURRENT_PLAN_NOT_AWAITING_APPROVAL');
  }

  return {
    fixture: 'VNEXT_SUPERSESSION_CONTROLLED_LOCAL_ONLY',
    creation_path: 'CP6 -> CP7 -> controlled mismatch -> Goal27 reopen',
    original_plan_id: authorization.plan.plan_id,
    original_decision_id: authorization.plan.decision_id,
    original_outcome_status: 'MISMATCH',
    revision_id: reopened.revision_id,
    current_decision_id: reopened.new_decision_id,
    current_plan_id: reopened.new_plan_id,
    current_plan_state: 'awaiting_approval',
    requires_new_approval: true,
    native_execution_started: false,
    external_github_writes: 0,
    synthetic_receipt_registered: true,
    synthetic_readback_registered: true,
    reopen_execution_count: reopened.reopen_execution_count,
    old_approval_reused: reopened.old_approval_reused,
    old_grant_reused: reopened.old_grant_reused,
    old_plan_reused: reopened.old_plan_reused,
  };
}
