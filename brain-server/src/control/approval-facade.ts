import { z } from 'zod';
import type { ApprovalReference, ExecutionPlan } from '../execution/contracts.js';
import type { PlanAuthorizationRecord } from '../approval/contracts.js';
import { ApprovalError } from '../approval/errors.js';
import type { ControlSession } from './session.js';
import type { NativeApprovalClient } from './native-bridge.js';

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
  ) {}

  async approve(rawBody: unknown, session: ControlSession): Promise<Record<string, unknown>> {
    const parsed = ControlApproveRequestSchema.safeParse(rawBody);
    if (!parsed.success) throw new ApprovalError('APPROVAL_INPUT_INVALID', 'control approve body must be exactly { plan_id }');
    if (!this.runtime) throw new ApprovalError('APPROVAL_PLAN_NOT_FOUND', 'plan is not available in the server-owned authorization store');
    const record = this.runtime.getAuthorizationRecord(parsed.data.plan_id);
    if (!record) throw new ApprovalError('APPROVAL_PLAN_NOT_FOUND', 'plan was not found');
    if (record.plan.state !== 'awaiting_approval' || record.approval_request?.status !== 'pending') {
      throw new ApprovalError('APPROVAL_STATE_CONFLICT', 'plan is not awaiting one pending approval');
    }
    const expiresAt = new Date(Math.min(
      Date.parse(record.plan.expires_at || new Date(this.now().getTime() + 5 * 60_000).toISOString()),
      this.now().getTime() + 5 * 60_000,
    )).toISOString();
    if (Date.parse(expiresAt) <= this.now().getTime()) throw new ApprovalError('APPROVAL_REQUEST_EXPIRED', 'plan is expired');
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
        throw new ApprovalError('APPROVAL_STORE_CONFLICT', 'plan already has a native approval grant');
      }
      throw new ApprovalError('APPROVAL_GRANT_INVALID', 'native approval authority rejected the grant');
    }
    const applied = await this.runtime.applyApproval(parsed.data.plan_id, reference);
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
}
