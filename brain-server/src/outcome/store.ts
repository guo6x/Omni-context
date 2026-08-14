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

export class InMemoryOutcomeStore implements OutcomeStore {
  private readonly outcomes = new Map<string, OutcomeRecord>();

  async createOutcome(record: OutcomeRecord): Promise<void> {
    if (this.outcomes.has(record.outcome_id)) {
      throw new OutcomeError('OUTCOME_DUPLICATE_RECORD', `outcome '${record.outcome_id}' already exists`);
    }
    validateCreateOutcome(record);
    this.outcomes.set(record.outcome_id, record);
  }

  getOutcome(outcomeId: string): OutcomeRecord | undefined {
    return this.outcomes.get(outcomeId);
  }

  async updateOutcome(record: OutcomeRecord): Promise<void> {
    const existing = this.outcomes.get(record.outcome_id);
    if (!existing) {
      throw new OutcomeError('OUTCOME_NOT_FOUND', `outcome '${record.outcome_id}' does not exist`);
    }
    validateOutcomeTransition(existing, record);
    this.outcomes.set(record.outcome_id, record);
  }

  listOutcomes(): readonly OutcomeRecord[] {
    return [...this.outcomes.values()].sort((left, right) =>
      left.outcome_id.localeCompare(right.outcome_id),
    );
  }
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
  return `${canonicalJson(file)}\n`;
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
