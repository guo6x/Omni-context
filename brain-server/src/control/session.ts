import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const CONTROL_APPROVE_SCOPE = 'control:approve' as const;
export const CONTROL_VERIFY_SCOPE = 'control:verify' as const;
export const CONTROL_SCOPES = [CONTROL_APPROVE_SCOPE, CONTROL_VERIFY_SCOPE] as const;
export type ControlScope = (typeof CONTROL_SCOPES)[number];
export const CONTROL_SESSION_TTL_MS = 5 * 60 * 1000;
export const CONTROL_SESSION_MAX_TTL_MS = 15 * 60 * 1000;
export const CONTROL_SESSION_BURST_MAX = 10;
export const CONTROL_SESSION_BURST_WINDOW_MS = 60_000;

export interface ControlSession {
  session_id: string;
  scope: ControlScope;
  actor_id: 'local-owner';
  actor_kind: 'owner';
  authority: 'L3';
  issued_at: string;
  expires_at: string;
}

interface StoredSession extends ControlSession {
  token_digest: string;
  request_count: number;
  reset_at_ms: number;
}

function digestToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

function equalDigest(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export class ControlSessionManager {
  private readonly sessions = new Map<string, StoredSession>();

  mint(scopeOrNow: ControlScope | number = CONTROL_APPROVE_SCOPE, now = Date.now()): { token: string; session: ControlSession } {
    // Preserve the D1B-1 test/application call shape mint(now) while adding
    // the explicit verify scope in D1B-2.
    const scope: ControlScope = typeof scopeOrNow === 'number' ? CONTROL_APPROVE_SCOPE : scopeOrNow;
    const issuedNow = typeof scopeOrNow === 'number' ? scopeOrNow : now;
    const issued = new Date(issuedNow);
    const expires = new Date(issuedNow + CONTROL_SESSION_TTL_MS);
    const token = `ocs_${randomBytes(32).toString('base64url')}`;
    const session: StoredSession = {
      session_id: `cs_${randomBytes(16).toString('hex')}`,
      scope,
      actor_id: 'local-owner',
      actor_kind: 'owner',
      authority: 'L3',
      issued_at: issued.toISOString(),
      expires_at: expires.toISOString(),
      token_digest: digestToken(token).toString('hex'),
      request_count: 0,
      reset_at_ms: issuedNow + CONTROL_SESSION_BURST_WINDOW_MS,
    };
    this.sessions.set(session.session_id, session);
    return { token, session: this.publicSession(session) };
  }

  authenticate(token: string, now = Date.now()): ControlSession | null {
    if (!token) return null;
    const digest = digestToken(token).toString('hex');
    for (const [id, stored] of this.sessions) {
      if (Date.parse(stored.expires_at) <= now) {
        this.sessions.delete(id);
        continue;
      }
      if (equalDigest(Buffer.from(stored.token_digest, 'hex'), Buffer.from(digest, 'hex'))) {
        return this.publicSession(stored);
      }
    }
    return null;
  }

  consumeBurst(sessionId: string, now = Date.now()): boolean {
    const stored = this.sessions.get(sessionId);
    if (!stored || Date.parse(stored.expires_at) <= now) {
      if (stored) this.sessions.delete(sessionId);
      return false;
    }
    if (stored.reset_at_ms <= now) {
      stored.reset_at_ms = now + CONTROL_SESSION_BURST_WINDOW_MS;
      stored.request_count = 0;
    }
    stored.request_count += 1;
    return stored.request_count <= CONTROL_SESSION_BURST_MAX;
  }

  revoke(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  revokeAll(): void {
    this.sessions.clear();
  }

  private publicSession(session: StoredSession): ControlSession {
    const { token_digest: _digest, request_count: _count, reset_at_ms: _reset, ...publicValue } = session;
    return publicValue;
  }
}

export function readBearerToken(req: { headers: Record<string, string | string[] | undefined> }): string {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  return value?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
}
