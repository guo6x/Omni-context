/**
 * Controlled, local-only D1B-1 approval fixture.
 *
 * It exists solely for the explicitly opted-in Desktop closure run. It never
 * exposes an HTTP/MCP/Tauri route and performs no broker execution, GitHub
 * access, receipt creation, read-back or outcome work. Its plans are created
 * through the normal CP6 EvidenceSurfaceRuntime and CP7
 * AuthorizationService, not by writing authorization records directly.
 */

import type { EvidenceProviderV1 } from '../evidence/index.js';
import { EvidenceProviderRegistry } from '../evidence/index.js';
import type { ProductionAuthorizationRuntime } from './production-runtime.js';

const FIXTURE_CAPABILITY_ID = 'github.issue.close';
const FIXTURE_CAPABILITY_VERSION = '1.0.0';
const FIXTURE_INPUTS = { owner: 'fixture-owner', repo: 'fixture-repo', number: 1 };
const FIXTURE_SUBJECT = 'github:issue:fixture-owner/fixture-repo#1';

export interface D1b1ControlledFixturePlan {
  plan_id: string;
  plan_state: 'awaiting_approval';
  approval_request_status: 'pending';
  approval_request_id: string;
}

export interface D1b1ControlledFixtureResult {
  fixture: 'D1B1_CONTROLLED_LOCAL_ONLY';
  creation_path: 'EvidenceSurfaceRuntime.evaluateForCapability -> AuthorizationService.authorize';
  primary: D1b1ControlledFixturePlan;
  concurrency: D1b1ControlledFixturePlan;
  execution_started: false;
  github_writes: 0;
  receipts_created: 0;
  readback_started: false;
  outcome_finalized: false;
}

/** Trusted application fixture provider for the closure process only. */
export function createD1b1ControlledFixtureProviders(clock: () => Date): EvidenceProviderRegistry {
  // Each controlled collection is a fresh trusted observation. The evidence
  // ledger intentionally rejects reusing one source id with a changed
  // observed_at, so the fixture gives each observation a server-owned,
  // monotonic source id rather than weakening lineage conflict detection.
  let collectionSequence = 0;
  const provider: EvidenceProviderV1 = {
    metadata: {
      provider_id: 'd1b1-controlled-cp6-fixture',
      version: '1.0.0',
      supported_classes: ['repository.current_state', 'issue.current_state'],
      priority: 100,
      max_verification_level: 'asserted',
      description: 'Controlled local D1B-1 CP6 fixture; network and execution are disabled.',
    },
    async collect(request) {
      const claim = request.evidence_class === 'repository.current_state'
        ? { name_with_owner: 'fixture-owner/fixture-repo', private: true, archived: false }
        : { number: 1, state: 'OPEN' };
      return {
        outcome: 'collected',
        diagnostics: [],
        candidates: [{
          evidence_class: request.evidence_class,
          subject_key: FIXTURE_SUBJECT,
          claim_key: request.evidence_class,
          claim_value: claim,
          source_item_id: `fixture:${request.evidence_class}:${++collectionSequence}`,
          source_reference: 'd1b1-controlled-local-fixture',
          observed_at: clock().toISOString(),
          verification_level: 'asserted',
        }],
      };
    },
  };
  const providers = new EvidenceProviderRegistry();
  providers.register(provider);
  return providers;
}

async function createAwaitingPlan(
  runtime: ProductionAuthorizationRuntime,
  correlationId: string,
): Promise<D1b1ControlledFixturePlan> {
  const evidence = await runtime.evidenceRuntime.evaluateForCapability({
    capability_id: FIXTURE_CAPABILITY_ID,
    capability_version: FIXTURE_CAPABILITY_VERSION,
    normalized_inputs: FIXTURE_INPUTS,
    correlation_id: correlationId,
  });
  if (evidence.action !== 'proceed') {
    throw new Error(`D1B1_FIXTURE_EVIDENCE_NOT_PROCEED:${evidence.action}`);
  }
  const authorization = runtime.authorizationService.authorize({
    decision_id: `d1b1-controlled-fixture-${correlationId}`,
    capability_id: FIXTURE_CAPABILITY_ID,
    capability_version: FIXTURE_CAPABILITY_VERSION,
    adapter_id: 'github-cli',
    normalized_inputs: FIXTURE_INPUTS,
    guard_run_id: evidence.guard_run_id,
    timeout_ms: 60_000,
    verification_plan: {
      verification_capability_id: 'github.issue.read',
      verification_inputs: FIXTURE_INPUTS,
    },
    rollback_plan: null,
    requested_by: 'd1b1-controlled-fixture',
    correlation_id: correlationId,
  });
  if (
    authorization.plan.state !== 'awaiting_approval'
    || authorization.approval_request?.status !== 'pending'
  ) {
    throw new Error('D1B1_FIXTURE_PLAN_NOT_AWAITING_APPROVAL');
  }
  return {
    plan_id: authorization.plan.plan_id,
    plan_state: authorization.plan.state,
    approval_request_status: authorization.approval_request.status,
    approval_request_id: authorization.approval_request.approval_request_id,
  };
}

/** Create the two real CP6/CP7 plans needed by the controlled approval run. */
export async function createD1b1ControlledFixture(
  runtime: ProductionAuthorizationRuntime,
): Promise<D1b1ControlledFixtureResult> {
  const primary = await createAwaitingPlan(runtime, 'primary');
  const concurrency = await createAwaitingPlan(runtime, 'concurrency');
  return {
    fixture: 'D1B1_CONTROLLED_LOCAL_ONLY',
    creation_path: 'EvidenceSurfaceRuntime.evaluateForCapability -> AuthorizationService.authorize',
    primary,
    concurrency,
    execution_started: false,
    github_writes: 0,
    receipts_created: 0,
    readback_started: false,
    outcome_finalized: false,
  };
}
