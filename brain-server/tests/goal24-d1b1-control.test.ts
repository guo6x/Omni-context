import { describe, expect, it } from 'vitest';
import { ControlSessionManager } from '../src/control/session.js';
import { ControlApprovalFacade } from '../src/control/approval-facade.js';
import { InMemoryControlApprovalAuditStore, type ControlApprovalAuditStore } from '../src/control/audit.js';

function sessionAt(manager: ControlSessionManager, now = Date.now()) {
  return manager.mint(now);
}

describe('Goal24 D1B-1 control session boundary', () => {
  it('mints approve-only local-owner L3 sessions with a five-minute expiry', () => {
    const manager = new ControlSessionManager();
    const issued = sessionAt(manager, 1_700_000_000_000);
    expect(issued.session.scope).toBe('control:approve');
    expect(issued.session.actor_id).toBe('local-owner');
    expect(issued.session.actor_kind).toBe('owner');
    expect(issued.session.authority).toBe('L3');
    expect(Date.parse(issued.session.expires_at) - Date.parse(issued.session.issued_at)).toBe(300_000);
    expect(issued.token).not.toContain(issued.session.session_id);
  });

  it('rejects unknown and expired tokens without a read-token fallback', () => {
    const manager = new ControlSessionManager();
    const issued = sessionAt(manager, 1_700_000_000_000);
    expect(manager.authenticate('read-token', 1_700_000_001_000)).toBeNull();
    expect(manager.authenticate(issued.token, 1_700_300_001_000)).toBeNull();
  });

  it('allows ten requests and rate-limits the eleventh in one minute', () => {
    const manager = new ControlSessionManager();
    const issued = sessionAt(manager);
    for (let i = 0; i < 10; i += 1) expect(manager.consumeBurst(issued.session.session_id)).toBe(true);
    expect(manager.consumeBurst(issued.session.session_id)).toBe(false);
  });

  it('revokes a session and all sessions on disable/restart', () => {
    const manager = new ControlSessionManager();
    const first = sessionAt(manager);
    const second = sessionAt(manager);
    expect(manager.revoke(first.session.session_id)).toBe(true);
    expect(manager.authenticate(first.token)).toBeNull();
    expect(manager.authenticate(second.token)).not.toBeNull();
    manager.revokeAll();
    expect(manager.authenticate(second.token)).toBeNull();
  });
});

describe('Goal24 D1B-1 fixed approval facade', () => {
  it('rejects extra body fields before native authority', async () => {
    let grants = 0;
    const facade = new ControlApprovalFacade(undefined, {
      grant: async () => { grants += 1; throw new Error('must not call'); },
      verify: async () => ({ valid: false }),
    });
    const manager = new ControlSessionManager();
    const issued = sessionAt(manager);
    await expect(facade.approve({ plan_id: 'plan-12345678', extra: true }, issued.session)).rejects.toThrow('APPROVAL_INPUT_INVALID');
    expect(grants).toBe(0);
  });

  it('requires a server-owned awaiting_approval pending record', async () => {
    const facade = new ControlApprovalFacade({
      getAuthorizationRecord: () => undefined,
      applyApproval: async () => { throw new Error('must not call'); },
    }, { grant: async () => { throw new Error('must not call'); }, verify: async () => ({ valid: false }) });
    const manager = new ControlSessionManager();
    const issued = sessionAt(manager);
    await expect(facade.approve({ plan_id: 'plan-12345678' }, issued.session)).rejects.toThrow('APPROVAL_PLAN_NOT_FOUND');
  });

  it('writes a non-secret loopback audit event for a native approval', async () => {
    const audit = new InMemoryControlApprovalAuditStore();
    const plan = {
      plan_id: 'plan-12345678',
      decision_id: 'decision-123',
      capability_id: 'github.issue.create',
      state: 'awaiting_approval',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    } as any;
    const facade = new ControlApprovalFacade({
      getAuthorizationRecord: () => ({
        plan,
        approval_request_id: 'approval-request-123',
        approval_request: { status: 'pending', approval_request_id: 'approval-request-123' },
      } as any),
      applyApproval: async () => ({ plan: { ...plan, state: 'ready' }, approval_request: { status: 'granted' } }),
    }, {
      grant: async () => ({ approval_id: 'native-123', plan_id: plan.plan_id, token_reference: 'opaque-ref', token_digest: 'a'.repeat(64) }) as any,
      verify: async () => ({ valid: false }),
    }, () => new Date(), audit);
    const manager = new ControlSessionManager();
    const issued = sessionAt(manager);

    await expect(facade.approve({ plan_id: plan.plan_id }, issued.session)).resolves.toMatchObject({ status: 'APPROVED' });
    expect(audit.list()).toEqual([expect.objectContaining({
      session_reference: issued.session.session_id,
      actor_id_or_scope: 'local-owner:control:approve',
      scope: 'control:approve',
      plan_id: plan.plan_id,
      decision_id: plan.decision_id,
      action: 'approve',
      result: 'approved',
      failure_reason: null,
      transport_context: { channel: 'public-control', loopback: true, origin: 'absent', host: 'validated' },
    })]);
    expect(JSON.stringify(audit.list())).not.toMatch(/Authorization|Bearer|token_digest|opaque-ref/i);
  });

  it('fails closed before native grant when audit persistence is unavailable', async () => {
    let grants = 0;
    const failingAudit: ControlApprovalAuditStore = {
      ensureWritable: () => { throw new Error('disk unavailable'); },
      append: () => undefined,
    };
    const facade = new ControlApprovalFacade({
      getAuthorizationRecord: () => ({
        plan: { plan_id: 'plan-12345678', decision_id: 'decision-123', state: 'awaiting_approval', expires_at: new Date(Date.now() + 60_000).toISOString() },
        approval_request_id: 'approval-request-123',
        approval_request: { status: 'pending', approval_request_id: 'approval-request-123' },
      } as any),
      applyApproval: async () => { throw new Error('must not apply'); },
    }, {
      grant: async () => { grants += 1; throw new Error('must not grant'); },
      verify: async () => ({ valid: false }),
    }, () => new Date(), failingAudit);
    const manager = new ControlSessionManager();
    const issued = sessionAt(manager);

    await expect(facade.approve({ plan_id: 'plan-12345678' }, issued.session)).rejects.toThrow('APPROVAL_AUDIT_UNAVAILABLE');
    expect(grants).toBe(0);
  });
});
