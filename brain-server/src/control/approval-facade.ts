import { z } from 'zod';
import type { ApprovalReference, ExecutionPlan } from '../execution/contracts.js';
import type { PlanAuthorizationRecord } from '../approval/contracts.js';
import { ApprovalError } from '../approval/errors.js';
import type { ControlSession } from './session.js';
import type { NativeApprovalClient } from './native-bridge.js';
import {
  InMemoryControlApprovalAuditStore,
  type ControlApprovalAuditEvent,
  type ControlApprovalAuditStore,
} from './audit.js';

export const ControlApproveRequestSchema = z.strictObject({
  plan_id: z.string().trim().min(8).max(200),
});

export interface ControlApprovalRuntime {
  getAuthorizationRecord(planId: string): PlanAuthorizationRecord | undefined;
  applyApproval(planId: string, reference: ApprovalReference): Promise<{
    plan: ExecutionPlan;
    approval_request: unknown;
  }>;
}

export class ControlApprovalFacade {
  constructor(
    private readonly runtime: ControlApprovalRuntime | undefined,
    private readonly native: NativeApprovalClient,
    private readonly now: () => Date = () => new Date(),
    private readonly audit: ControlApprovalAuditStore = new InMemoryControlApprovalAuditStore(),
  ) {}

  async approve(rawBody: unknown, session: ControlSession): Promise<Record<string, unknown>> {
    const parsed = ControlApproveRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      await this.auditFailure(session, null, null, 'APPROVAL_INPUT_INVALID');
      throw new ApprovalError('APPROVAL_INPUT_INVALID', 'control approve body must be exactly { plan_id }');
    }
    if (!this.runtime) {
      await this.auditFailure(session, parsed.data.plan_id, null, 'APPROVAL_PLAN_NOT_FOUND');
      throw new ApprovalError('APPROVAL_PLAN_NOT_FOUND', 'plan is not available in the server-owned authorization store');
    }
    const record = this.runtime.getAuthorizationRecord(parsed.data.plan_id);
    if (!record) {
      await this.auditFailure(session, parsed.data.plan_id, null, 'APPROVAL_PLAN_NOT_FOUND');
      throw new ApprovalError('APPROVAL_PLAN_NOT_FOUND', 'plan was not found');
    }
    const planId = record.plan.plan_id;
    const decisionId = record.plan.decision_id;
    if (record.plan.state !== 'awaiting_approval' || record.approval_request?.status !== 'pending') {
      await this.auditFailure(session, planId, decisionId, 'APPROVAL_STATE_CONFLICT');
      throw new ApprovalError('APPROVAL_STATE_CONFLICT', 'plan is not awaiting one pending approval');
    }
    const expiresAt = new Date(Math.min(
      Date.parse(record.plan.expires_at || new Date(this.now().getTime() + 5 * 60_000).toISOString()),
      this.now().getTime() + 5 * 60_000,
    )).toISOString();
    if (Date.parse(expiresAt) <= this.now().getTime()) {
      await this.auditFailure(session, planId, decisionId, 'APPROVAL_REQUEST_EXPIRED');
      throw new ApprovalError('APPROVAL_REQUEST_EXPIRED', 'plan is expired');
    }
    // A healthy audit sink is a prerequisite for the native grant. This keeps
    // an audit outage from creating an untraceable approval side effect.
    try {
      await this.audit.ensureWritable();
    } catch {
      throw new ApprovalError('APPROVAL_AUDIT_UNAVAILABLE', 'approval audit persistence is unavailable');
    }
    let reference: ApprovalReference;
    try {
      reference = await this.native.grant({
        plan: record.plan,
        approval_request_id: record.approval_request!.approval_request_id,
        actor_id: session.actor_id,
        actor_kind: session.actor_kind,
        actor_authority: session.authority,
        expires_at: expiresAt,
        approval_binding_digest: record.approval_binding_digest,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/Consumed|duplicate|already has/i.test(message)) {
        await this.recordAuditFailClosed(session, planId, decisionId, 'rejected', 'APPROVAL_STORE_CONFLICT');
        throw new ApprovalError('APPROVAL_STORE_CONFLICT', 'plan already has a native approval grant');
      }
      await this.recordAuditFailClosed(session, planId, decisionId, 'failed', 'APPROVAL_GRANT_INVALID');
      throw new ApprovalError('APPROVAL_GRANT_INVALID', 'native approval authority rejected the grant');
    }
    // Write the approval outcome before the server-owned state transition. A
    // persistence failure therefore leaves the plan awaiting approval and
    // prevents the ready transition from becoming unaudited.
    await this.recordAuditFailClosed(session, planId, decisionId, 'approved', null);
    let applied: Awaited<ReturnType<ControlApprovalRuntime['applyApproval']>>;
    try {
      applied = await this.runtime.applyApproval(parsed.data.plan_id, reference);
    } catch (error) {
      await this.recordAuditFailClosed(session, planId, decisionId, 'failed', 'APPROVAL_APPLY_FAILED');
      throw error;
    }
    return {
      ok: true,
      status: 'APPROVED',
      plan: {
        plan_id: applied.plan.plan_id,
        decision_id: applied.plan.decision_id,
        capability_id: applied.plan.capability_id,
        state: applied.plan.state,
      },
      expires_at: expiresAt,
      actor_scope: session.scope,
      execution_started: false,
    };
  }

  private async auditFailure(
    session: ControlSession,
    planId: string | null,
    decisionId: string | null,
    reason: string,
  ): Promise<void> {
    try {
      await this.recordAudit(session, planId, decisionId, 'rejected', reason);
    } catch {
      // Audit persistence failure supersedes the original response: callers
      // must not receive a successful-looking control decision without proof.
      throw new ApprovalError('APPROVAL_AUDIT_UNAVAILABLE', 'approval audit persistence is unavailable');
    }
  }

  private async recordAudit(
    session: ControlSession,
    planId: string | null,
    decisionId: string | null,
    result: ControlApprovalAuditEvent['result'],
    failureReason: string | null,
  ): Promise<void> {
    const event: ControlApprovalAuditEvent = {
      request_timestamp: this.now().toISOString(),
      session_reference: session.session_id,
      actor_id_or_scope: `${session.actor_id}:${session.scope}`,
      scope: session.scope,
      plan_id: planId,
      decision_id: decisionId,
      action: 'approve',
      result,
      failure_reason: failureReason,
      transport_context: {
        channel: 'public-control',
        loopback: true,
        origin: 'absent',
        host: 'validated',
      },
    };
    await this.audit.append(event);
  }

  private async recordAuditFailClosed(
    session: ControlSession,
    planId: string | null,
    decisionId: string | null,
    result: ControlApprovalAuditEvent['result'],
    failureReason: string | null,
  ): Promise<void> {
    try {
      await this.recordAudit(session, planId, decisionId, result, failureReason);
    } catch {
      throw new ApprovalError('APPROVAL_AUDIT_UNAVAILABLE', 'approval audit persistence is unavailable');
    }
  }
}
