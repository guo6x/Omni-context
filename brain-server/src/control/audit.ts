/**
 * D1B-1 approval audit boundary.
 *
 * The control surface records security-relevant decisions without retaining
 * bearer tokens, native bridge secrets, Authorization headers, or normalized
 * request inputs. The store is deliberately injected so production can swap
 * in a durable append-only sink while tests can exercise fail-closed behavior.
 */

import type { Database } from '../db/sqlite.js';

export type ControlApprovalAuditResult = 'approved' | 'rejected' | 'failed';

export interface ControlApprovalAuditEvent {
  request_timestamp: string;
  /** Non-secret server-issued control session identifier. */
  session_reference: string;
  actor_id_or_scope: string;
  scope: string;
  plan_id: string | null;
  decision_id: string | null;
  action: 'approve';
  result: ControlApprovalAuditResult;
  failure_reason: string | null;
  transport_context: {
    channel: 'public-control';
    loopback: true;
    origin: 'absent';
    host: 'validated';
  };
}

export interface ControlApprovalAuditStore {
  /** Check capacity / sink health before any native approval side effect. */
  ensureWritable(): void | Promise<void>;
  append(event: ControlApprovalAuditEvent): void | Promise<void>;
}

export const DEFAULT_CONTROL_AUDIT_MAX_EVENTS = 2_000;

/**
 * Bounded local append-only store. It is intentionally small and explicit:
 * exhausting capacity rejects the next approval rather than dropping audit
 * evidence or silently evicting older entries.
 */
export class InMemoryControlApprovalAuditStore implements ControlApprovalAuditStore {
  private readonly events: ControlApprovalAuditEvent[] = [];

  constructor(private readonly maxEvents = DEFAULT_CONTROL_AUDIT_MAX_EVENTS) {
    if (!Number.isInteger(maxEvents) || maxEvents <= 0) {
      throw new Error('CONTROL_AUDIT_STORE_INVALID_CAPACITY');
    }
  }

  ensureWritable(): void {
    if (this.events.length >= this.maxEvents) {
      throw new Error('CONTROL_AUDIT_STORE_FULL');
    }
  }

  append(event: ControlApprovalAuditEvent): void {
    this.ensureWritable();
    // Store a detached copy so callers cannot mutate an already-written event.
    this.events.push(JSON.parse(JSON.stringify(event)) as ControlApprovalAuditEvent);
  }

  list(): ControlApprovalAuditEvent[] {
    return this.events.map((event) => JSON.parse(JSON.stringify(event)) as ControlApprovalAuditEvent);
  }

  get size(): number {
    return this.events.length;
  }
}

/** Durable production writer backed by the Brain SQLite database. */
export class SqliteControlApprovalAuditStore implements ControlApprovalAuditStore {
  constructor(
    private readonly db: Database,
    private readonly maxEvents = DEFAULT_CONTROL_AUDIT_MAX_EVENTS,
  ) {
    if (!Number.isInteger(maxEvents) || maxEvents <= 0) {
      throw new Error('CONTROL_AUDIT_STORE_INVALID_CAPACITY');
    }
  }

  async ensureWritable(): Promise<void> {
    const row = await this.db.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM control_approval_audit',
    );
    if ((row?.count ?? 0) >= this.maxEvents) throw new Error('CONTROL_AUDIT_STORE_FULL');
  }

  async append(event: ControlApprovalAuditEvent): Promise<void> {
    // The conditional INSERT closes the capacity check race between concurrent
    // approval requests. No row is evicted when the bound is reached.
    const result = await this.db.run(
      `INSERT INTO control_approval_audit (
        request_timestamp, session_reference, actor_id_or_scope, scope,
        plan_id, decision_id, action, result, failure_reason, transport_context
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM control_approval_audit) < ?`,
      [
        event.request_timestamp,
        event.session_reference,
        event.actor_id_or_scope,
        event.scope,
        event.plan_id,
        event.decision_id,
        event.action,
        event.result,
        event.failure_reason,
        JSON.stringify(event.transport_context),
        this.maxEvents,
      ],
    );
    if ((result.changes ?? 0) !== 1) throw new Error('CONTROL_AUDIT_STORE_FULL');
  }
}
