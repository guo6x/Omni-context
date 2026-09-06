/**
 * Goal28 Lite focused Brain-side contract/evaluator tests.
 *
 * These tests exercise the existing CP6 evidence pipeline, canonical Decision
 * Kernel, CP7 approval plan creation and CP8 outcome evaluator for the new
 * local Git capability.  The native disposable-repository execution is covered
 * by the companion Rust golden E2E in `desktop-daemon/src-tauri/src/local_git`.
 */

import { describe, expect, it } from 'vitest';
import { createProductionAuthorizationRuntime } from '../src/approval/production-runtime.js';
import { GIT_BRANCH_CREATE_CAPABILITY, GIT_BRANCH_READ_CAPABILITY } from '../src/capabilities/git-local.js';
import { CapabilityDefinitionSchema } from '../src/capabilities/contracts.js';
import { EvidenceProviderRegistry, type EvidenceCollectRequest, type EvidenceProviderV1 } from '../src/evidence/index.js';
import { ExecutionPlanSchema, type ExecutionPlan } from '../src/execution/contracts.js';
import { DECISION_KERNEL_ID, runDecisionKernel } from '../src/decision/kernel.js';
import {
  normalizedInputsDigest,
  observationPayloadDigest,
  recomputeReceiptDigest,
  verificationPlanDigest,
  type ReadbackObservationEnvelope,
  type TrustedExecutionReceipt,
} from '../src/outcome/index.js';

const NOW = new Date('2026-09-06T08:00:00.000Z');
const START_POINT = 'a'.repeat(40);
const INPUTS = {
  repository_path: 'C:\\goal28\\disposable-repository',
  branch_name: 'goal28-fixture/verified',
  start_point: START_POINT,
};

function controlledProvider(): EvidenceProviderRegistry {
  const provider: EvidenceProviderV1 = {
    metadata: {
      provider_id: 'goal28-controlled-provider',
      version: '1.0.0',
      supported_classes: ['repository.current_state'],
      priority: 100,
      max_verification_level: 'asserted',
      description: 'Goal28 local-only evidence fixture; no external provider.',
    },
    async collect(request: EvidenceCollectRequest) {
      return {
        outcome: 'collected' as const,
        candidates: [{
          evidence_class: request.evidence_class,
          subject_key: request.subject_key,
          claim_key: 'git.repository.eligibility',
          claim_value: {
            repository_path: INPUTS.repository_path,
            branch_name: INPUTS.branch_name,
            start_point: INPUTS.start_point,
            eligible: true,
          },
          source_item_id: 'goal28-controlled-provider:eligible:1',
          source_reference: 'goal28-controlled-local-fixture',
          observed_at: NOW.toISOString(),
          verification_level: 'asserted' as const,
        }],
        diagnostics: [],
      };
    },
  };
  const providers = new EvidenceProviderRegistry();
  providers.register(provider);
  return providers;
}

function receiptFor(plan: ExecutionPlan): TrustedExecutionReceipt {
  const draft: TrustedExecutionReceipt = {
    receipt_id: 'rcpt-goal28-typescript-fixture-0001',
    plan_id: plan.plan_id,
    decision_id: plan.decision_id,
    capability_id: plan.capability_id,
    capability_version: plan.capability_version,
    adapter_id: plan.adapter_id,
    normalized_inputs_digest: normalizedInputsDigest(plan.normalized_inputs),
    verification_plan_digest: verificationPlanDigest(plan) ?? undefined,
    execution_state: 'process_succeeded',
    accepted_at: new Date(NOW.getTime() - 3_000).toISOString(),
    spawn_started_at: new Date(NOW.getTime() - 2_000).toISOString(),
    finished_at: new Date(NOW.getTime() - 1_000).toISOString(),
    exit_code: 0,
    timed_out: false,
    cancelled: false,
    source: 'native_broker',
    receipt_digest: '0'.repeat(64),
  };
  return { ...draft, receipt_digest: recomputeReceiptDigest(draft) };
}

function observationFor(plan: ExecutionPlan, receipt: TrustedExecutionReceipt, targetSha = START_POINT): ReadbackObservationEnvelope {
  const payload = { target_sha: targetSha };
  return {
    observation_id: 'observation-goal28-typescript-fixture-0001',
    verification_attempt_id: 'attempt-goal28-typescript-0001',
    origin_plan_id: plan.plan_id,
    origin_execution_receipt_id: receipt.receipt_id,
    verification_capability_id: 'git.branch.read',
    subject_key: 'git:branch:goal28-fixture/verified',
    attempt_started_at: new Date(NOW.getTime() - 500).toISOString(),
    observed_at: NOW.toISOString(),
    verification_source: 'synthetic_test',
    verification_level: 'verified',
    payload,
    payload_digest: observationPayloadDigest(payload),
    truncated: false,
    parser_status: 'parsed',
    source_adapter: 'git.local',
    source_binding: 'git-local.branch.read.readback',
    process_exit_code: 0,
    process_timed_out: false,
    process_cancelled: false,
    resolved_executable_fingerprint: 'goal28-controlled-git',
    process_duration_ms: 1,
  };
}

describe('Goal28 Lite second adapter', () => {
  it('publishes strict semantic capability contracts without generic execution fields', () => {
    expect(CapabilityDefinitionSchema.safeParse(GIT_BRANCH_CREATE_CAPABILITY).success).toBe(true);
    expect(CapabilityDefinitionSchema.safeParse(GIT_BRANCH_READ_CAPABILITY).success).toBe(true);
    expect(GIT_BRANCH_CREATE_CAPABILITY).toMatchObject({
      id: 'git.branch.create',
      verification_capability: 'git.branch.read',
      required_authority: 'L1',
      risk_level: 'medium',
      side_effect_class: 'reversible_write',
    });
    expect(GIT_BRANCH_CREATE_CAPABILITY.input_schema).not.toHaveProperty('command');
    expect(GIT_BRANCH_CREATE_CAPABILITY.input_schema).not.toHaveProperty('args');
    expect(GIT_BRANCH_CREATE_CAPABILITY.input_schema).not.toHaveProperty('shell');
  });

  it('runs qualified evidence through the existing Decision Kernel and creates an approval-bound plan', async () => {
    const runtime = createProductionAuthorizationRuntime({
      providers: controlledProvider(),
      clock: () => new Date(NOW.getTime()),
    });
    const evidence = await runtime.evidenceRuntime.evaluateForCapability({
      capability_id: 'git.branch.create',
      capability_version: '1.0.0',
      normalized_inputs: INPUTS,
      correlation_id: 'goal28-qualified-evidence',
    });
    expect(evidence.action).toBe('proceed');
    expect(evidence.final_assessment.mandatory_satisfied).toBe(true);
    expect(evidence.qualified_evidence_ids).toHaveLength(1);

    const kernel = runDecisionKernel({
      evidence_action: evidence.action,
      mandatory_satisfied: evidence.final_assessment.mandatory_satisfied,
      reason_codes: evidence.reason_codes,
    });
    expect(kernel).toMatchObject({ kernel_id: DECISION_KERNEL_ID, disposition: 'DECIDE' });

    const authorization = runtime.authorizationService.authorize({
      decision_id: 'decision-goal28-typescript-contract-0001',
      capability_id: 'git.branch.create',
      capability_version: '1.0.0',
      adapter_id: 'git.local',
      normalized_inputs: INPUTS,
      guard_run_id: evidence.guard_run_id,
      timeout_ms: 30_000,
      verification_plan: {
        verification_capability_id: 'git.branch.read',
        verification_inputs: {
          repository_path: INPUTS.repository_path,
          branch_name: INPUTS.branch_name,
        },
      },
      rollback_plan: null,
      requested_by: 'goal28-focused-test',
    });
    expect(authorization).toMatchObject({
      required_approval: true,
      plan: { adapter_id: 'git.local', state: 'awaiting_approval', approval: null },
      approval_request: { status: 'pending' },
    });
    expect(ExecutionPlanSchema.safeParse(authorization.plan).success).toBe(true);
    expect(ExecutionPlanSchema.safeParse({
      ...authorization.plan,
      normalized_inputs: { ...authorization.plan.normalized_inputs, command: 'git branch --force' },
    }).success).toBe(false);
  });

  it('keeps native outcome semantics separate: pending before read-back, verified only after trusted target SHA', async () => {
    const runtime = createProductionAuthorizationRuntime({
      providers: controlledProvider(),
      clock: () => new Date(NOW.getTime()),
    });
    const evidence = await runtime.evidenceRuntime.evaluateForCapability({
      capability_id: 'git.branch.create',
      capability_version: '1.0.0',
      normalized_inputs: INPUTS,
      correlation_id: 'goal28-outcome-fixture',
    });
    const authorization = runtime.authorizationService.authorize({
      decision_id: 'decision-goal28-outcome-0001',
      capability_id: 'git.branch.create',
      capability_version: '1.0.0',
      adapter_id: 'git.local',
      normalized_inputs: INPUTS,
      guard_run_id: evidence.guard_run_id,
      timeout_ms: 30_000,
      verification_plan: {
        verification_capability_id: 'git.branch.read',
        verification_inputs: {
          repository_path: INPUTS.repository_path,
          branch_name: INPUTS.branch_name,
        },
      },
      rollback_plan: null,
      requested_by: 'goal28-focused-test',
    });
    const receipt = receiptFor(authorization.plan);
    const observation = observationFor(authorization.plan, receipt);
    runtime.verificationRuntime.registerControlledCase({ plan: authorization.plan, receipt, observation });
    expect(runtime.verificationRuntime.observePlan(authorization.plan.plan_id)).toMatchObject({ status: 'PENDING' });
    await expect(runtime.verificationRuntime.verifyPlan(authorization.plan.plan_id)).resolves.toMatchObject({
      status: 'VERIFIED',
      execution_started: false,
      original_write_retried: false,
    });
  });
});
