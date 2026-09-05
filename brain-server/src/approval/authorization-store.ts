/**
 * Goal24 Checkpoint 7 (Lane A) - server-owned plan authorization store.
 *
 * CP7 V1 keeps authorization records in a bounded in-memory store. This is
 * documented honestly: after a Brain Server restart, pending and ready
 * authorization records are gone and every plan must be re-materialized and
 * re-approved (fail closed). The native replay ledger is persisted by
 * Lane B; this store is never a substitute for it.
 *
 * Bounds fail closed: a full store rejects new records with
 * APPROVAL_STORE_FULL instead of silently evicting a pending approval.
 */

import { PlanAuthorizationRecordSchema, type PlanAuthorizationRecord } from './contracts.js';
import { ApprovalError } from './errors.js';

export const DEFAULT_MAX_AUTHORIZATION_RECORDS = 200;

export class AuthorizationStore {
  private readonly records = new Map<string, PlanAuthorizationRecord>();
  private readonly maxRecords: number;

  constructor(maxRecords: number = DEFAULT_MAX_AUTHORIZATION_RECORDS) {
    if (!Number.isInteger(maxRecords) || maxRecords <= 0) {
      throw new ApprovalError('APPROVAL_INPUT_INVALID', 'maxRecords must be a positive integer');
    }
    this.maxRecords = maxRecords;
  }

  /** Insert a new record. Duplicate plan_id is APPROVAL_STORE_CONFLICT. */
  put(record: PlanAuthorizationRecord): void {
    const parsed = this.validate(record);
    const planId = parsed.plan.plan_id;
    if (this.records.has(planId)) {
      throw new ApprovalError(
        'APPROVAL_STORE_CONFLICT',
        `plan '${planId}' already exists; authorization plan ids are server-generated and unique`,
      );
    }
    if (this.records.size >= this.maxRecords) {
      throw new ApprovalError(
        'APPROVAL_STORE_FULL',
        `authorization store is full (${this.maxRecords} records); fail closed`,
      );
    }
    this.records.set(planId, parsed);
  }

  /** Replace an existing record (server-owned lifecycle transitions only). */
  replace(record: PlanAuthorizationRecord): void {
    const parsed = this.validate(record);
    const planId = parsed.plan.plan_id;
    if (!this.records.has(planId)) {
      throw new ApprovalError(
        'APPROVAL_PLAN_NOT_FOUND',
        `plan '${planId}' does not exist in the authorization store`,
      );
    }
    this.records.set(planId, parsed);
  }

  get(planId: string): PlanAuthorizationRecord | undefined {
    return this.records.get(planId);
  }

  has(planId: string): boolean {
    return this.records.has(planId);
  }

  /**
   * Remove a freshly prepared, still-unapproved record after its enclosing
   * server-owned transaction loses an idempotency race.  This is deliberately
   * narrower than a general delete operation: records carrying a grant or an
   * execution-capable state can never be removed through this method.
   */
  discardUncommitted(planId: string, expectedDecisionId: string): boolean {
    const record = this.records.get(planId);
    if (!record) return false;
    if (
      record.plan.decision_id !== expectedDecisionId
      || record.plan.state !== 'awaiting_approval'
      || record.plan.approval !== null
      || record.grant !== null
      || record.approval_request?.status !== 'pending'
    ) {
      return false;
    }
    return this.records.delete(planId);
  }

  /** Deterministic snapshot: sorted by plan_id ascending. */
  list(): PlanAuthorizationRecord[] {
    return [...this.records.values()].sort((a, b) => (a.plan.plan_id < b.plan.plan_id ? -1 : 1));
  }

  get size(): number {
    return this.records.size;
  }

  private validate(record: PlanAuthorizationRecord): PlanAuthorizationRecord {
    const parsed = PlanAuthorizationRecordSchema.safeParse(record);
    if (!parsed.success) {
      throw new ApprovalError(
        'APPROVAL_INPUT_INVALID',
        `authorization record is invalid: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    return parsed.data;
  }
}
