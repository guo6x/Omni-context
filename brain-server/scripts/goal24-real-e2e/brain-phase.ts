/**
 * Goal24 Post-CP8 Real E2E (DRG-2 candidate) - Brain phase of the dev-only
 * operator harness.
 *
 * prepare: evidence guard -> decision -> authorization -> approval request;
 *          exports the approved decision output to the bridge.
 * verify:  applies the native-issued grant, opens the CP8 Outcome, proves
 *          PENDING before read-back and VERIFIED only after the trusted
 *          deterministic evaluator observes state=CLOSED.
 *
 * Run with tsx:
 *   npx tsx scripts/goal24-real-e2e/brain-phase.ts prepare --owner guo6x --repo Omni-context --issue N
 *   npx tsx scripts/goal24-real-e2e/brain-phase.ts verify
 */

import { randomUUID } from 'node:crypto';
import initDatabase from '../../src/db/sqlite.js';
import {
  EvidenceEligibilityService,
  EvidenceProviderRegistry,
  EvidenceSurfaceRuntime,
  GuardRunStore,
  QualifiedEvidenceStore,
  githubSubjectResolverRegistry,
} from '../../src/evidence/index.js';
import {
  AuthorizationService,
  AuthorizationStore,
} from '../../src/approval/index.js';
import {
  GITHUB_ISSUE_CLOSE_CAPABILITY,
} from '../../src/capabilities/github-write.js';
import { GITHUB_READONLY_CAPABILITIES } from '../../src/capabilities/github-readonly.js';
import { SaveDecisionSchema } from '../../src/mcp-tools.js';
import { buildDecisionMetadata } from '../../src/decision/decision-store.js';
import {
  InMemoryOutcomeStore,
  OutcomeEvaluatorRegistry,
  OutcomeService,
} from '../../src/outcome/index.js';
import { GITHUB_ISSUE_CLOSE_EVALUATOR } from '../../src/outcome/evaluators/github-issue-close-evaluator.js';
import {
  makeNativeGrantVerifier,
  makeObservationResolver,
  makeReceiptResolver,
  materializeReceipt,
  readBridge,
  writeBridge,
} from './bridge.js';
import { GithubNativeEvidenceProvider } from './github-native-provider.js';

function capabilityLookup(capabilityId: string) {
  if (capabilityId === GITHUB_ISSUE_CLOSE_CAPABILITY.id) return GITHUB_ISSUE_CLOSE_CAPABILITY;
  return GITHUB_READONLY_CAPABILITIES.find((capability) => capability.id === capabilityId);
}

function closeSubjectResolver() {
  return (_capabilityId: string, inputs: Record<string, unknown>) => {
    const owner = String(inputs.owner);
    const repo = String(inputs.repo);
    const number = Number(inputs.number);
    if (!Number.isInteger(number) || number <= 0) {
      throw new Error('close subject requires a positive integer number');
    }
    return `github:issue:${owner}/${repo}#${number}`;
  };
}

function parseArgs(argv: string[]): { mode: string; owner: string; repo: string; number: number } {
  const mode = argv[2] ?? '';
  const flags: Record<string, string> = {};
  for (let i = 3; i < argv.length; i += 2) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[i + 1] ?? '';
  }
  return {
    mode,
    owner: flags.owner ?? process.env.OMNI_REAL_E2E_OWNER ?? '',
    repo: flags.repo ?? process.env.OMNI_REAL_E2E_REPO ?? '',
    number: Number(flags.issue ?? process.env.OMNI_REAL_E2E_ISSUE ?? '0'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.mode === 'prepare') {
    await prepare(args);
  } else if (args.mode === 'verify') {
    await verify();
  } else {
    throw new Error('usage: brain-phase.ts prepare|verify --owner <o> --repo <r> --issue <n>');
  }
}

async function prepare(args: { owner: string; repo: string; number: number }): Promise<void> {
  if (!args.owner || !args.repo || !Number.isInteger(args.number) || args.number <= 0) {
    throw new Error('--owner/--repo/--issue are required (issue must be a positive integer)');
  }
  const runId = `real-e2e-${randomUUID().slice(0, 8)}`;
  const normalizedInputs = { owner: args.owner, repo: args.repo, number: args.number };

  // ---- STEP 1-2: trusted evidence (live GitHub) -> CP6 guard ----
  const providers = new EvidenceProviderRegistry();
  providers.register(new GithubNativeEvidenceProvider());
  const subjectResolvers = githubSubjectResolverRegistry();
  subjectResolvers.register('github.issue.close', closeSubjectResolver() as never);
  const guardRunStore = new GuardRunStore();
  const qualifiedEvidenceStore = new QualifiedEvidenceStore();
  // CP6 V1 qualification rejects provider timestamps that are later than
  // the runtime's PRE-collection clock capture, which any live fetch is
  // (by milliseconds). The harness therefore runs the trusted evidence
  // clock 30s ahead of wall time: live-fetched observations qualify while
  // every max_age bound (5m / 24h) stays meaningful. Documented harness
  // behavior only; the production runtime wiring is unchanged.
  const evidenceRuntime = new EvidenceSurfaceRuntime({
    capabilityLookup,
    providers,
    subjectResolvers,
    guardRunStore,
    qualifiedEvidenceStore,
    clock: () => new Date(Date.now() + 30_000),
  });
  const evaluation = await evidenceRuntime.evaluateForCapability({
    capability_id: GITHUB_ISSUE_CLOSE_CAPABILITY.id,
    capability_version: GITHUB_ISSUE_CLOSE_CAPABILITY.version,
    normalized_inputs: normalizedInputs,
    correlation_id: runId,
  });
  console.log('[real-e2e] STEP 1: live GitHub read qualified (classes:', evaluation.requested_classes.join(', '), ')');
  console.log('[real-e2e] STEP 2: Evidence Guard action =', evaluation.action, 'reason =', evaluation.reason_codes.join(','));
  if (evaluation.action !== 'proceed') {
    throw new Error(`evidence guard blocked the close: ${evaluation.action}`);
  }
  const issueEntry = evaluation.final_coverage.entries.find(
    (entry) => entry.evidence_class === 'issue.current_state',
  );
  console.log('[real-e2e] STEP 1: issue.current_state coverage =', issueEntry?.status);

  // ---- STEP 3: decision binding ----
  const db = initDatabase({ dbPath: ':memory:' });
  await db.runMigrations();
  const decisionInput = SaveDecisionSchema.parse({
    situation: `User explicitly requested closing GitHub issue ${args.owner}/${args.repo}#${args.number}.`,
    conclusion: `Close issue ${args.owner}/${args.repo}#${args.number} through the approval-gated github.issue.close capability.`,
    decision_question: `Should Omni-Context close issue ${args.owner}/${args.repo}#${args.number}?`,
    goals: ['close the exact issue the user named'],
    hard_constraints: ['exact subject identity owner/repo#number', 'approval required', 'read-back verification required'],
    assumptions: ['the user intent is explicit'],
    uncertainties: ['external state can change between read and close'],
    expected_outcomes: [`issue ${args.owner}/${args.repo}#${args.number} becomes CLOSED`],
    risks: ['closing a wrong issue'],
    confidence: 'high',
  });
  const decisionEntity = await db.addEntity({
    name: `Close ${args.owner}/${args.repo}#${args.number}`,
    type: 'decision',
    description: decisionInput.conclusion,
    tags: ['decision', 'goal24-real-e2e'],
    metadata: buildDecisionMetadata(decisionInput),
  });
  console.log('[real-e2e] STEP 3: decision bound: decision_id =', decisionEntity.id);
  await db.close();

  // ---- STEP 4: authorization -> approval REQUIRED ----
  const eligibility = new EvidenceEligibilityService({
    guardRunStore,
    qualifiedEvidenceStore,
    capabilityLookup,
    subjectResolvers,
  });
  const authorization = new AuthorizationService({
    capabilityLookup,
    evidenceEligibility: eligibility,
    grantVerifier: makeNativeGrantVerifier({}),
    store: new AuthorizationStore(),
  });
  const authorizationResult = authorization.authorize({
    decision_id: decisionEntity.id,
    capability_id: GITHUB_ISSUE_CLOSE_CAPABILITY.id,
    capability_version: GITHUB_ISSUE_CLOSE_CAPABILITY.version,
    adapter_id: 'github-cli',
    normalized_inputs: normalizedInputs,
    guard_run_id: evaluation.guard_run_id,
    timeout_ms: 60_000,
    verification_plan: {
      verification_capability_id: 'github.issue.read',
      verification_inputs: normalizedInputs,
    },
    rollback_plan: null,
    requested_by: 'goal24-real-e2e-operator',
    correlation_id: runId,
  });
  console.log('[real-e2e] STEP 4: APPROVAL REQUIRED =', authorizationResult.required_approval);
  console.log('[real-e2e] STEP 4: plan created:', authorizationResult.plan.plan_id, 'state =', authorizationResult.plan.state);
  if (!authorizationResult.required_approval || !authorizationResult.approval_request) {
    throw new Error('github.issue.close must require approval by policy');
  }

  // ---- export the decision output for the native phase ----
  const plan = authorizationResult.plan;
  writeBridge('brain-before.json', {
    run_id: runId,
    plan,
    plan_id: plan.plan_id,
    decision_id: plan.decision_id,
    capability_id: plan.capability_id,
    capability_version: plan.capability_version,
    adapter_id: plan.adapter_id,
    normalized_inputs: plan.normalized_inputs,
    verification_plan: plan.verification_plan,
    evidence_coverage_snapshot: plan.evidence_coverage_snapshot,
    timeout_ms: plan.timeout_ms,
    created_at: plan.created_at,
    expires_at: plan.expires_at ?? null,
    correlation_id: plan.correlation_id ?? null,
    requested_by: plan.requested_by ?? null,
    approval_request_id: authorizationResult.approval_request.approval_request_id,
    approval_request: authorizationResult.approval_request,
    approval_binding_digest: authorizationResult.approval_binding_digest,
    required_approval: authorizationResult.required_approval,
    guard_run_id: evaluation.guard_run_id,
    evidence: {
      action: evaluation.action,
      rounds_used: evaluation.rounds_used,
      final_coverage: evaluation.final_coverage,
      reason_codes: evaluation.reason_codes,
    },
  });
  console.log('[real-e2e] Brain prepare phase complete; bridge written (brain-before.json)');
  console.log('[real-e2e] NEXT: run the native phase (approval artifact required), then `verify`.');
}

async function verify(): Promise<void> {
  const brain = readBridge<Record<string, unknown>>('brain-before.json');
  const native = readBridge<Record<string, unknown>>('native-after.json');
  const runId = String(brain.run_id ?? 'real-e2e');

  // ---- apply the native-issued grant (CP7 verified grant path) ----
  const guardRunStore = new GuardRunStore();
  const qualifiedEvidenceStore = new QualifiedEvidenceStore();
  const subjectResolvers = githubSubjectResolverRegistry();
  subjectResolvers.register('github.issue.close', closeSubjectResolver() as never);
  const eligibility = new EvidenceEligibilityService({
    guardRunStore,
    qualifiedEvidenceStore,
    capabilityLookup,
    subjectResolvers,
  });
  const nativeGrant = native.grant as Record<string, unknown>;
  const planId = String(brain.plan_id);
  // Rebuild the server-owned authorization record from the prepare-phase
  // export (the Brain store is memory-only; the harness bridge carries the
  // record across phases - it is validated by the strict schema + the
  // native-side binding digest before any use).
  const authorizationStore = new AuthorizationStore();
  authorizationStore.put({
    plan: brain.plan as never,
    guard_run_id: String(brain.guard_run_id),
    approval_request_id: String(brain.approval_request_id),
    approval_request: (brain.approval_request ?? null) as never,
    approval_binding_digest: String(brain.approval_binding_digest),
    grant: null,
    blocked_reason: null,
  } as never);
  const authorization2 = new AuthorizationService({
    capabilityLookup,
    evidenceEligibility: eligibility,
    grantVerifier: makeNativeGrantVerifier(nativeGrant),
    store: authorizationStore,
  });
  const reference = {
    approval_id: String(nativeGrant.approval_id),
    plan_id: planId,
    granted_by: String(nativeGrant.granted_by),
    granted_at: String(nativeGrant.granted_at),
    policy_version: String(nativeGrant.policy_version),
    token_reference: String(nativeGrant.token_reference),
    token_digest: String(nativeGrant.token_digest),
  };
  const approved = await authorization2.applyApproval(planId, reference);
  console.log('[real-e2e] STEP 5: owner approval applied -> plan state =', approved.plan.state);
  if (approved.plan.state !== 'ready') {
    throw new Error(`plan did not reach ready state: ${approved.plan.state}`);
  }

  // ---- trusted receipt + observation resolvers (native store records) ----
  const materialized = materializeReceipt(native.receipt as Record<string, unknown>);
  const observation = native.observation as Record<string, unknown>;
  console.log('[real-e2e] trusted receipt materialized:', materialized.narrow.receipt_id, 'effect_state =', materialized.narrow.execution_state);

  // ---- CP8 OutcomeService with the deterministic close evaluator ----
  const registry = new OutcomeEvaluatorRegistry();
  registry.register(GITHUB_ISSUE_CLOSE_EVALUATOR);
  const store = new InMemoryOutcomeStore();
  const service = new OutcomeService({
    receiptResolver: makeReceiptResolver(materialized.narrow) as never,
    observationResolver: makeObservationResolver(observation) as never,
    evaluatorRegistry: registry,
    store,
  });
  const opened = await service.openOutcome({
    plan: approved.plan,
    receipt_id: materialized.narrow.receipt_id,
  });
  console.log('[real-e2e] STEP 7 (demo moment): PROCESS EXIT was 0, but OUTCOME =', opened.verification_status.toUpperCase());
  if (opened.verification_status !== 'pending') {
    throw new Error(`outcome after execution must be pending, got ${opened.verification_status}`);
  }

  const envelope = observation as never;
  const begun = await service.beginVerificationAttempt(opened.outcome_id, {
    attempt_id: String(native.attempt_id),
    started_at: envelope.attempt_started_at,
  });
  const finalized = await service.completeVerificationAttempt({
    outcome_id: opened.outcome_id,
    attempt_id: begun.attempt_id,
    observation_id: String(native.observation_id),
  });
  const readbackState = (observation.payload as Record<string, unknown>).state;
  console.log('[real-e2e] STEP 8: independent read-back state =', readbackState);
  console.log('[real-e2e] STEP 9: trusted deterministic evaluator -> FINAL OUTCOME =', finalized.verification_status.toUpperCase());
  console.log('[real-e2e] STEP 10: OutcomeRecord persisted (revisit_required =', finalized.revisit_required, ')');

  writeBridge('brain-after.json', {
    run_id: runId,
    outcome: finalized,
  });
  writeBridge('real-e2e-proof.json', {
    run_id: runId,
    started_at: brain.created_at,
    finished_at: new Date().toISOString(),
    repo: `${brain.normalized_inputs.owner}/${brain.normalized_inputs.repo}`,
    issue_number: brain.normalized_inputs.number,
    decision_id: brain.decision_id,
    plan_id: brain.plan_id,
    approval_id_or_reference: String(nativeGrant.approval_id),
    capability_id: brain.capability_id,
    capability_version: brain.capability_version,
    receipt_id: materialized.narrow.receipt_id,
    process_state: (native.process as Record<string, unknown>).success === true ? 'process_succeeded' : 'process_failed',
    exit_code: (native.process as Record<string, unknown>).exit_code ?? null,
    outcome_before_readback: opened.verification_status,
    observation_id: String(native.observation_id),
    readback_state: readbackState,
    final_outcome: finalized.verification_status,
    revisit_required: finalized.revisit_required,
    guard_action: (brain.evidence as Record<string, unknown>).action,
    all_ids_redacted_if_sensitive: false,
    environment: { gh_auth: 'guo6x (repo scope, HTTPS)', node: process.version },
  });
  console.log('[real-e2e] verify phase complete; proof + outcome persisted.');
}

main().catch((error) => {
  console.error('[real-e2e] BRAIN PHASE FAILED:', error instanceof Error ? error.message : error);
  if (error instanceof Error && error.stack) console.error(error.stack);
  process.exit(1);
});
