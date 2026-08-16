/**
 * Goal24 Post-CP8 Real E2E (DRG-2 candidate) - offline adversarial and
 * trust-chain tests for the github.issue.close production write capability.
 *
 * No network, no gh process, no real GitHub mutation. The REAL run happens
 * through the dev-only operator harness (see docs/goal24/real-e2e/).
 */

import { describe, expect, it } from 'vitest';

import { approvalRequired, deriveRiskSnapshot } from '../src/approval/policy.js';
import { GITHUB_ISSUE_CLOSE_CAPABILITY } from '../src/capabilities/github-write.js';
import { ExecutionPlanSchema, type ExecutionPlan } from '../src/execution/contracts.js';
import {
  InMemoryOutcomeStore,
  OutcomeError,
  OutcomeEvaluatorRegistry,
  OutcomeService,
  observationPayloadDigest,
  sha256Hex,
  type ReadbackObservationEnvelope,
  type TrustedExecutionReceipt,
} from '../src/outcome/index.js';
import { GITHUB_ISSUE_CLOSE_EVALUATOR } from '../src/outcome/evaluators/github-issue-close-evaluator.js';
import { canonicalJson } from '../src/evidence/model.js';
import { closePrecondition } from '../scripts/goal24-real-e2e/github-native-provider.js';
import {
  makeNativeGrantVerifier,
  makeObservationResolver,
  materializeReceipt,
} from '../scripts/goal24-real-e2e/bridge.js';
import {
  buildReceipt,
  fixedClock,
  makeObservationResolver,
  makeReceiptResolver,
} from './helpers/fake-outcome.js';

const CLOSE_PLAN_ID = 'plan-close-0001';
const OWNER = 'guo6x';
const REPO = 'Omni-context';
const ISSUE_NUMBER = 2;
const SUBJECT = `issue:${OWNER}/${REPO}#${ISSUE_NUMBER}`;

function closePlan(overrides: Record<string, unknown> = {}): ExecutionPlan {
  return ExecutionPlanSchema.parse({
    plan_id: CLOSE_PLAN_ID,
    decision_id: 'decision-close-0001',
    capability_id: 'github.issue.close',
    capability_version: '1.0.0',
    adapter_id: 'github-cli',
    normalized_inputs: { owner: OWNER, repo: REPO, number: ISSUE_NUMBER },
    required_approval: true,
    approval: null,
    risk_snapshot: {
      risk_level: 'medium',
      reversible: true,
      side_effect_class: 'reversible_write',
      required_authority: 'L2',
      capability_version: '1.0.0',
    },
    evidence_coverage_snapshot: { entries: [] },
    timeout_ms: 60_000,
    verification_plan: {
      verification_capability_id: 'github.issue.read',
      verification_inputs: { owner: OWNER, repo: REPO, number: ISSUE_NUMBER },
    },
    rollback_plan: null,
    state: 'awaiting_approval',
    created_at: '2026-08-15T00:00:00.000Z',
    expires_at: '2026-08-15T00:15:00.000Z',
    requested_by: 'goal24-real-e2e-tests',
    ...overrides,
  });
}

function closeReceipt(state: 'process_succeeded' | 'process_failed' | 'timed_out' | 'cancelled' = 'process_succeeded'): TrustedExecutionReceipt {
  const plan = closePlan();
  return buildReceipt({
    receiptId: 'rcpt-close-0001',
    plan,
    executionState: state,
    exitCode: state === 'process_failed' ? 7 : 0,
  });
}

function observation(options: {
  state?: string;
  number?: number;
  attemptId?: string;
  observedAt?: Date;
  capabilityId?: string;
  subjectKey?: string;
  originPlanId?: string;
  originReceiptId?: string;
} = {}): ReadbackObservationEnvelope {
  const payload = {
    number: options.number ?? ISSUE_NUMBER,
    state: options.state ?? 'CLOSED',
  };
  const digest = observationPayloadDigest(payload);
  return {
    observation_id: 'obs-close-0001',
    verification_attempt_id: options.attemptId ?? 'att-close-0001',
    origin_plan_id: options.originPlanId ?? CLOSE_PLAN_ID,
    origin_execution_receipt_id: options.originReceiptId ?? 'rcpt-close-0001',
    verification_capability_id: options.capabilityId ?? 'github.issue.read',
    subject_key: options.subjectKey ?? SUBJECT,
    attempt_started_at: '2026-08-15T00:05:00.000Z',
    observed_at: options.observedAt?.toISOString() ?? '2026-08-15T00:05:03.000Z',
    verification_source: 'native_readback',
    verification_level: 'verified',
    payload,
    payload_digest: digest,
    truncated: false,
    parser_status: 'parsed',
    source_adapter: 'github-cli',
    source_binding: 'github-cli.issue.read.readback',
    process_exit_code: 0,
    process_timed_out: false,
    process_cancelled: false,
    resolved_executable_fingerprint: 'gh.exe',
    process_duration_ms: 1200,
  };
}

function makeService(
  receipt: TrustedExecutionReceipt,
  observations: ReadbackObservationEnvelope[],
) {
  const registry = new OutcomeEvaluatorRegistry();
  registry.register(GITHUB_ISSUE_CLOSE_EVALUATOR);
  return new OutcomeService({
    receiptResolver: makeReceiptResolver([receipt]),
    observationResolver: makeObservationResolver(observations),
    evaluatorRegistry: registry,
    store: new InMemoryOutcomeStore(),
    clock: fixedClock(new Date('2026-08-15T00:06:00.000Z')),
  });
}

describe('github.issue.close capability policy', () => {
  it('declares reversible_write / medium / L2 / reversible and mandates approval', () => {
    const capability = GITHUB_ISSUE_CLOSE_CAPABILITY;
    expect(capability.id).toBe('github.issue.close');
    expect(capability.version).toBe('1.0.0');
    expect(capability.side_effect_class).toBe('reversible_write');
    expect(capability.risk_level).toBe('medium');
    expect(capability.required_authority).toBe('L2');
    expect(capability.reversible).toBe(true);
    expect(approvalRequired(capability)).toBe(true);
    const snapshot = deriveRiskSnapshot(capability);
    expect(snapshot).toMatchObject({
      side_effect_class: 'reversible_write',
      risk_level: 'medium',
      required_authority: 'L2',
      reversible: true,
    });
  });

  it('declares mandatory evidence for repo + issue state with freshness caps', () => {
    const classes = GITHUB_ISSUE_CLOSE_CAPABILITY.required_evidence.map((r) => r.class_id);
    expect(classes).toEqual(expect.arrayContaining(['repository.current_state', 'issue.current_state']));
    for (const requirement of GITHUB_ISSUE_CLOSE_CAPABILITY.required_evidence) {
      expect(requirement.mandatory).toBe(true);
      expect(requirement.freshness_policy?.max_age_ms).toBeGreaterThan(0);
    }
  });

  it('binds github.issue.read as the verification capability', () => {
    expect(GITHUB_ISSUE_CLOSE_CAPABILITY.verification_capability).toBe('github.issue.read');
  });
});

describe('github.issue.close deterministic evaluator', () => {
  it('derives the expectation only from the approved plan (no caller authority keys)', () => {
    const plan = closePlan();
    const expectation = GITHUB_ISSUE_CLOSE_EVALUATOR.deriveExpectation(plan);
    expect(expectation.subject_key).toBe(SUBJECT);
    expect(expectation.assertions).toEqual({
      owner: OWNER,
      repo: REPO,
      number: ISSUE_NUMBER,
      state: 'CLOSED',
    });
    expect(Object.keys(expectation)).not.toEqual(expect.arrayContaining(['expected_state', 'predicate', 'regex']));
  });

  it('VERIFIED only when the exact issue number reads back CLOSED', () => {
    const plan = closePlan();
    const expectation = GITHUB_ISSUE_CLOSE_EVALUATOR.deriveExpectation(plan);
    expect(GITHUB_ISSUE_CLOSE_EVALUATOR.evaluate(expectation, observation({ state: 'CLOSED' })).status).toBe('verified');
    expect(GITHUB_ISSUE_CLOSE_EVALUATOR.evaluate(expectation, observation({ state: 'OPEN' })).status).toBe('mismatch');
    expect(GITHUB_ISSUE_CLOSE_EVALUATOR.evaluate(expectation, observation({ number: 99 })).status).toBe('mismatch');
    expect(GITHUB_ISSUE_CLOSE_EVALUATOR.evaluate(expectation, observation({ state: 'closed' })).status).toBe('mismatch');
  });

  it('ignores process metadata entirely: exit0 + OPEN -> mismatch, exit1/timeout/cancel + CLOSED -> verified', () => {
    const plan = closePlan();
    const expectation = GITHUB_ISSUE_CLOSE_EVALUATOR.deriveExpectation(plan);
    for (const processShape of [
      { process_exit_code: 0, process_timed_out: false, process_cancelled: false, state: 'OPEN' },
      { process_exit_code: 7, process_timed_out: false, process_cancelled: false, state: 'CLOSED' },
      { process_exit_code: null, process_timed_out: true, process_cancelled: false, state: 'CLOSED' },
      { process_exit_code: null, process_timed_out: false, process_cancelled: true, state: 'CLOSED' },
    ] as const) {
      const obs = { ...observation({ state: processShape.state }) };
      (obs as unknown as Record<string, unknown>).process_exit_code = processShape.process_exit_code;
      obs.process_timed_out = processShape.process_timed_out;
      obs.process_cancelled = processShape.process_cancelled;
      const expected = processShape.state === 'CLOSED' ? 'verified' : 'mismatch';
      expect(GITHUB_ISSUE_CLOSE_EVALUATOR.evaluate(expectation, obs).status).toBe(expected);
    }
  });

  it('returns inconclusive when the payload cannot establish the post-state', () => {
    const plan = closePlan();
    const expectation = GITHUB_ISSUE_CLOSE_EVALUATOR.deriveExpectation(plan);
    const malformed = { ...observation() } as unknown as Record<string, unknown>;
    malformed.payload = { title: 'no state here' };
    expect(GITHUB_ISSUE_CLOSE_EVALUATOR.evaluate(expectation, malformed as never).status).toBe('inconclusive');
  });
});

describe('close outcome loop (fake resolvers, no network)', () => {
  it('exit0 -> PENDING before read-back -> VERIFIED after CLOSED read-back', async () => {
    const receipt = closeReceipt('process_succeeded');
    const obs = observation({ state: 'CLOSED' });
    const service = makeService(receipt, [obs]);
    const plan = closePlan();
    const outcome = await service.openOutcome({ plan, receipt_id: receipt.receipt_id });
    expect(outcome.verification_status).toBe('pending');
    const begun = await service.beginVerificationAttempt(outcome.outcome_id, {
      attempt_id: 'att-close-0001',
      started_at: obs.attempt_started_at,
    });
    const final = await service.completeVerificationAttempt({
      outcome_id: outcome.outcome_id,
      attempt_id: begun.attempt_id,
      observation_id: obs.observation_id,
    });
    expect(final.verification_status).toBe('verified');
    expect(final.revisit_required).toBe(false);
  });

  it('exit0 but read-back OPEN -> MISMATCH (stdout/exit0 can never verify)', async () => {
    const receipt = closeReceipt('process_succeeded');
    const obs = observation({ state: 'OPEN' });
    const service = makeService(receipt, [obs]);
    const outcome = await service.openOutcome({ plan: closePlan(), receipt_id: receipt.receipt_id });
    const begun = await service.beginVerificationAttempt(outcome.outcome_id, {
      attempt_id: 'att-close-0001',
      started_at: obs.attempt_started_at,
    });
    const final = await service.completeVerificationAttempt({
      outcome_id: outcome.outcome_id,
      attempt_id: begun.attempt_id,
      observation_id: obs.observation_id,
    });
    expect(final.verification_status).toBe('pending');
    expect(final.verification_attempts[0].status).toBe('mismatch');
  });

  it('cross-plan / cross-receipt / cross-subject / wrong capability all reject', async () => {
    const receipt = closeReceipt();
    const plan = closePlan();
    const cases: Array<[ReadbackObservationEnvelope, string]> = [
      [observation({ originPlanId: 'plan-close-9999' }), 'OUTCOME_PLAN_MISMATCH'],
      [observation({ originReceiptId: 'rcpt-close-9999' }), 'OUTCOME_RECEIPT_MISMATCH'],
      [observation({ subjectKey: 'issue:guo6x/Omni-context#99' }), 'OUTCOME_SUBJECT_MISMATCH'],
      [observation({ capabilityId: 'github.pr.read' }), 'OUTCOME_VERIFICATION_CAPABILITY_MISMATCH'],
    ];
    for (const [obs, code] of cases) {
      const service = makeService(receipt, [obs]);
      const outcome = await service.openOutcome({ plan, receipt_id: receipt.receipt_id });
      const begun = await service.beginVerificationAttempt(outcome.outcome_id, {
        attempt_id: 'att-close-0001',
        started_at: obs.attempt_started_at,
      });
      await expect(
        service.completeVerificationAttempt({
          outcome_id: outcome.outcome_id,
          attempt_id: begun.attempt_id,
          observation_id: obs.observation_id,
        }),
      ).rejects.toThrowError(expect.objectContaining({ code }));
    }
  });

  it('stale observation can never verify (future observed_at rejected)', async () => {
    const receipt = closeReceipt();
    const obs = observation({ state: 'CLOSED', observedAt: new Date('2031-01-01T00:00:00.000Z') });
    const service = makeService(receipt, [obs]);
    const outcome = await service.openOutcome({ plan: closePlan(), receipt_id: receipt.receipt_id });
    const begun = await service.beginVerificationAttempt(outcome.outcome_id, {
      attempt_id: 'att-close-0001',
      started_at: obs.attempt_started_at,
    });
    await expect(
      service.completeVerificationAttempt({
        outcome_id: outcome.outcome_id,
        attempt_id: begun.attempt_id,
        observation_id: obs.observation_id,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'OUTCOME_FRESHNESS_INVALID' }));
  });

  it('duplicate observation is rejected; one outcome per (plan, receipt)', async () => {
    const receipt = closeReceipt();
    const obs = observation({ state: 'OPEN' });
    const replay = { ...obs, verification_attempt_id: 'att-close-0002' };
    // Stateful trusted resolver: the replayed envelope is returned only when
    // the second attempt asks for it (same observation id, different attempt).
    let call = 0;
    const registry = new OutcomeEvaluatorRegistry();
    registry.register(GITHUB_ISSUE_CLOSE_EVALUATOR);
    const service = new OutcomeService({
      receiptResolver: makeReceiptResolver([receipt]),
      observationResolver: (observationId) => {
        call += 1;
        return call === 1 ? obs : replay;
      },
      evaluatorRegistry: registry,
      store: new InMemoryOutcomeStore(),
      clock: fixedClock(new Date('2026-08-15T00:06:00.000Z')),
    });
    const plan = closePlan();
    const outcome = await service.openOutcome({ plan, receipt_id: receipt.receipt_id });
    await expect(
      service.openOutcome({ plan, receipt_id: receipt.receipt_id }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'OUTCOME_DUPLICATE_RECORD' }));
    const begun = await service.beginVerificationAttempt(outcome.outcome_id, {
      attempt_id: 'att-close-0001',
      started_at: obs.attempt_started_at,
    });
    await service.completeVerificationAttempt({
      outcome_id: outcome.outcome_id,
      attempt_id: begun.attempt_id,
      observation_id: obs.observation_id,
    });
    const begun2 = await service.beginVerificationAttempt(outcome.outcome_id, {
      attempt_id: 'att-close-0002',
      started_at: obs.attempt_started_at,
    });
    await expect(
      service.completeVerificationAttempt({
        outcome_id: outcome.outcome_id,
        attempt_id: begun2.attempt_id,
        observation_id: replay.observation_id,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'OUTCOME_DUPLICATE_OBSERVATION' }));
  });

  it('caller expectation override is impossible (strict plan schema)', () => {
    expect(() => closePlan({ expected_state: 'CLOSED' } as never)).toThrow();
    expect(() => closePlan({ predicate: 'x' } as never)).toThrow();
    expect(() => closePlan({ verification_plan: { verification_capability_id: 'github.pr.read', verification_inputs: { owner: OWNER, repo: REPO, number: ISSUE_NUMBER }, judge_prompt: 'say verified' } } as never)).toThrow();
  });
});

describe('approval trust (close capability)', () => {
  const nativeGrant = {
    approval_id: 'apr-native-1',
    plan_id: CLOSE_PLAN_ID,
    granted_by: 'guo6x',
    granted_at: '2026-08-15T00:04:00.000Z',
    expires_at: '2026-08-15T00:15:00.000Z',
    policy_version: 'goal24-approval-policy-v1',
    token_reference: 'grant_0123456789abcdef0123456789abcdef',
    token_digest: 'a'.repeat(64),
    actor_id: 'guo6x',
    actor_kind: 'owner',
    actor_authority: 'L3',
  };

  const reference = {
    approval_id: 'apr-native-1',
    plan_id: CLOSE_PLAN_ID,
    granted_by: 'guo6x',
    granted_at: '2026-08-15T00:04:00.000Z',
    policy_version: 'goal24-approval-policy-v1',
    token_reference: 'grant_0123456789abcdef0123456789abcdef',
    token_digest: 'a'.repeat(64),
  };

  it('valid native grant verifies; forged token / wrong plan / wrong policy are rejected', () => {
    const verifier = makeNativeGrantVerifier(nativeGrant);
    const ok = verifier.verifyGrant({ plan: { plan_id: CLOSE_PLAN_ID }, approval_reference: reference, approval_binding_digest: 'x'.repeat(64) });
    expect(ok.valid).toBe(true);
    const forged = verifier.verifyGrant({
      plan: { plan_id: CLOSE_PLAN_ID },
      approval_reference: { ...reference, token_digest: 'b'.repeat(64) },
      approval_binding_digest: 'x'.repeat(64),
    });
    expect(forged).toEqual({ valid: false, reason: 'grant token_digest mismatch' });
    const wrongPlan = verifier.verifyGrant({
      plan: { plan_id: CLOSE_PLAN_ID },
      approval_reference: { ...reference, plan_id: 'plan-close-9999' },
      approval_binding_digest: 'x'.repeat(64),
    });
    expect(wrongPlan.valid).toBe(false);
    const wrongPolicy = verifier.verifyGrant({
      plan: { plan_id: CLOSE_PLAN_ID },
      approval_reference: { ...reference, policy_version: 'other-policy-v9' },
      approval_binding_digest: 'x'.repeat(64),
    });
    expect(wrongPolicy.valid).toBe(false);
  });
});

describe('trusted bridge tamper detection', () => {
  const nativeReceipt = {
    receipt_id: 'rcpt_a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5',
    plan_id: CLOSE_PLAN_ID,
    decision_id: 'decision-close-0001',
    capability_id: 'github.issue.close',
    capability_version: '1.0.0',
    adapter_id: 'github-cli',
    binding_id: 'github-cli.issue.close',
    normalized_inputs_digest: 'a'.repeat(64),
    verification_plan_digest: 'b'.repeat(64),
    verification_capability_id: 'github.issue.read',
    verification_inputs: { owner: OWNER, repo: REPO, number: ISSUE_NUMBER },
    execution_state: 'completed',
    accepted_at: '2026-08-15T00:04:00.000Z',
    spawn_started_at: '2026-08-15T00:04:01.000Z',
    finished_at: '2026-08-15T00:04:02.000Z',
    exit_code: 0,
    timed_out: false,
    cancelled: false,
    source: 'native_broker',
    receipt_digest: '',
  };

  function withValidDigest(): Record<string, unknown> {
    const identity = {
      receipt_id: nativeReceipt.receipt_id,
      plan_id: nativeReceipt.plan_id,
      decision_id: nativeReceipt.decision_id,
      capability_id: nativeReceipt.capability_id,
      capability_version: nativeReceipt.capability_version,
      adapter_id: nativeReceipt.adapter_id,
      binding_id: nativeReceipt.binding_id,
      normalized_inputs_digest: nativeReceipt.normalized_inputs_digest,
      verification_plan_digest: nativeReceipt.verification_plan_digest,
      verification_capability_id: nativeReceipt.verification_capability_id,
      verification_inputs: nativeReceipt.verification_inputs,
      accepted_at: nativeReceipt.accepted_at,
      source: nativeReceipt.source,
    };
    return { ...nativeReceipt, receipt_digest: sha256Hex(canonicalJson(identity)) };
  }

  it('a forged native receipt (tampered identity) never materializes', () => {
    const good = withValidDigest();
    const materialized = materializeReceipt(good);
    expect(materialized.narrow.execution_state).toBe('process_succeeded');
    const tampered = { ...good, plan_id: 'plan-close-9999' };
    expect(() => materializeReceipt(tampered)).toThrow(/tampered/);
    const tamperedDigest = { ...good, receipt_digest: 'f'.repeat(64) };
    expect(() => materializeReceipt(tamperedDigest)).toThrow(/tampered/);
  });

  it('a forged observation (tampered payload digest) never resolves', () => {
    const obs = observation({ state: 'CLOSED' });
    const forged = {
      ...obs,
      payload_digest: 'e'.repeat(64),
    } as unknown as Record<string, unknown>;
    expect(() => makeObservationResolver(forged)).toThrow();
  });
});

describe('no-effect precondition', () => {
  it('an already-CLOSED issue must never be closed again', () => {
    expect(closePrecondition('OPEN')).toBe('proceed');
    expect(closePrecondition('CLOSED')).toBe('no_effect_required');
    expect(closePrecondition('closed')).toBe('no_effect_required');
    expect(closePrecondition(undefined)).toBe('no_effect_required');
  });
});
