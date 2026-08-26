/**
 * D1B-2 public verification boundary.
 *
 * The HTTP caller supplies one locator only.  All receipt, verification-plan,
 * subject and observation values are resolved by the trusted runtime.  This
 * facade deliberately does not expose OutcomeService, ReceiptStore or a
 * generic read-back operation to the route layer.
 */
import { z } from 'zod';
import type { ControlSession } from './session.js';
import { CONTROL_VERIFY_SCOPE } from './session.js';

export const ControlVerifyRequestSchema = z.strictObject({
  plan_id: z.string().trim().min(8).max(200),
});

export const CONTROL_VERIFY_STATUSES = ['PENDING', 'VERIFIED', 'MISMATCH', 'INCONCLUSIVE'] as const;
export type ControlVerifyStatus = (typeof CONTROL_VERIFY_STATUSES)[number];

export interface ControlVerificationResult {
  plan_id: string;
  status: ControlVerifyStatus;
  revisit_required: boolean;
  verification_attempts: number;
  readback_attempts: number;
  execution_started: false;
  original_write_retried: false;
  automatic_rollback: false;
  source: 'trusted_server_runtime';
  evidence: 'trusted_receipt_and_readback' | 'trusted_readback_unavailable' | 'trusted_readback_mismatch';
}

export interface ControlVerificationRuntime {
  verifyPlan(planId: string): Promise<ControlVerificationResult>;
}

export class VerificationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'VerificationError';
  }
}

export class ControlVerificationFacade {
  constructor(private readonly runtime: ControlVerificationRuntime | undefined) {}

  async verify(rawBody: unknown, session: ControlSession): Promise<ControlVerificationResult> {
    if (session.scope !== CONTROL_VERIFY_SCOPE) {
      throw new VerificationError('VERIFY_SCOPE_INSUFFICIENT', 'session is not scoped for verification');
    }
    const parsed = ControlVerifyRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new VerificationError('VERIFY_INPUT_INVALID', 'control verify body must be exactly { plan_id }');
    }
    if (!this.runtime) {
      throw new VerificationError('VERIFY_PLAN_NOT_FOUND', 'plan has no trusted verification runtime');
    }
    return this.runtime.verifyPlan(parsed.data.plan_id);
  }
}
