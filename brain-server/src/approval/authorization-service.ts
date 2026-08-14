/**
 * Goal24 Checkpoint 7 (Lane A) - Brain plan authorization lifecycle.
 *
 * Server-owned pipeline:
 *
 *   strict caller request
 *     -> trusted capability lookup + version check
 *     -> CP6 EvidenceEligibilityService materializes authoritative coverage
 *        from a server-owned guard run (caller coverage never enters CP7)
 *     -> server-derived RiskSnapshot + required_approval (V1 fail-closed
 *        policy: only read_only + low + L0 is approval-free)
 *     -> server-generated plan_id + bounded expiry
 *     -> immutable ApprovalBindingPayload + core-computed digest
 *     -> state ready (no approval) or awaiting_approval (approval required)
 *
 * An awaiting_approval plan only becomes ready through applyApproval(), which
 * requires: pending request, current policy version, unchanged binding
 * digest, a native-verifier-validated grant (a bare ApprovalReference is
 * never honored), sufficient actor authority, and an unexpired grant that
 * does not outlive the plan expiry / policy TTL cap.
 *
 * deny / revoke / expiry are internal lifecycle transitions (blocked state).
 * None of these mutation methods are exposed to REST / MCP / Tauri IPC /
 * LLM tools; approval UI/wiring is Checkpoint 9.
 *
 * No process execution and no Broker / gh calls exist in this lane.
 */

import { randomUUID } from 'node:crypto';
import type { CapabilityDefinition } from '../capabilities/contracts.js';
import {
  ApprovalReferenceSchema,
  ExecutionPlanSchema,
  validateExecutionPlanAgainstCapabilities,
  type ApprovalReference,
  type ExecutionPlan,
} from '../execution/contracts.js';
import {
  EvidenceEligibilityService,
  EvidenceError,
  type EvidenceEligibilityRecord,
} from '../evidence/index.js';
import { AuthorizationStore } from './authorization-store.js';
import {
  approvalBindingDigest,
  bindingPayloadForPlan,
  buildApprovalBindingPayload,
} from './binding.js';
import {
  ApprovalRequestRecordSchema,
  ExecutionAuthorizationRequestSchema,
  PlanAuthorizationRecordSchema,
  VerifiedGrantRecordSchema,
  VerifiedGrantSchema,
  type ApprovalGrantVerificationResult,
  type ApprovalGrantVerifier,
  type ApprovalRequestRecord,
  type PlanAuthorizationRecord,
} from './contracts.js';
import { ApprovalError } from './errors.js';
import {
  APPROVAL_POLICY_VERSION,
  DEFAULT_MAX_APPROVAL_TTL_MS,
  approvalRequired,
  authoritySatisfies,
  computePlanExpiry,
  deriveRiskSnapshot,
  isExpiredAt,
} from './policy.js';

export function generateAuthorizationPlanId(): string {
  return `plan-${randomUUID()}`;
}

export function generateApprovalRequestId(): string {
  return `apr-${randomUUID()}`;
}

export interface AuthorizationServiceOptions {
  /** Trusted capability catalog lookup. */
  capabilityLookup: (capabilityId: string) => CapabilityDefinition | undefined;
  /** CP6 eligibility service: the only source of authoritative coverage. */
  evidenceEligibility: EvidenceEligibilityService;
  /** Native grant verifier (Lane A: fake in tests; Lane B: native authority). */
  grantVerifier: ApprovalGrantVerifier;
  store?: AuthorizationStore;
  /** Trusted clock; defaults to the system clock. Callers can never inject time. */
  clock?: () => Date;
  /** Runtime policy version; must be set explicitly to change (fail-closed default). */
  policyVersion?: string;
  /** Approval lifetime cap; must not exceed the V1 15-minute policy bound. */
  maxApprovalTtlMs?: number;
}

export interface PlanAuthorizationResult {
  plan: ExecutionPlan;
  approval_request: ApprovalRequestRecord | null;
  approval_binding_digest: string;
  required_approval: boolean;
}

export class AuthorizationService {
  private readonly capabilityLookup: (capabilityId: string) => CapabilityDefinition | undefined;
  private readonly evidenceEligibility: EvidenceEligibilityService;
  private readonly grantVerifier: ApprovalGrantVerifier;
  private readonly store: AuthorizationStore;
  private readonly clock: () => Date;
  private readonly policyVersion: string;
  private readonly maxApprovalTtlMs: number;

  constructor(options: AuthorizationServiceOptions) {
    if (typeof options.capabilityLookup !== 'function') {
      throw new ApprovalError('APPROVAL_INPUT_INVALID', 'capabilityLookup must be a function');
    }
    if (!(options.evidenceEligibility instanceof EvidenceEligibilityService)) {
      throw new ApprovalError('APPROVAL_INPUT_INVALID', 'evidenceEligibility must be an EvidenceEligibilityService');
    }
    if (
      typeof options.grantVerifier !== 'object' ||
      options.grantVerifier === null ||
      typeof options.grantVerifier.verifyGrant !== 'function'
    ) {
      throw new ApprovalError('APPROVAL_INPUT_INVALID', 'grantVerifier must implement verifyGrant');
    }
    this.capabilityLookup = options.capabilityLookup;
    this.evidenceEligibility = options.evidenceEligibility;
    this.grantVerifier = options.grantVerifier;
    this.store = options.store ?? new AuthorizationStore();
    if (!(this.store instanceof AuthorizationStore)) {
      throw new ApprovalError('APPROVAL_INPUT_INVALID', 'store must be an AuthorizationStore');
    }
    this.clock = options.clock ?? (() => new Date());
    if (typeof this.clock !== 'function') {
      throw new ApprovalError('APPROVAL_INPUT_INVALID', 'clock must be a function');
    }
    this.policyVersion = options.policyVersion ?? APPROVAL_POLICY_VERSION;
    if (typeof this.policyVersion !== 'string' || this.policyVersion.trim().length === 0 || this.policyVersion.length > 50) {
      throw new ApprovalError('APPROVAL_INPUT_INVALID', 'policyVersion must be a non-empty string of at most 50 chars');
    }
    this.maxApprovalTtlMs = options.maxApprovalTtlMs ?? DEFAULT_MAX_APPROVAL_TTL_MS;
    if (
      !Number.isInteger(this.maxApprovalTtlMs) ||
      this.maxApprovalTtlMs <= 0 ||
      this.maxApprovalTtlMs > DEFAULT_MAX_APPROVAL_TTL_MS
    ) {
      throw new ApprovalError(
        'APPROVAL_INPUT_INVALID',
        `maxApprovalTtlMs must be a positive integer <= ${DEFAULT_MAX_APPROVAL_TTL_MS}`,
      );
    }
  }

  get currentPolicyVersion(): string {
    return this.policyVersion;
  }

  /**
   * Authorize an execution request. All authority values are server-derived;
   * the strict request schema rejects caller `required_approval`,
   * `risk_snapshot`, `state`, `approval`, `evidence_coverage_snapshot` and
   * `plan_id`.
   */
  authorize(rawRequest: unknown): PlanAuthorizationResult {
    const requestParse = ExecutionAuthorizationRequestSchema.safeParse(rawRequest);
    if (!requestParse.success) {
      throw new ApprovalError(
        'APPROVAL_INPUT_INVALID',
        `invalid authorization request: ${requestParse.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    const request = requestParse.data;

    const now = this.trustedNow();

    const capability = this.capabilityLookup(request.capability_id);
    if (!capability) {
      throw new ApprovalError(
        'APPROVAL_CAPABILITY_NOT_FOUND',
        `capability '${request.capability_id}' not found in the trusted catalog`,
      );
    }
    if (capability.version !== request.capability_version) {
      throw new ApprovalError(
        'APPROVAL_CAPABILITY_VERSION_MISMATCH',
        `requested capability_version '${request.capability_version}' does not match trusted version '${capability.version}'`,
      );
    }

    // CP6-only evidence: materialize authoritative coverage from the
    // server-owned guard run. Caller coverage never reaches this path.
    let eligibility: EvidenceEligibilityRecord;
    try {
      eligibility = this.evidenceEligibility.materializeEvidenceForExecutablePlan({
        guard_run_id: request.guard_run_id,
        capability_id: request.capability_id,
        capability_version: request.capability_version,
        normalized_inputs: request.normalized_inputs,
      });
    } catch (error) {
      if (error instanceof EvidenceError) {
        throw new ApprovalError('APPROVAL_EVIDENCE_INELIGIBLE', `evidence eligibility failed: ${error.code}`);
      }
      throw error;
    }

    const riskSnapshot = deriveRiskSnapshot(capability);
    const requiredApproval = approvalRequired(capability);
    const planId = generateAuthorizationPlanId();
    const createdAt = now.toISOString();
    const expiresAt = computePlanExpiry(now, request.expires_at, this.maxApprovalTtlMs);

    const planCandidate: ExecutionPlan = {
      plan_id: planId,
      decision_id: request.decision_id,
      capability_id: request.capability_id,
      capability_version: request.capability_version,
      adapter_id: request.adapter_id,
      normalized_inputs: request.normalized_inputs,
      required_approval: requiredApproval,
      approval: null,
      risk_snapshot: riskSnapshot,
      evidence_coverage_snapshot: eligibility.authoritative_coverage,
      timeout_ms: request.timeout_ms,
      verification_plan: request.verification_plan,
      rollback_plan: request.rollback_plan,
      state: requiredApproval ? 'awaiting_approval' : 'ready',
      created_at: createdAt,
      expires_at: expiresAt,
      ...(request.correlation_id !== undefined ? { correlation_id: request.correlation_id } : {}),
      ...(request.requested_by !== undefined ? { requested_by: request.requested_by } : {}),
    };
    const plan = this.validatePlan(planCandidate);

    const bindingPayload = buildApprovalBindingPayload({
      plan_id: plan.plan_id,
      decision_id: plan.decision_id,
      capability_id: plan.capability_id,
      capability_version: plan.capability_version,
      adapter_id: plan.adapter_id,
      normalized_inputs: plan.normalized_inputs,
      risk_snapshot: plan.risk_snapshot,
      evidence_coverage_snapshot: plan.evidence_coverage_snapshot,
      evidence_guard_run_id: eligibility.guard_run_id,
      timeout_ms: plan.timeout_ms,
      verification_plan: plan.verification_plan,
      rollback_plan: plan.rollback_plan,
      created_at: plan.created_at,
      expires_at: expiresAt,
      policy_version: this.policyVersion,
    });
    const bindingDigest = approvalBindingDigest(bindingPayload);

    let approvalRequest: ApprovalRequestRecord | null = null;
    let approvalRequestId: string | null = null;
    if (requiredApproval) {
      approvalRequestId = generateApprovalRequestId();
      const mandatoryClasses = capability.required_evidence
        .filter((requirement) => requirement.mandatory)
        .map((requirement) => requirement.class_id);
      approvalRequest = ApprovalRequestRecordSchema.parse({
        approval_request_id: approvalRequestId,
        plan_id: plan.plan_id,
        decision_id: plan.decision_id,
        capability_id: plan.capability_id,
        capability_version: plan.capability_version,
        risk_snapshot: riskSnapshot,
        side_effect_summary: {
          side_effect_class: capability.side_effect_class,
          reversible: capability.reversible,
        },
        reversible: capability.reversible,
        evidence_summary: {
          guard_run_id: eligibility.guard_run_id,
          coverage_digest: eligibility.coverage_digest,
          mandatory_classes: mandatoryClasses,
          mandatory_satisfied: eligibility.final_assessment.mandatory_satisfied,
        },
        coverage_digest: eligibility.coverage_digest,
        normalized_inputs_digest: eligibility.normalized_inputs_digest,
        approval_binding_digest: bindingDigest,
        required_authority: capability.required_authority,
        policy_version: this.policyVersion,
        created_at: createdAt,
        expires_at: expiresAt,
        status: 'pending',
      });
    }

    const record = PlanAuthorizationRecordSchema.parse({
      plan,
      guard_run_id: eligibility.guard_run_id,
      approval_request_id: approvalRequestId,
      approval_request: approvalRequest,
      approval_binding_digest: bindingDigest,
      grant: null,
      blocked_reason: null,
    });
    this.store.put(record);

    return {
      plan,
      approval_request: approvalRequest,
      approval_binding_digest: bindingDigest,
      required_approval: requiredApproval,
    };
  }

  /**
   * Apply a native-verified approval. A bare ApprovalReference
   * (approval_id / token_reference / token_digest) can never move a plan to
   * ready unless the injected ApprovalGrantVerifier confirms a real grant.
   */
  async applyApproval(planId: string, rawApprovalReference: unknown): Promise<PlanAuthorizationResult> {
    const record = this.requireRecord(planId);
    const plan = record.plan;

    if (plan.state !== 'awaiting_approval') {
      throw new ApprovalError(
        'APPROVAL_STATE_CONFLICT',
        `plan '${planId}' is in state '${plan.state}'; only awaiting_approval plans can receive an approval`,
      );
    }
    const approvalRequest = record.approval_request;
    if (!approvalRequest || approvalRequest.status !== 'pending') {
      throw new ApprovalError(
        'APPROVAL_REQUEST_NOT_PENDING',
        `plan '${planId}' has no pending approval request`,
      );
    }
    if (approvalRequest.policy_version !== this.policyVersion) {
      throw new ApprovalError(
        'APPROVAL_POLICY_VERSION_MISMATCH',
        `approval request policy '${approvalRequest.policy_version}' does not match the current runtime policy '${this.policyVersion}'`,
      );
    }

    const now = this.trustedNow();
    if (isExpiredAt(approvalRequest.expires_at, now)) {
      throw new ApprovalError(
        'APPROVAL_REQUEST_EXPIRED',
        `approval request for plan '${planId}' expired at '${approvalRequest.expires_at}'`,
      );
    }

    // Binding integrity: recompute the digest from the stored plan semantics.
    // Input swap, coverage swap, risk downgrade, adapter/timeout/verification/
    // rollback/decision/expiry mutation all break this equality.
    const recomputedPayload = bindingPayloadForPlan(plan, record.guard_run_id, approvalRequest.policy_version);
    const recomputedDigest = approvalBindingDigest(recomputedPayload);
    if (recomputedDigest !== record.approval_binding_digest) {
      throw new ApprovalError(
        'APPROVAL_BINDING_MISMATCH',
        `plan '${planId}' semantics changed after authorization; the recorded binding digest no longer matches`,
      );
    }

    const referenceParse = ApprovalReferenceSchema.safeParse(rawApprovalReference);
    if (!referenceParse.success) {
      throw new ApprovalError(
        'APPROVAL_INPUT_INVALID',
        `invalid approval reference: ${referenceParse.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    const reference: ApprovalReference = referenceParse.data;
    if (reference.plan_id !== planId) {
      throw new ApprovalError(
        'APPROVAL_PLAN_MISMATCH',
        `approval reference plan_id '${reference.plan_id}' does not match plan '${planId}'`,
      );
    }
    if (reference.policy_version !== this.policyVersion) {
      throw new ApprovalError(
        'APPROVAL_POLICY_VERSION_MISMATCH',
        `approval reference policy '${reference.policy_version}' does not match the current runtime policy '${this.policyVersion}'`,
      );
    }

    let verdict: ApprovalGrantVerificationResult;
    try {
      verdict = await this.grantVerifier.verifyGrant({
        plan,
        approval_reference: reference,
        approval_binding_digest: record.approval_binding_digest,
      });
    } catch {
      throw new ApprovalError('APPROVAL_GRANT_INVALID', 'native grant verifier failed');
    }
    if (!verdict.valid) {
      throw new ApprovalError(
        'APPROVAL_GRANT_INVALID',
        'the approval reference is not a verified native grant (bare references can never ready a plan)',
      );
    }
    const grantParse = VerifiedGrantSchema.safeParse(verdict.grant);
    if (!grantParse.success) {
      throw new ApprovalError('APPROVAL_GRANT_INVALID', 'native grant verifier returned invalid grant metadata');
    }
    const grant = grantParse.data;
    if (grant.authority !== grant.actor.authority_level) {
      throw new ApprovalError(
        'APPROVAL_GRANT_INVALID',
        'grant authority does not match the actor authority level',
      );
    }

    if (!authoritySatisfies(grant.actor.authority_level, approvalRequest.required_authority)) {
      throw new ApprovalError(
        'APPROVAL_AUTHORITY_INSUFFICIENT',
        `actor '${grant.actor.actor_id}' has authority ${grant.actor.authority_level}, below the required ${approvalRequest.required_authority}`,
      );
    }

    const grantedAtMs = Date.parse(grant.granted_at);
    if (!Number.isFinite(grantedAtMs) || grantedAtMs > now.getTime()) {
      throw new ApprovalError('APPROVAL_GRANT_INVALID', 'granted_at is invalid or in the future');
    }
    if (isExpiredAt(grant.expires_at, now)) {
      throw new ApprovalError('APPROVAL_GRANT_EXPIRED', `native grant expired at '${grant.expires_at}'`);
    }
    if (Date.parse(grant.expires_at) > Date.parse(approvalRequest.expires_at)) {
      throw new ApprovalError(
        'APPROVAL_GRANT_INVALID',
        'grant expires after the plan expiry / approval policy TTL cap',
      );
    }

    const wireReference: ApprovalReference = {
      approval_id: grant.native_record_id,
      plan_id: planId,
      granted_by: grant.actor.actor_id,
      granted_at: grant.granted_at,
      policy_version: this.policyVersion,
      token_reference: reference.token_reference,
      token_digest: record.approval_binding_digest,
    };
    const readyPlan = this.validatePlan({ ...plan, state: 'ready', approval: wireReference });

    const nextRecord = PlanAuthorizationRecordSchema.parse({
      ...record,
      plan: readyPlan,
      approval_request: ApprovalRequestRecordSchema.parse({ ...approvalRequest, status: 'granted' }),
      grant: VerifiedGrantRecordSchema.parse({
        actor: grant.actor,
        granted_at: grant.granted_at,
        expires_at: grant.expires_at,
        native_record_id: grant.native_record_id,
      }),
      blocked_reason: null,
    });
    this.store.replace(nextRecord);

    return {
      plan: nextRecord.plan,
      approval_request: nextRecord.approval_request,
      approval_binding_digest: record.approval_binding_digest,
      required_approval: true,
    };
  }

  /** Internal lifecycle: deny a pending approval (plan becomes blocked). */
  denyApproval(planId: string): PlanAuthorizationResult {
    const record = this.requireRecord(planId);
    const plan = record.plan;
    if (plan.state !== 'awaiting_approval') {
      throw new ApprovalError(
        'APPROVAL_STATE_CONFLICT',
        `plan '${planId}' is in state '${plan.state}'; only awaiting_approval plans can be denied`,
      );
    }
    const approvalRequest = record.approval_request;
    if (!approvalRequest || approvalRequest.status !== 'pending') {
      throw new ApprovalError('APPROVAL_REQUEST_NOT_PENDING', `plan '${planId}' has no pending approval request`);
    }
    const blockedPlan = this.validatePlan({ ...plan, state: 'blocked', approval: null });
    const nextRecord = PlanAuthorizationRecordSchema.parse({
      ...record,
      plan: blockedPlan,
      approval_request: ApprovalRequestRecordSchema.parse({ ...approvalRequest, status: 'denied' }),
      blocked_reason: 'approval denied',
    });
    this.store.replace(nextRecord);
    return this.resultFor(nextRecord);
  }

  /** Internal lifecycle: revoke a granted approval before execution (plan becomes blocked). */
  revokeApproval(planId: string): PlanAuthorizationResult {
    const record = this.requireRecord(planId);
    const plan = record.plan;
    if (plan.state !== 'ready' || !record.grant) {
      throw new ApprovalError(
        'APPROVAL_STATE_CONFLICT',
        `plan '${planId}' is not in ready state with a recorded grant; revocation before execution is only valid there`,
      );
    }
    const approvalRequest = record.approval_request;
    if (!approvalRequest || approvalRequest.status !== 'granted') {
      throw new ApprovalError('APPROVAL_REQUEST_NOT_PENDING', `plan '${planId}' has no granted approval request`);
    }
    const blockedPlan = this.validatePlan({ ...plan, state: 'blocked', approval: null });
    const nextRecord = PlanAuthorizationRecordSchema.parse({
      ...record,
      plan: blockedPlan,
      approval_request: ApprovalRequestRecordSchema.parse({ ...approvalRequest, status: 'revoked' }),
      blocked_reason: 'approval revoked before execution',
    });
    this.store.replace(nextRecord);
    return this.resultFor(nextRecord);
  }

  /**
   * Fail-closed expiry sweep: expired pending requests and expired grants
   * (or expired plans) transition to blocked. Returns the affected plan ids.
   */
  sweepExpired(nowOverride?: Date): string[] {
    const now = nowOverride ?? this.trustedNow();
    const affected: string[] = [];
    for (const record of this.store.list()) {
      const plan = record.plan;
      const approvalRequest = record.approval_request;
      let nextPlan: ExecutionPlan = plan;
      let nextRequest: ApprovalRequestRecord | null = approvalRequest;
      let blockedReason: string | null = record.blocked_reason;

      if (
        plan.state === 'awaiting_approval' &&
        approvalRequest &&
        approvalRequest.status === 'pending' &&
        isExpiredAt(approvalRequest.expires_at, now)
      ) {
        nextRequest = ApprovalRequestRecordSchema.parse({ ...approvalRequest, status: 'expired' });
        nextPlan = { ...plan, state: 'blocked', approval: null };
        blockedReason = 'approval request expired';
      } else if (
        plan.state === 'ready' &&
        record.grant &&
        approvalRequest &&
        approvalRequest.status === 'granted' &&
        isExpiredAt(record.grant.expires_at, now)
      ) {
        nextRequest = ApprovalRequestRecordSchema.parse({ ...approvalRequest, status: 'expired' });
        nextPlan = { ...plan, state: 'blocked', approval: null };
        blockedReason = 'approval grant expired';
      }

      if (
        plan.expires_at &&
        isExpiredAt(plan.expires_at, now) &&
        (nextPlan.state === 'awaiting_approval' || nextPlan.state === 'ready')
      ) {
        nextPlan = { ...nextPlan, state: 'blocked', approval: null };
        blockedReason = 'plan expired';
        if (nextRequest && nextRequest.status === 'pending') {
          nextRequest = ApprovalRequestRecordSchema.parse({ ...nextRequest, status: 'expired' });
        }
      }

      if (nextPlan !== plan || nextRequest !== approvalRequest) {
        const parsedPlan = ExecutionPlanSchema.safeParse(nextPlan);
        if (!parsedPlan.success) continue; // fail closed: leave the record untouched
        const nextRecord = PlanAuthorizationRecordSchema.parse({
          ...record,
          plan: parsedPlan.data,
          approval_request: nextRequest,
          blocked_reason: blockedReason,
        });
        this.store.replace(nextRecord);
        affected.push(plan.plan_id);
      }
    }
    return affected;
  }

  getRecord(planId: string): PlanAuthorizationRecord | undefined {
    return this.store.get(planId);
  }

  getPlan(planId: string): ExecutionPlan | undefined {
    return this.store.get(planId)?.plan;
  }

  private trustedNow(): Date {
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new ApprovalError('APPROVAL_INPUT_INVALID', 'trusted clock returned an invalid date');
    }
    return now;
  }

  private requireRecord(planId: string): PlanAuthorizationRecord {
    const record = this.store.get(planId);
    if (!record) {
      throw new ApprovalError('APPROVAL_PLAN_NOT_FOUND', `plan '${planId}' is not in the authorization store`);
    }
    return record;
  }

  private validatePlan(plan: ExecutionPlan): ExecutionPlan {
    const parsed = ExecutionPlanSchema.safeParse(plan);
    if (!parsed.success) {
      throw new ApprovalError(
        'APPROVAL_PLAN_INVALID',
        `server-built plan failed strict validation: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    const issues = validateExecutionPlanAgainstCapabilities(parsed.data, this.capabilityLookup);
    if (issues.length > 0) {
      throw new ApprovalError(
        'APPROVAL_PLAN_INVALID',
        `server-built plan violates capability binding: ${issues
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join('; ')}`.slice(0, 2000),
      );
    }
    return parsed.data;
  }

  private resultFor(record: PlanAuthorizationRecord): PlanAuthorizationResult {
    return {
      plan: record.plan,
      approval_request: record.approval_request,
      approval_binding_digest: record.approval_binding_digest,
      required_approval: record.plan.required_approval,
    };
  }
}