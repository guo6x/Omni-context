/**
 * Goal27 Reopen / Revision service.
 *
 * This service deliberately has no execution, native bridge, shell, adapter
 * invocation or approval-grant capability.  A human-authorised reopen only
 * snapshots the old immutable judgment, requalifies current evidence through
 * the existing trusted surface, runs the same decision kernel, and (when the
 * kernel says DECIDE) materialises a fresh unapproved plan.
 */

import { randomUUID } from 'node:crypto';
import type { PlanAuthorizationRecord } from '../approval/contracts.js';
import { AuthorizationService } from '../approval/authorization-service.js';
import type { JsonObject } from '../contracts/json-safe.js';
import { CONTROL_REOPEN_SCOPE } from '../control/session.js';
import { ServerVerificationRuntime, type TrustedRevisionOutcomeContext } from '../control/verification-runtime.js';
import { runDecisionKernel, type DecisionKernelResult } from '../decision/kernel.js';
import {
  collectCoverageIds,
  coverageDigest,
  sha256Hex,
  type EvidenceSurfaceEvaluation,
  EvidenceSurfaceRuntime,
} from '../evidence/index.js';
import { canonicalJson } from '../evidence/model.js';
import type { EvidenceCoverageEntry, EvidenceCoverageSnapshot, ExecutionPlan } from '../execution/contracts.js';
import {
  DecisionRevisionContextSchema,
  DecisionRevisionRecordSchema,
  ReopenControlRequestSchema,
  type CurrentEvidenceSnapshot,
  type DecisionRevisionContext,
  type DecisionRevisionProjection,
  type DecisionRevisionRecord,
  type EvidenceDeltaEntry,
  type OriginalDecisionSnapshot,
  type ReopenControlRequest,
  type RevisionTriggerType,
} from './contracts.js';
import { RevisionError } from './errors.js';
import { SqliteDecisionRevisionStore } from './store.js';

export { CONTROL_REOPEN_SCOPE as REOPEN_CONTROL_SCOPE };

/** The only trusted caller shape accepted by this service. */
export interface ReopenControlActor {
  actor_id: 'local-owner';
  actor_kind: 'owner';
  scope: typeof CONTROL_REOPEN_SCOPE;
}

export interface ReopenDecisionResult {
  revision_id: string;
  root_decision_id: string;
  parent_decision_id: string;
  revision_index: number;
  trigger_type: RevisionTriggerType;
  trigger_outcome_id: string | null;
  revision_context_digest: string;
  new_decision_id: string;
  new_disposition: DecisionKernelResult['disposition'];
  new_plan_id: string | null;
  approval_request_id: string | null;
  requires_new_approval: boolean;
  created: boolean;
  reopen_execution_count: 0;
  execution_started: false;
  original_write_retried: false;
  automatic_rollback: false;
  old_approval_reused: false;
  old_grant_reused: false;
  old_plan_reused: false;
}

export interface DecisionRevisionServiceOptions {
  store: SqliteDecisionRevisionStore;
  authorizationService: AuthorizationService;
  evidenceRuntime: EvidenceSurfaceRuntime;
  verificationRuntime: ServerVerificationRuntime;
  clock?: () => Date;
}

function trustedNow(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new RevisionError('REVISION_PERSISTENCE_FAILURE', 'trusted clock returned an invalid date');
  }
  return value;
}

function generateRevisionId(): string {
  return `rev-${randomUUID()}`;
}

function generateRevisionDecisionId(): string {
  return `decision-revision-${randomUUID()}`;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function idsForCoverageEntry(entry: EvidenceCoverageEntry | undefined): string[] {
  if (!entry) return [];
  return sortedUnique([...entry.evidence_ids, ...(entry.conflict_evidence_ids ?? [])]);
}

/** Stable, audit-friendly diff of two trusted coverage snapshots. */
export function buildEvidenceDelta(
  original: EvidenceCoverageSnapshot,
  current: EvidenceCoverageSnapshot,
): EvidenceDeltaEntry[] {
  const originalByClass = new Map(original.entries.map((entry) => [entry.evidence_class, entry]));
  const currentByClass = new Map(current.entries.map((entry) => [entry.evidence_class, entry]));
  const classes = sortedUnique([...originalByClass.keys(), ...currentByClass.keys()]);
  return classes.map((evidenceClass) => {
    const before = originalByClass.get(evidenceClass);
    const after = currentByClass.get(evidenceClass);
    const beforeIds = idsForCoverageEntry(before);
    const afterIds = idsForCoverageEntry(after);
    const sameIds = beforeIds.length === afterIds.length && beforeIds.every((id, index) => id === afterIds[index]);
    const category = !after || after.status === 'missing'
      ? 'MISSING_NOW'
      : !before
        ? 'NEW'
        : after.status === 'stale'
          ? 'STALE_NOW'
          : after.status === 'conflicted'
            ? 'CONFLICTED_NOW'
            : before.status === after.status && sameIds
              ? 'UNCHANGED'
              : 'QUALIFICATION_CHANGED';
    return {
      evidence_class: evidenceClass,
      category,
      original_status: before?.status ?? null,
      current_status: after?.status ?? null,
      original_evidence_ids: beforeIds,
      current_evidence_ids: afterIds,
    } as EvidenceDeltaEntry;
  });
}

function planSemanticsDigest(plan: ExecutionPlan): string {
  // Approval references/grants are intentionally excluded: they are historic
  // evidence only and can never be copied into a new authorization lifecycle.
  return sha256Hex(canonicalJson({
    plan_id: plan.plan_id,
    decision_id: plan.decision_id,
    capability_id: plan.capability_id,
    capability_version: plan.capability_version,
    adapter_id: plan.adapter_id,
    normalized_inputs: plan.normalized_inputs,
    risk_snapshot: plan.risk_snapshot,
    evidence_coverage_snapshot: plan.evidence_coverage_snapshot,
    timeout_ms: plan.timeout_ms,
    verification_plan: plan.verification_plan,
    rollback_plan: plan.rollback_plan,
  }));
}

function snapshotOutcome(source: TrustedRevisionOutcomeContext) {
  return {
    outcome_id: source.outcome_id,
    verification_status: source.verification_status,
    revisit_required: source.revisit_required,
    execution_receipt_id: source.execution_receipt_id,
    receipt_digest: source.receipt_digest,
    expected_outcome_digest: source.expected_outcome_digest,
    latest_observation_digest: source.latest_observation_digest,
    observation_id: source.observation_id,
    expected_state: source.expected_state,
    trusted_observed_state: source.trusted_observed_state,
    reason_codes: sortedUnique(source.reason_codes),
  };
}

function originalSnapshot(record: PlanAuthorizationRecord, source: TrustedRevisionOutcomeContext): OriginalDecisionSnapshot {
  const plan = record.plan;
  return {
    decision_id: plan.decision_id,
    disposition: 'DECIDE',
    plan: {
      plan_id: plan.plan_id,
      plan_semantics_digest: planSemanticsDigest(plan),
      capability_id: plan.capability_id,
      capability_version: plan.capability_version,
      adapter_id: plan.adapter_id,
      normalized_inputs_digest: sha256Hex(canonicalJson(plan.normalized_inputs)),
      risk_snapshot: plan.risk_snapshot,
      state: plan.state,
      approval_reference_id: plan.approval?.approval_id ?? null,
      approval_request_id: record.approval_request_id,
    },
    evidence: {
      guard_run_id: record.guard_run_id,
      coverage_snapshot: plan.evidence_coverage_snapshot,
      coverage_digest: coverageDigest(plan.evidence_coverage_snapshot),
      qualified_evidence_ids: collectCoverageIds(plan.evidence_coverage_snapshot),
    },
    outcome: snapshotOutcome(source),
  };
}

function currentEvidenceSnapshot(evaluation: EvidenceSurfaceEvaluation): CurrentEvidenceSnapshot {
  return {
    guard_run_id: evaluation.guard_run_id,
    action: evaluation.action,
    subject_key: evaluation.subject_key,
    coverage_snapshot: evaluation.final_coverage,
    coverage_digest: evaluation.coverage_digest,
    qualified_evidence_ids: sortedUnique(evaluation.qualified_evidence_ids),
    reason_codes: sortedUnique(evaluation.reason_codes),
  };
}

function triggerFor(
  request: ReopenControlRequest,
  source: TrustedRevisionOutcomeContext,
): { trigger_type: RevisionTriggerType; trigger_reason: string } {
  if (request.outcome_id && request.outcome_id !== source.outcome_id) {
    throw new RevisionError('REVISION_OUTCOME_NOT_BOUND', 'supplied outcome is not bound to the requested decision');
  }
  switch (source.verification_status) {
    case 'mismatch':
      if (!source.revisit_required) {
        throw new RevisionError('REVISION_CONTEXT_INVALID', 'a mismatched outcome must preserve revisit_required');
      }
      return {
        trigger_type: 'OUTCOME_MISMATCH',
        trigger_reason: request.reason ?? 'trusted outcome mismatch requires a new judgment',
      };
    case 'inconclusive':
      if (!source.revisit_required) {
        throw new RevisionError('REVISION_CONTEXT_INVALID', 'an inconclusive outcome must preserve revisit_required');
      }
      return {
        trigger_type: 'OUTCOME_INCONCLUSIVE',
        trigger_reason: request.reason ?? 'trusted outcome is inconclusive and requires a new judgment',
      };
    case 'verified':
      if (!request.reason) {
        throw new RevisionError('REVISION_REASON_REQUIRED', 'owner reconsideration of a verified outcome requires an explicit reason');
      }
      return { trigger_type: 'OWNER_RECONSIDERATION', trigger_reason: request.reason };
    default:
      throw new RevisionError('REVISION_NOT_ELIGIBLE', 'only mismatch, inconclusive, or explicit owner reconsideration of a verified outcome may reopen');
  }
}

function idempotencyDigest(input: {
  root_decision_id: string;
  parent_decision_id: string;
  trigger_type: RevisionTriggerType;
  trigger_outcome_id: string;
  trigger_reason: string;
  authorized_by: string;
}): string {
  return sha256Hex(canonicalJson(input));
}

function resultFromRecord(record: DecisionRevisionRecord, created: boolean, approvalRequestId: string | null = null): ReopenDecisionResult {
  if (!record.new_decision_id || !record.new_disposition) {
    throw new RevisionError('REVISION_PERSISTENCE_FAILURE', `revision '${record.revision_id}' has no resolved decision`);
  }
  return {
    revision_id: record.revision_id,
    root_decision_id: record.root_decision_id,
    parent_decision_id: record.parent_decision_id,
    revision_index: record.revision_index,
    trigger_type: record.trigger_type,
    trigger_outcome_id: record.trigger_outcome_id,
    revision_context_digest: record.revision_context_digest,
    new_decision_id: record.new_decision_id,
    new_disposition: record.new_disposition,
    new_plan_id: record.new_plan_id,
    approval_request_id: approvalRequestId,
    requires_new_approval: record.new_disposition === 'DECIDE',
    created,
    reopen_execution_count: 0,
    execution_started: false,
    original_write_retried: false,
    automatic_rollback: false,
    old_approval_reused: false,
    old_grant_reused: false,
    old_plan_reused: false,
  };
}

/**
 * One authoritative implementation of the V1 linear DecisionRevision
 * lifecycle.  The service has no methods for patching/retrying/executing an
 * old decision, and its constructor accepts trusted runtime dependencies only.
 */
export class DecisionRevisionService {
  private readonly store: SqliteDecisionRevisionStore;
  private readonly authorizationService: AuthorizationService;
  private readonly evidenceRuntime: EvidenceSurfaceRuntime;
  private readonly verificationRuntime: ServerVerificationRuntime;
  private readonly clock: () => Date;

  constructor(options: DecisionRevisionServiceOptions) {
    if (!(options.store instanceof SqliteDecisionRevisionStore)) {
      throw new RevisionError('REVISION_INPUT_INVALID', 'store must be a SqliteDecisionRevisionStore');
    }
    if (!(options.authorizationService instanceof AuthorizationService)) {
      throw new RevisionError('REVISION_INPUT_INVALID', 'authorizationService must be an AuthorizationService');
    }
    if (!(options.evidenceRuntime instanceof EvidenceSurfaceRuntime)) {
      throw new RevisionError('REVISION_INPUT_INVALID', 'evidenceRuntime must be an EvidenceSurfaceRuntime');
    }
    if (!(options.verificationRuntime instanceof ServerVerificationRuntime)) {
      throw new RevisionError('REVISION_INPUT_INVALID', 'verificationRuntime must be a ServerVerificationRuntime');
    }
    this.store = options.store;
    this.authorizationService = options.authorizationService;
    this.evidenceRuntime = options.evidenceRuntime;
    this.verificationRuntime = options.verificationRuntime;
    this.clock = options.clock ?? (() => new Date());
  }

  async reopen(rawRequest: unknown, actor: ReopenControlActor): Promise<ReopenDecisionResult> {
    const requestParsed = ReopenControlRequestSchema.safeParse(rawRequest);
    if (!requestParsed.success) {
      throw new RevisionError('REVISION_INPUT_INVALID', 'reopen request failed strict validation');
    }
    if (actor?.actor_id !== 'local-owner' || actor.actor_kind !== 'owner') {
      throw new RevisionError('REVISION_AUTHORITY_REQUIRED', 'a local owner is required to reopen a decision');
    }
    if (actor.scope !== CONTROL_REOPEN_SCOPE) {
      throw new RevisionError('REVISION_SCOPE_INSUFFICIENT', 'control:reopen scope is required');
    }
    const request = requestParsed.data;
    const authorization = this.findSingleAuthorization(request.decision_id);
    const source = this.verificationRuntime.getTrustedRevisionContext(authorization.plan.plan_id);
    if (!source) {
      throw new RevisionError('REVISION_OUTCOME_NOT_BOUND', 'the requested decision has no trusted finalized outcome context');
    }
    const trigger = triggerFor(request, source);
    const parentRevision = await this.store.getRevisionForNewDecision(request.decision_id);
    const rootDecisionId = parentRevision?.root_decision_id ?? request.decision_id;
    const digest = idempotencyDigest({
      root_decision_id: rootDecisionId,
      parent_decision_id: request.decision_id,
      trigger_type: trigger.trigger_type,
      trigger_outcome_id: source.outcome_id,
      trigger_reason: trigger.trigger_reason,
      authorized_by: actor.actor_id,
    });

    // Exact retried intent is idempotent.  This comes before requalification
    // and authorisation, so a retry cannot mint another plan or consume any
    // authority after a network timeout.
    const duplicate = await this.store.getByIdempotency(digest);
    if (duplicate) return resultFromRecord(duplicate, false);

    const chain = await this.store.listForRoot(rootDecisionId);
    const latest = chain[chain.length - 1];
    if (latest && latest.new_decision_id !== request.decision_id) {
      throw new RevisionError('REVISION_FORK_BLOCKED', 'only the latest decision in a revision chain can be reopened');
    }

    const original = originalSnapshot(authorization, source);
    let evaluation: EvidenceSurfaceEvaluation;
    try {
      evaluation = await this.evidenceRuntime.evaluateForCapability({
        capability_id: authorization.plan.capability_id,
        capability_version: authorization.plan.capability_version,
        normalized_inputs: authorization.plan.normalized_inputs,
        correlation_id: `revision-context:${sha256Hex(request.decision_id).slice(0, 32)}`,
      });
    } catch {
      throw new RevisionError('REVISION_EVIDENCE_REQUALIFICATION_FAILED', 'trusted evidence could not be requalified');
    }
    const currentEvidence = currentEvidenceSnapshot(evaluation);
    const kernel = runDecisionKernel({
      evidence_action: evaluation.action,
      mandatory_satisfied: evaluation.final_assessment.mandatory_satisfied,
      reason_codes: evaluation.reason_codes,
    });
    const newRevisionId = generateRevisionId();
    const newDecisionId = generateRevisionDecisionId();
    const context: DecisionRevisionContext = DecisionRevisionContextSchema.parse({
      root_decision_id: rootDecisionId,
      parent_decision_id: request.decision_id,
      original,
      trigger: {
        trigger_type: trigger.trigger_type,
        trigger_outcome_id: source.outcome_id,
        trigger_reason: trigger.trigger_reason,
      },
      current_evidence: currentEvidence,
      evidence_delta: buildEvidenceDelta(original.evidence.coverage_snapshot, currentEvidence.coverage_snapshot),
      decision_kernel_id: kernel.kernel_id,
    });
    const now = trustedNow(this.clock).toISOString();
    let preparedPlanId: string | null = null;
    let preparedApprovalRequestId: string | null = null;
    try {
      if (kernel.disposition === 'DECIDE') {
        const fresh = this.authorizationService.authorizeRevision({
          decision_id: newDecisionId,
          capability_id: authorization.plan.capability_id,
          capability_version: authorization.plan.capability_version,
          adapter_id: authorization.plan.adapter_id,
          normalized_inputs: authorization.plan.normalized_inputs,
          guard_run_id: evaluation.guard_run_id,
          timeout_ms: authorization.plan.timeout_ms,
          verification_plan: authorization.plan.verification_plan,
          rollback_plan: authorization.plan.rollback_plan,
          requested_by: 'revision-lifecycle',
          correlation_id: `revision:${newRevisionId}`,
        });
        preparedPlanId = fresh.plan.plan_id;
        preparedApprovalRequestId = fresh.approval_request?.approval_request_id ?? null;
      }
      const record = DecisionRevisionRecordSchema.parse({
        revision_id: newRevisionId,
        root_decision_id: rootDecisionId,
        parent_decision_id: request.decision_id,
        revision_index: chain.length + 1,
        trigger_type: trigger.trigger_type,
        trigger_outcome_id: source.outcome_id,
        trigger_reason: trigger.trigger_reason,
        requested_by: actor.actor_id,
        authorized_by: actor.actor_id,
        opened_at: now,
        status: 'DECIDED',
        revision_context_digest: sha256Hex(canonicalJson(context)),
        context,
        new_decision_id: newDecisionId,
        new_disposition: kernel.disposition,
        new_plan_id: preparedPlanId,
        resolved_at: now,
        idempotency_digest: digest,
      });
      const saved = await this.store.createResolvedOrGet(record);
      if (!saved.created && preparedPlanId) {
        this.authorizationService.discardUncommittedRevisionPlan(preparedPlanId, newDecisionId);
        preparedPlanId = null;
        preparedApprovalRequestId = null;
      }
      return resultFromRecord(saved.record, saved.created, saved.created ? preparedApprovalRequestId : null);
    } catch (error) {
      if (preparedPlanId) {
        this.authorizationService.discardUncommittedRevisionPlan(preparedPlanId, newDecisionId);
      }
      if (error instanceof RevisionError) throw error;
      throw new RevisionError('REVISION_PERSISTENCE_FAILURE', 'revision creation did not commit');
    }
  }

  async projectionForDecision(decisionId: string): Promise<DecisionRevisionProjection | null> {
    const projection = await this.store.projectionForDecision(decisionId);
    if (!projection) return null;

    const latest = await this.store.getRevisionForNewDecision(projection.current_decision_id);
    if (!latest?.new_plan_id) {
      return { ...projection, new_plan_pending_approval: false };
    }
    // Authorization records are intentionally memory-owned by the current
    // trusted runtime. If a process restart has not restored that runtime
    // ledger, report the dynamic approval state as unknown rather than
    // guessing from a historical revision snapshot.
    const authorizationRecord = this.authorizationService.getAuthorizationRecord(latest.new_plan_id);
    return {
      ...projection,
      new_plan_pending_approval: authorizationRecord
        ? authorizationRecord.plan.state === 'awaiting_approval' && authorizationRecord.approval_request?.status === 'pending'
        : null,
    };
  }

  private findSingleAuthorization(decisionId: string): PlanAuthorizationRecord {
    const records = this.authorizationService
      .listAuthorizationRecords()
      .filter((record) => record.plan.decision_id === decisionId);
    if (records.length === 0) {
      throw new RevisionError('REVISION_DECISION_NOT_FOUND', 'decision was not found in the server-owned authorization ledger');
    }
    if (records.length !== 1) {
      throw new RevisionError('REVISION_CONTEXT_INVALID', 'decision resolves to more than one authorization record');
    }
    return records[0]!;
  }
}
