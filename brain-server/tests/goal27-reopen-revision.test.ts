/**
 * Goal27 controlled-local lifecycle proof.  These tests intentionally use
 * the real CP6 evidence runtime, CP7 authorization service, CP8 outcome
 * runtime, same decision kernel and SQLite migration.  Providers/receipts are
 * deterministic in-memory fixtures; no GitHub, native broker or process write
 * is invoked.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import initDatabase, { type Database } from '../src/db/sqlite.js';
import { createProductionAuthorizationRuntime } from '../src/approval/production-runtime.js';
import { ServerVerificationRuntime } from '../src/control/verification-runtime.js';
import {
  EvidenceProviderRegistry,
  type EvidenceCollectRequest,
  type EvidenceProviderV1,
} from '../src/evidence/index.js';
import {
  observationPayloadDigest,
  normalizedInputsDigest,
  recomputeReceiptDigest,
  verificationPlanDigest,
  type ReadbackObservationEnvelope,
  type TrustedExecutionReceipt,
} from '../src/outcome/index.js';
import { DecisionRevisionService } from '../src/revision/service.js';
import { RevisionError } from '../src/revision/errors.js';
import { SqliteDecisionRevisionStore } from '../src/revision/store.js';
import type { DecisionRevisionRecord } from '../src/revision/contracts.js';
import type { ExecutionPlan } from '../src/execution/contracts.js';
import { createServer } from '../src/api/routes.js';
import { AgentPilotAdapter } from '../src/agent/pilot.js';
import { canonicalJson } from '../src/evidence/model.js';
import { sha256Hex } from '../src/evidence/index.js';

const NOW = new Date('2026-09-04T08:00:00.000Z');
const INPUTS = { owner: 'fixture-owner', repo: 'fixture-repo', number: 1 };
const ACTOR = { actor_id: 'local-owner' as const, actor_kind: 'owner' as const, scope: 'control:reopen' as const };

type EvidenceMode = 'qualified' | 'missing';

interface Fixture {
  db: Database;
  dbPath: string;
  tempDir: string | null;
  runtime: ReturnType<typeof createProductionAuthorizationRuntime>;
  revisions: DecisionRevisionService;
  store: SqliteDecisionRevisionStore;
  setEvidenceMode: (mode: EvidenceMode) => void;
  createObservedDecision: (status: 'MISMATCH' | 'VERIFIED' | 'INCONCLUSIVE') => Promise<ExecutionPlan>;
  close: () => Promise<void>;
}

function controlledProvider(clock: () => Date): { providers: EvidenceProviderRegistry; setMode: (mode: EvidenceMode) => void } {
  let mode: EvidenceMode = 'qualified';
  let sequence = 0;
  const provider: EvidenceProviderV1 = {
    metadata: {
      provider_id: 'goal27-controlled-provider',
      version: '1.0.0',
      supported_classes: ['repository.current_state', 'issue.current_state'],
      priority: 100,
      max_verification_level: 'asserted',
      description: 'Goal27 controlled local-only evidence fixture.',
    },
    async collect(request: EvidenceCollectRequest) {
      if (mode === 'missing') {
        return { outcome: 'not_found' as const, candidates: [], diagnostics: [] };
      }
      const claim = request.evidence_class === 'repository.current_state'
        ? { name_with_owner: 'fixture-owner/fixture-repo', private: true, archived: false }
        : { number: 1, state: 'OPEN' };
      return {
        outcome: 'collected' as const,
        candidates: [{
          evidence_class: request.evidence_class,
          subject_key: 'github:issue:fixture-owner/fixture-repo#1',
          claim_key: request.evidence_class,
          claim_value: claim,
          source_item_id: `goal27:${request.evidence_class}:${++sequence}`,
          source_reference: 'goal27-controlled-local-fixture',
          observed_at: clock().toISOString(),
          verification_level: 'asserted' as const,
        }],
        diagnostics: [],
      };
    },
  };
  const providers = new EvidenceProviderRegistry();
  providers.register(provider);
  return { providers, setMode: (next) => { mode = next; } };
}

function receiptFor(plan: ExecutionPlan): TrustedExecutionReceipt {
  const draft: TrustedExecutionReceipt = {
    receipt_id: `receipt-goal27-${plan.plan_id.slice(-12)}`,
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

function observationFor(
  plan: ExecutionPlan,
  receipt: TrustedExecutionReceipt,
  status: 'MISMATCH' | 'VERIFIED' | 'INCONCLUSIVE',
): ReadbackObservationEnvelope {
  const payload = status === 'MISMATCH'
    ? { number: 1, state: 'OPEN' }
    : status === 'VERIFIED'
      ? { number: 1, state: 'CLOSED' }
      : { number: 'unparseable' };
  return {
    observation_id: `observation-goal27-${plan.plan_id.slice(-12)}`,
    verification_attempt_id: 'server-generated-attempt',
    origin_plan_id: plan.plan_id,
    origin_execution_receipt_id: receipt.receipt_id,
    verification_capability_id: 'github.issue.read',
    subject_key: 'issue:fixture-owner/fixture-repo#1',
    attempt_started_at: new Date(NOW.getTime() - 500).toISOString(),
    observed_at: NOW.toISOString(),
    verification_source: 'synthetic_test',
    verification_level: 'verified',
    payload,
    payload_digest: observationPayloadDigest(payload),
    truncated: false,
    parser_status: 'parsed',
    source_adapter: 'github-cli',
    source_binding: 'goal27-controlled-readback',
    process_exit_code: 0,
    process_timed_out: false,
    process_cancelled: false,
    resolved_executable_fingerprint: 'goal27-controlled-local',
    process_duration_ms: 1,
  };
}

async function makeFixture(persisted = false): Promise<Fixture> {
  const tempDir = persisted ? await mkdtemp(path.join(os.tmpdir(), 'omni-goal27-')) : null;
  const dbPath = persisted ? path.join(tempDir!, 'goal27.sqlite') : ':memory:';
  const db = initDatabase({ dbPath });
  await db.runMigrations();
  const clock = () => new Date(NOW.getTime());
  const source = controlledProvider(clock);
  const runtime = createProductionAuthorizationRuntime({ providers: source.providers, clock });
  const store = new SqliteDecisionRevisionStore(db);
  const revisions = new DecisionRevisionService({
    store,
    authorizationService: runtime.authorizationService,
    evidenceRuntime: runtime.evidenceRuntime,
    verificationRuntime: runtime.verificationRuntime,
    clock,
  });

  return {
    db,
    dbPath,
    tempDir,
    runtime,
    revisions,
    store,
    setEvidenceMode: source.setMode,
    async createObservedDecision(status) {
      const evidence = await runtime.evidenceRuntime.evaluateForCapability({
        capability_id: 'github.issue.close',
        capability_version: '1.0.0',
        normalized_inputs: INPUTS,
        correlation_id: `goal27-source-${status.toLowerCase()}`,
      });
      expect(evidence.action).toBe('proceed');
      const authorization = runtime.authorizationService.authorize({
        decision_id: `decision-goal27-${status.toLowerCase()}-${runtime.authorizationService.listAuthorizationRecords().length}`,
        capability_id: 'github.issue.close',
        capability_version: '1.0.0',
        adapter_id: 'github-cli',
        normalized_inputs: INPUTS,
        guard_run_id: evidence.guard_run_id,
        timeout_ms: 5_000,
        verification_plan: {
          verification_capability_id: 'github.issue.read',
          verification_inputs: INPUTS,
        },
        // The frozen production catalog deliberately exposes no executable
        // rollback capability. Reopen never manufactures one.
        rollback_plan: null,
        requested_by: 'goal27-controlled-test',
      });
      const receipt = receiptFor(authorization.plan);
      runtime.verificationRuntime.registerControlledCase({
        plan: authorization.plan,
        receipt,
        observation: observationFor(authorization.plan, receipt, status),
      });
      const verified = await runtime.verificationRuntime.verifyPlan(authorization.plan.plan_id);
      expect(verified.status).toBe(status);
      return authorization.plan;
    },
    async close() {
      await db.close();
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
    },
  };
}

const fixtures: Fixture[] = [];
afterEach(async () => {
  while (fixtures.length) await fixtures.pop()!.close();
});

async function fixture(persisted = false): Promise<Fixture> {
  const value = await makeFixture(persisted);
  fixtures.push(value);
  return value;
}

interface AdversarialVector {
  id: string;
  control_ring: string;
  kind: string;
  expected_code: string;
  field?: string;
  request?: unknown;
  decision_id?: string;
  outcome_id?: string;
  actor?: unknown;
  reason?: string;
}

interface AdversarialMatrix {
  schema_version: string;
  lifecycle: string;
  total_vectors: number;
  expected_blocked: number;
  vectors: AdversarialVector[];
}

async function expectedRevisionError(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
    return 'UNEXPECTED_SUCCESS';
  } catch (error) {
    return error instanceof RevisionError ? error.code : `UNEXPECTED_${error instanceof Error ? error.name : 'ERROR'}`;
  }
}

function tamperedRevisionRecord(
  source: DecisionRevisionRecord,
  rootDecisionId: string,
  kind: 'store_self_link' | 'store_root_backlink' | 'store_cross_root' | 'store_duplicate_index',
): DecisionRevisionRecord {
  const record = structuredClone(source);
  const sourceChild = source.new_decision_id!;
  const suffix = kind.replace(/^store_/, '').replaceAll('_', '-');
  record.revision_id = `rev-matrix-${suffix}-0001`;
  record.parent_decision_id = sourceChild;
  record.context.parent_decision_id = sourceChild;
  record.context.original.decision_id = sourceChild;
  record.revision_index = 2;
  record.new_plan_id = `plan-matrix-${suffix}-0001`;
  record.new_decision_id = `decision-matrix-${suffix}-0001`;

  if (kind === 'store_self_link') {
    record.new_decision_id = sourceChild;
  } else if (kind === 'store_root_backlink') {
    record.new_decision_id = rootDecisionId;
  } else if (kind === 'store_cross_root') {
    record.root_decision_id = sourceChild;
    record.parent_decision_id = sourceChild;
    record.context.root_decision_id = sourceChild;
    record.context.parent_decision_id = sourceChild;
    record.context.original.decision_id = sourceChild;
    record.revision_index = 1;
  } else if (kind === 'store_duplicate_index') {
    record.revision_index = 1;
  }

  record.idempotency_digest = sha256Hex(canonicalJson({
    root_decision_id: record.root_decision_id,
    parent_decision_id: record.parent_decision_id,
    trigger_type: record.trigger_type,
    trigger_outcome_id: record.trigger_outcome_id,
    trigger_reason: record.trigger_reason,
    authorized_by: record.authorized_by,
  }));
  record.revision_context_digest = sha256Hex(canonicalJson(record.context));
  return record;
}

describe('Goal27 DecisionRevision lifecycle', () => {
  it('requalifies after a mismatch, preserves history, and never executes or reuses authority', async () => {
    const f = await fixture();
    const originalPlan = await f.createObservedDecision('MISMATCH');
    const originalRecord = f.runtime.authorizationService.getAuthorizationRecord(originalPlan.plan_id)!;
    const immutableBefore = JSON.stringify(originalRecord);
    f.setEvidenceMode('missing');

    const reopened = await f.revisions.reopen({ decision_id: originalPlan.decision_id }, ACTOR);
    const saved = await f.store.getRevision(reopened.revision_id);

    expect(reopened).toMatchObject({
      root_decision_id: originalPlan.decision_id,
      parent_decision_id: originalPlan.decision_id,
      revision_index: 1,
      trigger_type: 'OUTCOME_MISMATCH',
      reopen_execution_count: 0,
      execution_started: false,
      original_write_retried: false,
      automatic_rollback: false,
      old_approval_reused: false,
      old_grant_reused: false,
      old_plan_reused: false,
      new_plan_id: null,
    });
    expect(reopened.new_disposition).not.toBe('DECIDE');
    expect(JSON.stringify(f.runtime.authorizationService.getAuthorizationRecord(originalPlan.plan_id))).toBe(immutableBefore);
    expect(saved?.context.original.outcome.revisit_required).toBe(true);
    expect(saved?.context.current_evidence.guard_run_id).not.toBe(originalRecord.guard_run_id);
    expect(saved?.context.evidence_delta.some((entry) => entry.category === 'MISSING_NOW')).toBe(true);
    expect(saved?.context.decision_kernel_id).toBe('omni-context-evidence-decision-kernel-v1');
    expect(await f.store.listEvents(reopened.revision_id)).toHaveLength(5);
  });

  it('creates a distinct plan and fresh approval lifecycle only when the canonical kernel decides', async () => {
    const f = await fixture();
    const originalPlan = await f.createObservedDecision('MISMATCH');

    const reopened = await f.revisions.reopen({ decision_id: originalPlan.decision_id }, ACTOR);
    const revisedPlan = reopened.new_plan_id
      ? f.runtime.authorizationService.getAuthorizationRecord(reopened.new_plan_id)
      : null;

    expect(reopened.new_disposition).toBe('DECIDE');
    expect(reopened.new_plan_id).not.toBe(originalPlan.plan_id);
    expect(reopened.requires_new_approval).toBe(true);
    expect(revisedPlan).toMatchObject({
      plan: { decision_id: reopened.new_decision_id, state: 'awaiting_approval', approval: null },
      approval_request: { status: 'pending' },
      grant: null,
    });

    if (process.env.OMNI_GOAL27_EMIT_PROOF === '1') {
      const saved = await f.store.getRevision(reopened.revision_id);
      process.stdout.write(`${JSON.stringify({
        marker: 'GOAL27_CONTROLLED_REVISION_PROOF',
        root_decision_id: originalPlan.decision_id,
        revision_id: reopened.revision_id,
        parent_decision_id: reopened.parent_decision_id,
        revision_index: reopened.revision_index,
        trigger_type: reopened.trigger_type,
        trigger_outcome_id: reopened.trigger_outcome_id,
        revision_context_digest: saved?.revision_context_digest,
        revised_decision_id: reopened.new_decision_id,
        revised_disposition: reopened.new_disposition,
        new_plan_id: reopened.new_plan_id,
        requires_new_approval: reopened.requires_new_approval,
        reopen_execution_count: reopened.reopen_execution_count,
      })}\n`);
    }
  });

  it('forces a fresh approval lifecycle for a revised DECIDE even when ordinary policy is approval-free', async () => {
    const f = await fixture();
    const evidence = await f.runtime.evidenceRuntime.evaluateForCapability({
      capability_id: 'github.issue.read',
      capability_version: '1.0.0',
      normalized_inputs: INPUTS,
      correlation_id: 'goal27-low-risk-revision-approval',
    });
    expect(evidence.action).toBe('proceed');
    const request = {
      capability_id: 'github.issue.read',
      capability_version: '1.0.0',
      adapter_id: 'github-cli',
      normalized_inputs: INPUTS,
      guard_run_id: evidence.guard_run_id,
      timeout_ms: 5_000,
      verification_plan: null,
      rollback_plan: null,
    };
    const ordinary = f.runtime.authorizationService.authorize({
      ...request,
      decision_id: 'decision-goal27-low-risk-ordinary',
      requested_by: 'goal27-controlled-test',
    });
    const revised = f.runtime.authorizationService.authorizeRevision({
      ...request,
      decision_id: 'decision-goal27-low-risk-revised',
      requested_by: 'revision-lifecycle',
    });

    expect(ordinary).toMatchObject({
      required_approval: false,
      plan: { state: 'ready', approval: null },
      approval_request: null,
    });
    expect(revised).toMatchObject({
      required_approval: true,
      plan: { state: 'awaiting_approval', approval: null },
      approval_request: { decision_id: 'decision-goal27-low-risk-revised', status: 'pending' },
    });
  });

  it('is idempotent for an exact retry and blocks divergent old-parent forks under concurrency', async () => {
    const f = await fixture();
    const originalPlan = await f.createObservedDecision('MISMATCH');

    const [left, right] = await Promise.all([
      f.revisions.reopen({ decision_id: originalPlan.decision_id, reason: 'reassess with current evidence' }, ACTOR),
      f.revisions.reopen({ decision_id: originalPlan.decision_id, reason: 'reassess with current evidence' }, ACTOR),
    ]);

    expect(left.revision_id).toBe(right.revision_id);
    expect([left.created, right.created].filter(Boolean)).toHaveLength(1);
    expect(await f.store.listForRoot(originalPlan.decision_id)).toHaveLength(1);
    await expect(f.revisions.reopen({ decision_id: originalPlan.decision_id, reason: 'different intent' }, ACTOR))
      .rejects.toMatchObject({ code: 'REVISION_FORK_BLOCKED' });
  });

  it('requires explicit owner reconsideration for a verified outcome', async () => {
    const f = await fixture();
    const originalPlan = await f.createObservedDecision('VERIFIED');

    await expect(f.revisions.reopen({ decision_id: originalPlan.decision_id }, ACTOR))
      .rejects.toMatchObject({ code: 'REVISION_REASON_REQUIRED' });
    const reopened = await f.revisions.reopen({ decision_id: originalPlan.decision_id, reason: 'owner reconsidered the objective' }, ACTOR);
    expect(reopened.trigger_type).toBe('OWNER_RECONSIDERATION');
  });

  it('supports a linear second revision and rejects forged actor scope', async () => {
    const f = await fixture();
    const rootPlan = await f.createObservedDecision('MISMATCH');
    const first = await f.revisions.reopen({ decision_id: rootPlan.decision_id }, ACTOR);
    const firstPlan = f.runtime.authorizationService.getAuthorizationRecord(first.new_plan_id!)!.plan;
    const receipt = receiptFor(firstPlan);
    f.runtime.verificationRuntime.registerControlledCase({
      plan: firstPlan,
      receipt,
      observation: observationFor(firstPlan, receipt, 'MISMATCH'),
    });
    await expect(f.runtime.verificationRuntime.verifyPlan(firstPlan.plan_id)).resolves.toMatchObject({ status: 'MISMATCH' });
    const second = await f.revisions.reopen({ decision_id: first.new_decision_id }, ACTOR);

    expect(second).toMatchObject({
      root_decision_id: rootPlan.decision_id,
      parent_decision_id: first.new_decision_id,
      revision_index: 2,
    });
    await expect(f.revisions.reopen({ decision_id: second.new_decision_id }, {
      actor_id: 'local-owner', actor_kind: 'owner', scope: 'agent:ask' as never,
    })).rejects.toMatchObject({ code: 'REVISION_SCOPE_INSUFFICIENT' });
  });

  it('bounds revision projections so history cannot become an Agent or renderer store export', async () => {
    const f = await fixture();
    const rootPlan = await f.createObservedDecision('MISMATCH');
    let currentDecisionId = rootPlan.decision_id;

    for (let index = 1; index <= 51; index += 1) {
      const reopened = await f.revisions.reopen({ decision_id: currentDecisionId }, ACTOR);
      const revisedPlan = f.runtime.authorizationService.getAuthorizationRecord(reopened.new_plan_id!)!.plan;
      const receipt = receiptFor(revisedPlan);
      f.runtime.verificationRuntime.registerControlledCase({
        plan: revisedPlan,
        receipt,
        observation: observationFor(revisedPlan, receipt, 'MISMATCH'),
      });
      await expect(f.runtime.verificationRuntime.verifyPlan(revisedPlan.plan_id)).resolves.toMatchObject({ status: 'MISMATCH' });
      currentDecisionId = reopened.new_decision_id;
    }

    const projection = await f.revisions.projectionForDecision(currentDecisionId);
    expect(projection).toMatchObject({
      root_decision_id: rootPlan.decision_id,
      revision_count: 51,
      revision_index: 51,
      history_truncated: true,
      new_plan_pending_approval: true,
    });
    expect(projection?.history).toHaveLength(50);
    expect(projection?.history[0]).toMatchObject({ revision_index: 2 });
    expect(projection?.history.at(-1)).toMatchObject({ revision_index: 51 });
    expect(projection?.evidence_delta_summary.every((entry) => (
      !Object.hasOwn(entry, 'original_evidence_ids') && !Object.hasOwn(entry, 'current_evidence_ids')
    ))).toBe(true);
  });

  it('persists append-only revision history across a SQLite restart', async () => {
    const f = await fixture(true);
    const originalPlan = await f.createObservedDecision('INCONCLUSIVE');
    const opened = await f.revisions.reopen({ decision_id: originalPlan.decision_id }, ACTOR);
    const dbPath = f.dbPath;
    const tempDir = f.tempDir!;

    await f.db.close();
    fixtures.splice(fixtures.indexOf(f), 1);
    const reopenedDb = initDatabase({ dbPath });
    await reopenedDb.runMigrations();
    const persisted = new SqliteDecisionRevisionStore(reopenedDb);
    const record = await persisted.getRevision(opened.revision_id);

    expect(record).toMatchObject({
      revision_id: opened.revision_id,
      root_decision_id: originalPlan.decision_id,
      parent_decision_id: originalPlan.decision_id,
      revision_index: 1,
      status: 'DECIDED',
    });
    expect(await persisted.listEvents(opened.revision_id)).toHaveLength(5);
    await expect(reopenedDb.run('UPDATE decision_revisions SET status = ? WHERE revision_id = ?', ['OPEN', opened.revision_id]))
      .rejects.toThrow(/append-only/);
    await expect(reopenedDb.run('DELETE FROM decision_revisions WHERE revision_id = ?', [opened.revision_id]))
      .rejects.toThrow(/append-only/);
    await reopenedDb.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects strict input pollution instead of accepting a generic mutation payload', async () => {
    const f = await fixture();
    const originalPlan = await f.createObservedDecision('MISMATCH');
    await expect(f.revisions.reopen({
      decision_id: originalPlan.decision_id,
      force: true,
      execute: true,
      parent_decision_id: 'forged',
    }, ACTOR)).rejects.toBeInstanceOf(RevisionError);
  });

  it('executes the machine-readable 72-vector adversarial reopen matrix with no unresolved cases', async () => {
    const matrix = JSON.parse(await readFile(
      new URL('./fixtures/goal27-reopen-adversarial-vectors.json', import.meta.url),
      'utf8',
    )) as AdversarialMatrix;
    expect(matrix).toMatchObject({
      schema_version: '1.0',
      lifecycle: 'Goal27 DecisionRevision',
      total_vectors: 72,
      expected_blocked: 72,
    });
    expect(matrix.vectors).toHaveLength(matrix.total_vectors);
    expect(new Set(matrix.vectors.map((vector) => vector.id)).size).toBe(matrix.total_vectors);

    const f = await fixture();
    const mismatch = await f.createObservedDecision('MISMATCH');
    const verified = await f.createObservedDecision('VERIFIED');
    const observed = new Map<string, string>();

    for (const vector of matrix.vectors.filter((entry) => entry.kind !== 'old_parent_fork' && !entry.kind.startsWith('store_'))) {
      let code: string;
      switch (vector.kind) {
        case 'strict_unknown_field':
          code = await expectedRevisionError(() => f.revisions.reopen({
            decision_id: mismatch.decision_id,
            [vector.field!]: true,
          }, ACTOR));
          break;
        case 'invalid_request':
          code = await expectedRevisionError(() => f.revisions.reopen(vector.request, ACTOR));
          break;
        case 'missing_decision':
          code = await expectedRevisionError(() => f.revisions.reopen({ decision_id: vector.decision_id }, ACTOR));
          break;
        case 'outcome_not_bound':
          code = await expectedRevisionError(() => f.revisions.reopen({
            decision_id: mismatch.decision_id,
            outcome_id: vector.outcome_id,
          }, ACTOR));
          break;
        case 'invalid_actor':
          code = await expectedRevisionError(() => f.revisions.reopen(
            { decision_id: mismatch.decision_id },
            vector.actor as typeof ACTOR,
          ));
          break;
        case 'verified_without_reason':
          code = await expectedRevisionError(() => f.revisions.reopen({ decision_id: verified.decision_id }, ACTOR));
          break;
        default:
          throw new Error(`unsupported adversarial vector kind '${vector.kind}'`);
      }
      observed.set(vector.id, code);
      expect(code, vector.id).toBe(vector.expected_code);
    }

    // Establish exactly one valid revision only after every request/authority
    // attack above has been rejected. Each following vector then tries to
    // reopen its non-latest parent with a distinct intent.
    const first = await f.revisions.reopen({
      decision_id: mismatch.decision_id,
      reason: 'matrix setup: establish the only valid revision',
    }, ACTOR);
    const firstRecord = await f.store.getRevision(first.revision_id);
    expect(firstRecord).not.toBeNull();

    for (const vector of matrix.vectors.filter((entry) => entry.kind === 'old_parent_fork')) {
      const code = await expectedRevisionError(() => f.revisions.reopen({
        decision_id: mismatch.decision_id,
        reason: vector.reason,
      }, ACTOR));
      observed.set(vector.id, code);
      expect(code, vector.id).toBe(vector.expected_code);
    }

    for (const vector of matrix.vectors.filter((entry) => entry.kind.startsWith('store_'))) {
      const code = await expectedRevisionError(() => f.store.createResolvedOrGet(
        tamperedRevisionRecord(firstRecord!, mismatch.decision_id, vector.kind as Parameters<typeof tamperedRevisionRecord>[2]),
      ));
      observed.set(vector.id, code);
      expect(code, vector.id).toBe(vector.expected_code);
    }

    expect(observed).toHaveLength(matrix.total_vectors);
    expect([...observed.values()].filter((code) => code === 'UNEXPECTED_SUCCESS' || code.startsWith('UNEXPECTED_'))).toHaveLength(0);
    expect(await f.store.listForRoot(mismatch.decision_id)).toHaveLength(1);
  });

  it('requires a dedicated local-owner reopen session and denies Agent Pilot credentials', async () => {
    const f = await fixture();
    const originalPlan = await f.createObservedDecision('MISMATCH');
    const priorBridge = process.env.NATIVE_BRIDGE_SECRET;
    const priorPair = process.env.PAIR_CODE;
    const priorLocalApiToken = process.env.LOCAL_API_TOKEN;
    process.env.NATIVE_BRIDGE_SECRET = 'goal27-controlled-bridge-secret';
    process.env.PAIR_CODE = '270027';
    process.env.LOCAL_API_TOKEN = 'goal27-controlled-local-api-token';
    const agentPilot = new AgentPilotAdapter({
      evidenceRuntime: f.runtime.evidenceRuntime,
      authorizationService: f.runtime.authorizationService,
      verificationRuntime: f.runtime.verificationRuntime,
      revisionRuntime: f.revisions,
    });
    const server = createServer(
      f.db,
      null,
      undefined,
      undefined,
      undefined,
      f.runtime.controlRuntime,
      f.runtime.verificationRuntime,
      agentPilot,
      f.revisions,
    );
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const pair = await fetch(`${baseUrl}/api/auth/pair/exchange`, {
        method: 'POST',
        headers: { Authorization: 'Bearer 270027', 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: 'agent-pilot-goal27', device_type: 'agent_pilot' }),
      });
      expect(pair.status).toBe(201);
      const agentToken = (await pair.json() as { device_token: string }).device_token;
      const agentAttempt = await fetch(`${baseUrl}/api/control/reopen`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision_id: originalPlan.decision_id }),
      });
      expect(agentAttempt.status).toBe(403);
      expect(await agentAttempt.json()).toEqual({ error: 'CONTROL_SCOPE_INSUFFICIENT' });

      const approveSession = await fetch(`${baseUrl}/internal/control/session`, {
        method: 'POST', headers: { Authorization: 'Bearer goal27-controlled-bridge-secret' },
      });
      const approveToken = ((await approveSession.json()) as { data: { token: string } }).data.token;
      const wrongScope = await fetch(`${baseUrl}/api/control/reopen`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${approveToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision_id: originalPlan.decision_id }),
      });
      expect(wrongScope.status).toBe(403);
      expect(await wrongScope.json()).toEqual({ error: 'REOPEN_SCOPE_INSUFFICIENT' });

      const mint = await fetch(`${baseUrl}/internal/control/session/reopen`, {
        method: 'POST', headers: { Authorization: 'Bearer goal27-controlled-bridge-secret' },
      });
      expect(mint.status).toBe(201);
      const token = ((await mint.json()) as { data: { token: string; session: { scope: string } } }).data;
      expect(token.session.scope).toBe('control:reopen');
      const polluted = await fetch(`${baseUrl}/api/control/reopen`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision_id: originalPlan.decision_id, force: true }),
      });
      expect(polluted.status).toBe(400);
      expect(await polluted.json()).toEqual({ error: 'REOPEN_INPUT_INVALID' });

      const reopened = await fetch(`${baseUrl}/api/control/reopen`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision_id: originalPlan.decision_id }),
      });
      expect(reopened.status).toBe(200);
      const body = await reopened.json() as { data: Record<string, unknown> };
      expect(body.data).toMatchObject({ reopen_execution_count: 0, execution_started: false });
      expect(JSON.stringify(body)).not.toContain('token_reference');
      expect(JSON.stringify(body)).not.toContain('NATIVE_BRIDGE_SECRET');

      const desktopProjection = await fetch(`${baseUrl}/api/control/plans`, {
        headers: { Authorization: 'Bearer goal27-controlled-local-api-token' },
      });
      expect(desktopProjection.status).toBe(200);
      const desktopBody = await desktopProjection.json() as { plans: Array<Record<string, unknown>> };
      const originalView = desktopBody.plans.find((entry) => (entry.plan as { decision_id?: string }).decision_id === originalPlan.decision_id)!;
      expect(originalView.revision).toMatchObject({
        root_decision_id: originalPlan.decision_id,
        parent_decision_id: originalPlan.decision_id,
        revision_count: 1,
        trigger_type: 'OUTCOME_MISMATCH',
        current_disposition: 'DECIDE',
        new_plan_pending_approval: true,
        history_truncated: false,
        history: [{ revision_index: 1 }],
      });
      expect(originalView.outcome_context).toMatchObject({
        verification_status: 'mismatch',
        expected_state: { number: 1, state: 'CLOSED' },
        trusted_observed_state: { number: 1, state: 'OPEN' },
      });
      expect(JSON.stringify(originalView.revision)).not.toContain('approval_reference_id');
      expect(JSON.stringify(originalView.revision)).not.toContain('approval_request_id');
      expect(JSON.stringify(originalView.revision)).not.toContain('receipt_digest');
      expect(JSON.stringify(originalView.revision)).not.toContain('original_evidence_ids');
      expect(JSON.stringify(originalView.revision)).not.toContain('current_evidence_ids');

      const agentHistory = await fetch(`${baseUrl}/api/agent/history`, {
        headers: { Authorization: `Bearer ${agentToken}` },
      });
      expect(agentHistory.status).toBe(200);
      const agentBody = await agentHistory.json() as { decisions: Array<Record<string, unknown>> };
      expect(agentBody.decisions.some((entry) => entry.revision !== null)).toBe(true);
      const agentOriginal = agentBody.decisions.find((entry) => (entry.plan as { decision_id?: string }).decision_id === originalPlan.decision_id)!;
      expect(agentOriginal).not.toHaveProperty('outcome_context');
      expect(JSON.stringify(agentOriginal.revision)).not.toContain('expected_state');
      expect(JSON.stringify(agentOriginal.revision)).not.toContain('trusted_observed_state');
      const directAgentProjection = await fetch(`${baseUrl}/api/control/revisions/${originalPlan.decision_id}`, {
        headers: { Authorization: `Bearer ${agentToken}` },
      });
      expect(directAgentProjection.status).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (priorBridge === undefined) delete process.env.NATIVE_BRIDGE_SECRET;
      else process.env.NATIVE_BRIDGE_SECRET = priorBridge;
      if (priorPair === undefined) delete process.env.PAIR_CODE;
      else process.env.PAIR_CODE = priorPair;
      if (priorLocalApiToken === undefined) delete process.env.LOCAL_API_TOKEN;
      else process.env.LOCAL_API_TOKEN = priorLocalApiToken;
    }
  });
});
