/**
 * Goal24 Checkpoint 8 (Lane A) - Persistent outcome store.
 *
 * Brain owns outcome persistence. The store interface is server-owned:
 * - createOutcome requires a strict, structurally valid record;
 * - updateOutcome validates the transition fail-closed (immutable identity
 *   fields, append-only attempt history, legal status transitions);
 * - finalized audit history can never be destructively mutated. A future
 *   Revisit creates a new revision/outcome instead of overwriting history.
 *
 * FileOutcomeStore V1 writes with a temp file + fsync + atomic rename and
 * serializes all mutations through a promise queue. Corruption (malformed
 * JSON, truncation, unknown schema version, unknown fields, duplicate
 * outcome/attempt ids) fails closed with OUTCOME_STORE_CORRUPT - it never
 * resets to an empty store. The constructor takes a trusted file path; the
 * path is wired by trusted runtime code and is never a caller-chosen value.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  OutcomeRecordSchema,
  OutcomeStoreFileSchema,
  OUTCOME_STORE_SCHEMA_VERSION,
  type OutcomeRecord,
} from './contracts.js';
import { OutcomeError } from './errors.js';
import { parseOutcomeRecord, validateOutcomeTransition } from './lifecycle.js';
import { canonicalJson } from '../evidence/model.js';

export interface OutcomeStore {
  createOutcome(record: OutcomeRecord): Promise<void>;
  getOutcome(outcomeId: string): OutcomeRecord | undefined;
  updateOutcome(record: OutcomeRecord): Promise<void>;
  listOutcomes(): readonly OutcomeRecord[];
}

/** Shared create validation (both stores fail closed identically). */
export function validateCreateOutcome(record: OutcomeRecord): OutcomeRecord {
  const parsed = OutcomeRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new OutcomeError(
      'OUTCOME_TRANSITION_INVALID',
      `outcome record is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

/** Canonical execution instance identity: one OutcomeRecord per receipt. */
export function executionInstanceKey(record: OutcomeRecord): string {
  return `${record.plan_id}|${record.execution_receipt_id}`;
}

/**
 * All observation ids currently claimed by stored outcomes. An observation
 * is single-use: it can only finalize exactly one verification attempt of
 * exactly one outcome (replay defense).
 */
export function collectObservationClaims(
  outcomes: readonly OutcomeRecord[],
): Map<string, string> {
  const claims = new Map<string, string>();
  for (const record of outcomes) {
    for (const attempt of record.verification_attempts) {
      if (!attempt.observation_id) continue;
      const existing = claims.get(attempt.observation_id);
      if (existing !== undefined && existing !== record.outcome_id) {
        throw new OutcomeError(
          'OUTCOME_STORE_CORRUPT',
          `observation '${attempt.observation_id}' is claimed by more than one outcome`,
        );
      }
      claims.set(attempt.observation_id, record.outcome_id);
    }
  }
  return claims;
}

export class InMemoryOutcomeStore implements OutcomeStore {
  private readonly outcomes = new Map<string, OutcomeRecord>();

  async createOutcome(record: OutcomeRecord): Promise<void> {
    if (this.outcomes.has(record.outcome_id)) {
      throw new OutcomeError('OUTCOME_DUPLICATE_RECORD', `outcome '${record.outcome_id}' already exists`);
    }
    const parsed = validateCreateOutcome(record);
    this.assertCanonicalInstanceFree(parsed);
    this.outcomes.set(parsed.outcome_id, parsed);
  }

  getOutcome(outcomeId: string): OutcomeRecord | undefined {
    return this.outcomes.get(outcomeId);
  }

  async updateOutcome(record: OutcomeRecord): Promise<void> {
    const existing = this.outcomes.get(record.outcome_id);
    if (!existing) {
      throw new OutcomeError('OUTCOME_NOT_FOUND', `outcome '${record.outcome_id}' does not exist`);
    }
    const after = validateOutcomeTransition(existing, record);
    this.assertObservationClaimsFree(after);
    this.outcomes.set(after.outcome_id, after);
  }

  private assertCanonicalInstanceFree(record: OutcomeRecord): void {
    const key = executionInstanceKey(record);
    for (const existing of this.outcomes.values()) {
      if (executionInstanceKey(existing) === key) {
        throw new OutcomeError(
          'OUTCOME_DUPLICATE_RECORD',
          `an outcome already exists for plan '${record.plan_id}' / receipt '${record.execution_receipt_id}' (one canonical outcome per execution instance)`,
        );
      }
    }
  }

  private assertObservationClaimsFree(record: OutcomeRecord): void {
    const claims = collectObservationClaims([...this.outcomes.values()]);
    for (const attempt of record.verification_attempts) {
      if (!attempt.observation_id) continue;
      const owner = claims.get(attempt.observation_id);
      if (owner !== undefined && owner !== record.outcome_id) {
        throw new OutcomeError(
          'OUTCOME_DUPLICATE_OBSERVATION',
          `observation '${attempt.observation_id}' was already consumed by another outcome`,
        );
      }
    }
  }

  listOutcomes(): readonly OutcomeRecord[] {
    return [...this.outcomes.values()].sort((left, right) =>
      left.outcome_id.localeCompare(right.outcome_id),
    );
  }
}

/**
 * Strip undefined-valued optional keys before canonical serialization:
 * optional zod fields parse as `key: undefined` and canonicalJson fails
 * closed on undefined. JSON.stringify semantics (undefined keys dropped)
 * are the canonical form; this mirrors what a JSON round-trip produces.
 */
function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) {
        out[key] = stripUndefined(item);
      }
    }
    return out;
  }
  return value;
}

function serializeStoreFile(outcomes: readonly OutcomeRecord[], updatedAt: string): string {
  const sorted = [...outcomes].sort((left, right) =>
    left.outcome_id.localeCompare(right.outcome_id),
  );
  const file = OutcomeStoreFileSchema.parse({
    schema_version: OUTCOME_STORE_SCHEMA_VERSION,
    updated_at: updatedAt,
    outcomes: sorted,
  });
  return `${canonicalJson(stripUndefined(file))}\n`;
}

function parseStoreFile(contents: string): OutcomeRecord[] {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    throw new OutcomeError('OUTCOME_STORE_CORRUPT', 'outcome store file is not valid JSON');
  }
  const parsed = OutcomeStoreFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OutcomeError(
      'OUTCOME_STORE_CORRUPT',
      `outcome store file is corrupt: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  for (const record of parsed.data.outcomes) {
    parseOutcomeRecord(record);
  }
  return parsed.data.outcomes;
}

export class FileOutcomeStore implements OutcomeStore {
  private readonly filePath: string;
  private readonly outcomes = new Map<string, OutcomeRecord>();
  private mutationQueue: Promise<void> = Promise.resolve();
  private loaded = false;

  /**
   * Trusted constructor path. The path is chosen by trusted wiring code at
   * construction time and is never exposed to callers.
   */
  constructor(filePath: string) {
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
      throw new OutcomeError('OUTCOME_INPUT_INVALID', 'store file path must be a non-empty trusted string');
    }
    this.filePath = filePath;
  }

  private load(): void {
    if (this.loaded) return;
    if (!existsSync(this.filePath)) {
      this.loaded = true; // fresh store is a valid empty state
      return;
    }
    const contents = readFileSync(this.filePath, 'utf8');
    const records = parseStoreFile(contents);
    for (const record of records) {
      this.outcomes.set(record.outcome_id, record);
    }
    // Rebuild the canonical-instance and observation-claim indexes from the
    // persisted history. A file carrying two outcomes for one receipt, one
    // receipt bound to two different plans, or one observation claimed twice
    // is corrupt and fails closed (never resets).
    const instances = new Set<string>();
    const planByReceipt = new Map<string, string>();
    for (const record of records) {
      const key = executionInstanceKey(record);
      if (instances.has(key)) {
        throw new OutcomeError(
          'OUTCOME_STORE_CORRUPT',
          `outcome store carries more than one outcome for plan/receipt '${key}'`,
        );
      }
      instances.add(key);
      const existingPlan = planByReceipt.get(record.execution_receipt_id);
      if (existingPlan !== undefined && existingPlan !== record.plan_id) {
        throw new OutcomeError(
          'OUTCOME_STORE_CORRUPT',
          `receipt '${record.execution_receipt_id}' is bound to more than one plan`,
        );
      }
      planByReceipt.set(record.execution_receipt_id, record.plan_id);
    }
    collectObservationClaims(records);
    // Only mark loaded after a fully successful parse: a corrupt file keeps
    // failing closed on every access instead of silently looking empty.
    this.loaded = true;
  }

  /** Serialize every mutation; a failed mutation never blocks later ones. */
  private enqueue(mutation: () => void): Promise<void> {
    const task = this.mutationQueue.then(() => {
      this.load();
      mutation();
    });
    this.mutationQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  createOutcome(record: OutcomeRecord): Promise<void> {
    return this.enqueue(() => {
      if (this.outcomes.has(record.outcome_id)) {
        throw new OutcomeError('OUTCOME_DUPLICATE_RECORD', `outcome '${record.outcome_id}' already exists`);
      }
      const parsed = validateCreateOutcome(record);
      const key = executionInstanceKey(parsed);
      for (const existing of this.outcomes.values()) {
        if (executionInstanceKey(existing) === key) {
          throw new OutcomeError(
            'OUTCOME_DUPLICATE_RECORD',
            `an outcome already exists for plan '${parsed.plan_id}' / receipt '${parsed.execution_receipt_id}' (one canonical outcome per execution instance)`,
          );
        }
      }
      this.outcomes.set(parsed.outcome_id, parsed);
      this.persist();
    });
  }

  getOutcome(outcomeId: string): OutcomeRecord | undefined {
    this.load();
    return this.outcomes.get(outcomeId);
  }

  updateOutcome(record: OutcomeRecord): Promise<void> {
    return this.enqueue(() => {
      const existing = this.outcomes.get(record.outcome_id);
      if (!existing) {
        throw new OutcomeError('OUTCOME_NOT_FOUND', `outcome '${record.outcome_id}' does not exist`);
      }
      const after = validateOutcomeTransition(existing, record);
      const claims = collectObservationClaims([...this.outcomes.values()]);
      for (const attempt of after.verification_attempts) {
        if (!attempt.observation_id) continue;
        const owner = claims.get(attempt.observation_id);
        if (owner !== undefined && owner !== after.outcome_id) {
          throw new OutcomeError(
            'OUTCOME_DUPLICATE_OBSERVATION',
            `observation '${attempt.observation_id}' was already consumed by another outcome`,
          );
        }
      }
      this.outcomes.set(after.outcome_id, after);
      this.persist();
    });
  }

  listOutcomes(): readonly OutcomeRecord[] {
    this.load();
    return [...this.outcomes.values()].sort((left, right) =>
      left.outcome_id.localeCompare(right.outcome_id),
    );
  }

  /** Temp write + fsync + atomic rename + best-effort directory fsync. */
  private persist(): void {
    const tempPath = join(dirname(this.filePath), `.${randomUUID()}.outcomes.tmp`);
    let fd: number | undefined;
    try {
      const contents = serializeStoreFile([...this.outcomes.values()], new Date().toISOString());
      fd = openSync(tempPath, 'w');
      writeFileSync(fd, contents, 'utf8');
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(tempPath, this.filePath);
    } catch (error) {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          // best effort cleanup
        }
      }
      try {
        if (existsSync(tempPath)) unlinkSync(tempPath);
      } catch {
        // best effort cleanup
      }
      throw new OutcomeError(
        'OUTCOME_STORE_CORRUPT',
        `outcome store write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      const dirFd = openSync(dirname(this.filePath), 'r');
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {
      // Directory fsync is not supported on Windows; the rename is already
      // complete and the data file itself was fsynced. Best effort only.
    }
  }
}
