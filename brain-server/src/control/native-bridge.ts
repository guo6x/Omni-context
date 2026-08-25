import type { ApprovalReference, ExecutionPlan } from '../execution/contracts.js';
import type { ControlSession } from './session.js';

export interface NativeApprovalRequest {
  plan: ExecutionPlan;
  approval_request_id: string;
  actor_id: ControlSession['actor_id'];
  actor_kind: ControlSession['actor_kind'];
  actor_authority: ControlSession['authority'];
  expires_at: string;
  approval_binding_digest: string;
}

export interface NativeApprovalClient {
  grant(request: NativeApprovalRequest): Promise<ApprovalReference>;
  verify(reference: ApprovalReference, plan: ExecutionPlan): Promise<{
    valid: boolean;
    grant?: {
      actor: { actor_id: string; actor_kind: 'owner' | 'admin'; authority_level: 'L0' | 'L1' | 'L2' | 'L3'; source: 'trusted_local' };
      authority: 'L0' | 'L1' | 'L2' | 'L3';
      granted_at: string;
      expires_at: string;
      native_record_id: string;
      token_reference: string;
      token_digest: string;
    };
  }>;
}

export class HttpNativeApprovalClient implements NativeApprovalClient {
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    baseUrl = process.env.NATIVE_BRIDGE_URL || 'http://127.0.0.1:3002',
    secret = process.env.NATIVE_BRIDGE_SECRET || '',
    fetchImpl: typeof fetch = fetch,
  ) {
    let parsed: URL;
    try { parsed = new URL(baseUrl); } catch { throw new Error('NATIVE_APPROVAL_UNAVAILABLE'); }
    const host = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(host) || parsed.search || parsed.hash) {
      throw new Error('NATIVE_APPROVAL_UNAVAILABLE');
    }
    this.baseUrl = parsed.toString().replace(/\/$/, '');
    this.secret = secret;
    this.fetchImpl = fetchImpl;
  }

  async grant(request: NativeApprovalRequest): Promise<ApprovalReference> {
    return this.post('/internal/native/approve', request) as Promise<ApprovalReference>;
  }

  async verify(reference: ApprovalReference, plan: ExecutionPlan) {
    return this.post('/internal/native/verify', { approval_reference: reference, plan });
  }

  private async post(path: string, body: unknown): Promise<any> {
    if (!this.secret) throw new Error('NATIVE_APPROVAL_UNAVAILABLE');
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      redirect: 'error',
    });
    let payload: any = null;
    try { payload = await response.json(); } catch { /* normalized below */ }
    if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'NATIVE_APPROVAL_UNAVAILABLE');
    return payload?.data ?? payload;
  }
}
