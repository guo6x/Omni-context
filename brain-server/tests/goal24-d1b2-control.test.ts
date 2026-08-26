import { describe, expect, test } from 'vitest';
import { ControlVerificationFacade, ControlVerifyRequestSchema, VerificationError } from '../src/control/verification-facade.js';
import { CONTROL_VERIFY_SCOPE, ControlSessionManager } from '../src/control/session.js';
import { ServerVerificationRuntime, registerD1b2ControlledCases } from '../src/control/verification-runtime.js';

const verifySession = {
  session_id: 'cs-d1b2-test',
  scope: CONTROL_VERIFY_SCOPE,
  actor_id: 'local-owner' as const,
  actor_kind: 'owner' as const,
  authority: 'L3' as const,
  issued_at: '2026-08-26T00:00:00.000Z',
  expires_at: '2026-08-26T00:05:00.000Z',
};

describe('D1B-2 public verification boundary', () => {
  test('body is exactly plan_id and rejects caller authority fields', () => {
    expect(ControlVerifyRequestSchema.safeParse({ plan_id: 'plan-12345678' }).success).toBe(true);
    for (const extra of ['decision_id', 'capability_id', 'receipt', 'observation', 'success', 'verified', 'expected_state', 'predicate', 'regex', 'jsonpath', 'prompt', 'outcome', 'status']) {
      expect(ControlVerifyRequestSchema.safeParse({ plan_id: 'plan-12345678', [extra]: 'caller' }).success).toBe(false);
    }
  });

  test('approve-only and read-only sessions cannot verify', async () => {
    const facade = new ControlVerificationFacade({ verifyPlan: async () => ({
      plan_id: 'plan-12345678', status: 'INCONCLUSIVE', revisit_required: true,
      verification_attempts: 0, readback_attempts: 0, execution_started: false,
      original_write_retried: false, automatic_rollback: false,
      source: 'trusted_server_runtime', evidence: 'trusted_readback_unavailable',
    }) });
    await expect(facade.verify({ plan_id: 'plan-12345678' }, { ...verifySession, scope: 'control:approve' })).rejects.toThrow(/VERIFY_SCOPE_INSUFFICIENT/);
    await expect(facade.verify({ plan_id: 'plan-12345678' }, { ...verifySession, scope: 'control:verify' })).resolves.toMatchObject({ status: 'INCONCLUSIVE' });
  });

  test('session manager mints a separate five-minute verify scope', () => {
    const manager = new ControlSessionManager();
    const issued = manager.mint(CONTROL_VERIFY_SCOPE, 1_700_000_000_000);
    expect(issued.session.scope).toBe(CONTROL_VERIFY_SCOPE);
    expect(Date.parse(issued.session.expires_at) - Date.parse(issued.session.issued_at)).toBe(5 * 60_000);
    expect(manager.authenticate(issued.token, 1_700_000_000_001)?.scope).toBe(CONTROL_VERIFY_SCOPE);
  });

  test('controlled trusted pipeline yields VERIFIED, MISMATCH and INCONCLUSIVE', async () => {
    const runtime = new ServerVerificationRuntime(() => undefined);
    const ids = registerD1b2ControlledCases(runtime);
    await expect(runtime.verifyPlan(ids.verified_plan_id)).resolves.toMatchObject({ status: 'VERIFIED', execution_started: false, original_write_retried: false, automatic_rollback: false });
    await expect(runtime.verifyPlan(ids.mismatch_plan_id)).resolves.toMatchObject({ status: 'MISMATCH', revisit_required: true });
    await expect(runtime.verifyPlan(ids.inconclusive_plan_id)).resolves.toMatchObject({ status: 'INCONCLUSIVE', revisit_required: true });
  });

  test('unknown plan fails closed; no public arbitrary receipt/readback path', async () => {
    const runtime = new ServerVerificationRuntime(() => undefined);
    await expect(runtime.verifyPlan('plan-unknown')).rejects.toMatchObject({ code: 'VERIFY_PLAN_NOT_FOUND' });
    const facade = new ControlVerificationFacade(runtime);
    await expect(facade.verify({ plan_id: 'plan-12345678', receipt: {} }, verifySession)).rejects.toThrow(VerificationError);
  });
});
