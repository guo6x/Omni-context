import type { Database } from '../db/sqlite.js';
import { canonicalJson } from '../evidence/model.js';
import { sha256Hex } from '../evidence/index.js';
import {
  DecisionRevisionEventSchema,
  DecisionRevisionRecordSchema,
  type DecisionRevisionEvent,
  type DecisionRevisionRecord,
  type DecisionRevisionProjection,
  REVISION_PROJECTION_EVIDENCE_DELTA_LIMIT,
  REVISION_PROJECTION_HISTORY_LIMIT,
  REVISION_PROJECTION_REASON_CODE_LIMIT,
} from './contracts.js';
import { RevisionError } from './errors.js';

interface RevisionRow {
  revision_id: string;
  root_decision_id: string;
  parent_decision_id: string;
  revision_index: number;
  status: string;
  idempotency_digest: string;
  new_decision_id: string | null;
  record_json: string;
}

interface RevisionEventRow {
  event_json: string;
}

function parseRecord(row: RevisionRow): DecisionRevisionRecord {
  try {
    return DecisionRevisionRecordSchema.parse(JSON.parse(row.record_json));
  } catch {
    throw new RevisionError('REVISION_PERSISTENCE_FAILURE', `revision '${row.revision_id}' is corrupt`);
  }
}

function eventsFor(record: DecisionRevisionRecord): DecisionRevisionEvent[] {
  const payload = {
    root_decision_id: record.root_decision_id,
    parent_decision_id: record.parent_decision_id,
    revision_index: record.revision_index,
    trigger_type: record.trigger_type,
    disposition: record.new_disposition,
    new_decision_id: record.new_decision_id,
  };
  return [
    'REOPEN_REQUESTED',
    'REOPEN_AUTHORIZED',
    'REVISION_CREATED',
    'EVIDENCE_REQUALIFIED',
    'REVISION_DECIDED',
  ].map((event_type) => DecisionRevisionEventSchema.parse({
    revision_id: record.revision_id,
    event_type,
    created_at: record.resolved_at ?? record.opened_at,
    payload,
  }));
}

function expectedIdempotencyDigest(record: DecisionRevisionRecord): string {
  return sha256Hex(canonicalJson({
    root_decision_id: record.root_decision_id,
    parent_decision_id: record.parent_decision_id,
    trigger_type: record.trigger_type,
    trigger_outcome_id: record.trigger_outcome_id,
    trigger_reason: record.trigger_reason,
    authorized_by: record.authorized_by,
  }));
}

/**
 * The only writer for the persistent revision chain.  The database migration
 * adds immutable rows and immutable audit events; this class intentionally
 * exposes no update, delete, patch, or generic SQL mutation operation.
 */
export class SqliteDecisionRevisionStore {
  constructor(private readonly db: Database) {}

  async getByIdempotency(idempotencyDigest: string): Promise<DecisionRevisionRecord | null> {
    const row = await this.db.get<RevisionRow>(
      `SELECT revision_id, root_decision_id, parent_decision_id, revision_index, status,
              idempotency_digest, new_decision_id, record_json
       FROM decision_revisions WHERE idempotency_digest = ?`,
      [idempotencyDigest],
    );
    return row ? parseRecord(row) : null;
  }

  async getRevision(revisionId: string): Promise<DecisionRevisionRecord | null> {
    const row = await this.db.get<RevisionRow>(
      `SELECT revision_id, root_decision_id, parent_decision_id, revision_index, status,
              idempotency_digest, new_decision_id, record_json
       FROM decision_revisions WHERE revision_id = ?`,
      [revisionId],
    );
    return row ? parseRecord(row) : null;
  }

  async getRevisionForNewDecision(decisionId: string): Promise<DecisionRevisionRecord | null> {
    const row = await this.db.get<RevisionRow>(
      `SELECT revision_id, root_decision_id, parent_decision_id, revision_index, status,
              idempotency_digest, new_decision_id, record_json
       FROM decision_revisions WHERE new_decision_id = ?`,
      [decisionId],
    );
    return row ? parseRecord(row) : null;
  }

  async listForRoot(rootDecisionId: string): Promise<DecisionRevisionRecord[]> {
    const rows = await this.db.all<RevisionRow>(
      `SELECT revision_id, root_decision_id, parent_decision_id, revision_index, status,
              idempotency_digest, new_decision_id, record_json
       FROM decision_revisions WHERE root_decision_id = ? ORDER BY revision_index ASC`,
      [rootDecisionId],
    );
    return rows.map(parseRecord);
  }

  async nextRevisionIndex(rootDecisionId: string): Promise<number> {
    const row = await this.db.get<{ revision_index: number }>(
      `SELECT revision_index FROM decision_revisions
       WHERE root_decision_id = ? ORDER BY revision_index DESC LIMIT 1`,
      [rootDecisionId],
    );
    return (row?.revision_index ?? 0) + 1;
  }

  async projectionForDecision(decisionId: string): Promise<DecisionRevisionProjection | null> {
    const direct = await this.getRevisionForNewDecision(decisionId);
    const asParent = direct ? null : await this.db.get<RevisionRow>(
      `SELECT revision_id, root_decision_id, parent_decision_id, revision_index, status,
              idempotency_digest, new_decision_id, record_json
       FROM decision_revisions WHERE parent_decision_id = ? ORDER BY revision_index ASC LIMIT 1`,
      [decisionId],
    );
    const first = direct ?? (asParent ? parseRecord(asParent) : null);
    if (!first) return null;
    const chain = await this.listForRoot(first.root_decision_id);
    const latest = chain[chain.length - 1];
    if (!latest || !latest.new_decision_id || !latest.new_disposition) {
      throw new RevisionError('REVISION_PERSISTENCE_FAILURE', `revision chain '${first.root_decision_id}' is incomplete`);
    }
    const visibleHistory = chain.slice(-REVISION_PROJECTION_HISTORY_LIMIT);
    const evidenceDeltaSummary = latest.context.evidence_delta
      .slice(0, REVISION_PROJECTION_EVIDENCE_DELTA_LIMIT)
      .map((entry) => ({
        evidence_class: entry.evidence_class,
        category: entry.category,
        original_status: entry.original_status,
        current_status: entry.current_status,
      }));
    return {
      root_decision_id: first.root_decision_id,
      original_decision_id: first.root_decision_id,
      parent_decision_id: latest.parent_decision_id,
      current_decision_id: latest.new_decision_id,
      revision_index: latest.revision_index,
      revision_count: chain.length,
      revision_status: latest.status,
      trigger_type: latest.trigger_type,
      revisit_required: latest.context.original.outcome.revisit_required,
      reopen_recommended: latest.context.original.outcome.verification_status === 'mismatch'
        || latest.context.original.outcome.verification_status === 'inconclusive',
      latest_outcome: latest.context.original.outcome.verification_status,
      outcome_reason_codes: latest.context.original.outcome.reason_codes.slice(0, REVISION_PROJECTION_REASON_CODE_LIMIT),
      current_disposition: latest.new_disposition,
      // The store cannot infer dynamic plan state without an authorization
      // runtime, so the service fills this only when it can read the
      // server-owned plan. Null is safer than guessing after a restart.
      new_plan_pending_approval: null,
      evidence_delta_summary: evidenceDeltaSummary,
      history_truncated: chain.length > visibleHistory.length,
      history: visibleHistory.map((entry) => ({
        revision_id: entry.revision_id,
        revision_index: entry.revision_index,
        parent_decision_id: entry.parent_decision_id,
        new_decision_id: entry.new_decision_id!,
        trigger_type: entry.trigger_type,
        status: entry.status,
        new_disposition: entry.new_disposition!,
        opened_at: entry.opened_at,
        resolved_at: entry.resolved_at!,
        revision_context_digest: entry.revision_context_digest,
      })),
    };
  }

  /**
   * Insert one already-resolved revision atomically.  All database-visible
   * links, decision identity and audit events commit together or not at all.
   * A duplicate idempotency digest returns the existing revision without
   * incrementing the chain.
   */
  async createResolvedOrGet(rawRecord: unknown): Promise<{ record: DecisionRevisionRecord; created: boolean }> {
    const parsed = DecisionRevisionRecordSchema.safeParse(rawRecord);
    if (!parsed.success || parsed.data.status !== 'DECIDED') {
      throw new RevisionError('REVISION_CONTEXT_INVALID', 'only a complete DECIDED revision may be persisted');
    }
    const record = parsed.data;
    if (!record.new_decision_id) {
      throw new RevisionError('REVISION_CONTEXT_INVALID', 'a resolved revision must have a new decision id');
    }
    if (record.revision_context_digest !== sha256Hex(canonicalJson(record.context))) {
      throw new RevisionError('REVISION_CONTEXT_INVALID', 'revision context digest does not match its canonical context');
    }
    if (record.idempotency_digest !== expectedIdempotencyDigest(record)) {
      throw new RevisionError('REVISION_CONTEXT_INVALID', 'revision idempotency digest does not match its immutable intent');
    }

    return this.db.withTransaction(async () => {
      const existingByIdempotency = await this.getByIdempotency(record.idempotency_digest);
      if (existingByIdempotency) return { record: existingByIdempotency, created: false };

      if (record.new_decision_id === record.root_decision_id || record.new_decision_id === record.parent_decision_id) {
        throw new RevisionError('REVISION_CYCLE_BLOCKED', 'a revised decision may not point back to its root or parent');
      }

      // A decision identity is globally linear: it cannot be reborn as a
      // root, parent, or child of a second chain.  The unique SQL indexes
      // catch races; this explicit check makes all non-race backlinks fail
      // closed with the stable revision-integrity error vocabulary.
      const newDecisionCollision = await this.db.get<{ revision_id: string }>(
        `SELECT revision_id FROM decision_revisions
         WHERE root_decision_id = ? OR parent_decision_id = ? OR new_decision_id = ?
         LIMIT 1`,
        [record.new_decision_id, record.new_decision_id, record.new_decision_id],
      );
      if (newDecisionCollision) {
        throw new RevisionError('REVISION_CYCLE_BLOCKED', `new decision '${record.new_decision_id}' is already linked to a revision chain`);
      }
      const derivedRootCollision = await this.db.get<{ revision_id: string }>(
        'SELECT revision_id FROM decision_revisions WHERE new_decision_id = ? LIMIT 1',
        [record.root_decision_id],
      );
      if (derivedRootCollision) {
        throw new RevisionError('REVISION_CYCLE_BLOCKED', 'a derived decision cannot become the root of another revision chain');
      }

      const chain = await this.listForRoot(record.root_decision_id);
      const active = chain.find((entry) => entry.status === 'OPEN');
      if (active) {
        throw new RevisionError('REVISION_ACTIVE_EXISTS', `root '${record.root_decision_id}' already has an open revision`);
      }
      const expectedIndex = chain.length + 1;
      if (record.revision_index !== expectedIndex) {
        throw new RevisionError('REVISION_INDEX_INVALID', `expected revision index ${expectedIndex}`);
      }
      if (chain.length === 0) {
        if (record.root_decision_id !== record.parent_decision_id) {
          throw new RevisionError('REVISION_CYCLE_BLOCKED', 'the first revision parent must be its root decision');
        }
      } else {
        const latest = chain[chain.length - 1];
        if (latest?.new_decision_id !== record.parent_decision_id) {
          throw new RevisionError('REVISION_FORK_BLOCKED', 'only the latest decision in a V1 chain can be reopened');
        }
      }

      const existingParent = await this.db.get<{ revision_id: string }>(
        'SELECT revision_id FROM decision_revisions WHERE parent_decision_id = ?',
        [record.parent_decision_id],
      );
      if (existingParent) {
        throw new RevisionError('REVISION_FORK_BLOCKED', `parent '${record.parent_decision_id}' already has a revision`);
      }

      await this.db.run(
        `INSERT INTO decision_revisions (
          revision_id, root_decision_id, parent_decision_id, revision_index,
          status, idempotency_digest, new_decision_id, record_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.revision_id,
          record.root_decision_id,
          record.parent_decision_id,
          record.revision_index,
          record.status,
          record.idempotency_digest,
          record.new_decision_id,
          canonicalJson(record),
          record.opened_at,
        ],
      );
      for (const event of eventsFor(record)) {
        await this.db.run(
          `INSERT INTO decision_revision_events (revision_id, event_type, event_json, created_at)
           VALUES (?, ?, ?, ?)`,
          [event.revision_id, event.event_type, canonicalJson(event), event.created_at],
        );
      }
      return { record, created: true };
    });
  }

  async listEvents(revisionId: string): Promise<DecisionRevisionEvent[]> {
    const rows = await this.db.all<RevisionEventRow>(
      'SELECT event_json FROM decision_revision_events WHERE revision_id = ? ORDER BY id ASC',
      [revisionId],
    );
    return rows.map((row) => {
      try {
        return DecisionRevisionEventSchema.parse(JSON.parse(row.event_json));
      } catch {
        throw new RevisionError('REVISION_PERSISTENCE_FAILURE', `revision audit event for '${revisionId}' is corrupt`);
      }
    });
  }
}
