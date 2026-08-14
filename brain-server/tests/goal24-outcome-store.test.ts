/**
 * Goal24 Checkpoint 8 (Lane A) - persistent outcome store tests.
 *
 * FileOutcomeStore V1: strict schema_version parsing, temp write + atomic
 * rename, serialized mutations, restart persistence and fail-closed
 * corruption handling (corruption never resets to an empty store).
 * Transition validation guarantees immutable identity fields and append-only
 * attempt history.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FileOutcomeStore,
  InMemoryOutcomeStore,
  OUTCOME_STORE_SCHEMA_VERSION,
  type OutcomeRecord,
  type VerificationAttemptRecord,
} from '../src/outcome/index.js';
import { OutcomeError } from '../src/outcome/index.js';
import { TEST_OUTCOME_NOW } from './helpers/fake-outcome.js';

const tempDirs: string[] = [];

function tempStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cp8-outcome-store-'));
  tempDirs.push(dir);
  return join(dir, 'outcomes.json');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeAttempt(overrides: Partial<VerificationAttemptRecord> = {}): VerificationAttemptRecord {
  return {
    attempt_id: overrides.attempt_id ?? 'att-store-1',
    started_at: overrides.started_at ?? TEST_OUTCOME_NOW.toISOString(),
    finished_at: overrides.finished_at ?? new Date(TEST_OUTCOME_NOW.getTime() + 1_000).toISOString(),
    status: overrides.status ?? 'verified',
    reason_codes: overrides.reason_codes ?? ['OUTCOME_VERIFIED'],
  };
}

type RecordOverrides = Partial<OutcomeRecord> & {
  /** Sentinel: remove the key entirely (useful for optional fields). */
  expected_outcome_digest?: string | null;
  verification_capability_id?: string | null;
};

function makeRecord(overrides: RecordOverrides = {}): OutcomeRecord {
  const created = overrides.created_at ?? TEST_OUTCOME_NOW.toISOString();
  const attempts = overrides.verification_attempts ?? [];
  const status = overrides.verification_status ?? (attempts.length > 0 ? attempts[attempts.length - 1].status : 'pending');
  const record: Record<string, unknown> = {
    outcome_id: overrides.outcome_id ?? 'out-store-1',
    plan_id: overrides.plan_id ?? 'plan-write-1',
    decision_id: overrides.decision_id ?? 'decision-1',
    capability_id: overrides.capability_id ?? 'test.item.update',
    capability_version: overrides.capability_version ?? '1.0.0',
    execution_receipt_id: overrides.execution_receipt_id ?? 'receipt-1',
    execution_effect_state: overrides.execution_effect_state ?? 'process_succeeded',
    verification_status: status,
    verification_capability_id: overrides.verification_capability_id === null ? undefined : (overrides.verification_capability_id ?? 'test.item.read'),
    expected_outcome_digest: overrides.expected_outcome_digest === null ? undefined : (overrides.expected_outcome_digest ?? '0'.repeat(64)),
    latest_observation_digest: overrides.latest_observation_digest,
    verification_attempts: attempts,
    revisit_required: overrides.revisit_required ?? false,
    rollback_candidate: overrides.rollback_candidate ?? false,
    created_at: created,
    updated_at: overrides.updated_at ?? created,
    correlation_id: overrides.correlation_id,
  };
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) delete record[key];
  }
  return record as unknown as OutcomeRecord;
}

describe('FileOutcomeStore persistence', () => {
  it('creates, lists and reads outcomes from disk', async () => {
    const path = tempStorePath();
    const store = new FileOutcomeStore(path);
    const record = makeRecord();
    await store.createOutcome(record);
    expect(store.getOutcome('out-store-1')).toEqual(record);
    expect(store.listOutcomes()).toEqual([record]);
  });

  it('preserves status and full attempt history across a store restart', async () => {
    const path = tempStorePath();
    const first = new FileOutcomeStore(path);
    const created = makeRecord({ verification_status: 'pending' });
    await first.createOutcome(created);

    const attemptOne = makeAttempt({ attempt_id: 'att-store-1', status: 'mismatch', reason_codes: ['OUTCOME_MISMATCH'] });
    const afterAttempt = {
      ...created,
      verification_status: 'pending',
      verification_attempts: [attemptOne],
      updated_at: new Date(TEST_OUTCOME_NOW.getTime() + 1_000).toISOString(),
    };
    await first.updateOutcome(afterAttempt);

    const attemptTwo = makeAttempt({
      attempt_id: 'att-store-2',
      status: 'verified',
      reason_codes: ['OUTCOME_VERIFIED'],
      started_at: new Date(TEST_OUTCOME_NOW.getTime() + 2_000).toISOString(),
      finished_at: new Date(TEST_OUTCOME_NOW.getTime() + 3_000).toISOString(),
    });
    const finalized = {
      ...afterAttempt,
      verification_status: 'verified',
      verification_attempts: [attemptOne, attemptTwo],
      revisit_required: false,
      updated_at: new Date(TEST_OUTCOME_NOW.getTime() + 3_000).toISOString(),
    };
    await first.updateOutcome(finalized);

    const restarted = new FileOutcomeStore(path);
    const reloaded = restarted.getOutcome('out-store-1');
    expect(reloaded).toBeDefined();
    expect(reloaded?.verification_status).toBe('verified');
    expect(reloaded?.verification_attempts).toEqual([attemptOne, attemptTwo]);
    expect(reloaded?.verification_attempts).toHaveLength(2);
  });

  it('leaves no temp files behind after mutations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp8-outcome-store-'));
    tempDirs.push(dir);
    const path = join(dir, 'outcomes.json');
    const store = new FileOutcomeStore(path);
    await store.createOutcome(makeRecord());
    await store.updateOutcome({
      ...makeRecord(),
      verification_status: 'pending',
      verification_attempts: [makeAttempt({ status: 'mismatch', reason_codes: ['OUTCOME_MISMATCH'] })],
      updated_at: new Date(TEST_OUTCOME_NOW.getTime() + 1_000).toISOString(),
    });
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('serializes concurrent mutations through the mutation queue', async () => {
    const path = tempStorePath();
    const store = new FileOutcomeStore(path);
    const created = makeRecord({ verification_status: 'pending' });
    await store.createOutcome(created);
    const base = {
      ...created,
      verification_status: 'pending',
      verification_attempts: [makeAttempt({ attempt_id: 'att-store-1', status: 'mismatch', reason_codes: ['OUTCOME_MISMATCH'] })],
      updated_at: new Date(TEST_OUTCOME_NOW.getTime() + 1_000).toISOString(),
    };
    await store.updateOutcome(base);
    const firstUpdate = {
      ...base,
      verification_attempts: [
        ...base.verification_attempts,
        makeAttempt({ attempt_id: 'att-store-2', status: 'verified', reason_codes: ['OUTCOME_VERIFIED'] }),
      ],
      verification_status: 'verified',
      updated_at: new Date(TEST_OUTCOME_NOW.getTime() + 2_000).toISOString(),
    };
    await Promise.all([store.updateOutcome(firstUpdate)]);
    expect(store.getOutcome('out-store-1')?.verification_attempts).toHaveLength(2);
  });
});

describe('FileOutcomeStore corruption (fail closed)', () => {
  it('malformed JSON fails closed with OUTCOME_STORE_CORRUPT', () => {
    const path = tempStorePath();
    writeFileSync(path, '{not json', 'utf8');
    const store = new FileOutcomeStore(path);
    expect(() => store.listOutcomes()).toThrowError(OutcomeError);
    expect(() => store.listOutcomes()).toThrowError(/not valid JSON/);
  });

  it('truncated JSON fails closed', () => {
    const path = tempStorePath();
    writeFileSync(path, '{"schema_version":1,"outcomes":[', 'utf8');
    const store = new FileOutcomeStore(path);
    expect(() => store.listOutcomes()).toThrowError(/not valid JSON/);
  });

  it('unknown schema version fails closed', () => {
    const path = tempStorePath();
    writeFileSync(path, JSON.stringify({ schema_version: 99, updated_at: TEST_OUTCOME_NOW.toISOString(), outcomes: [] }), 'utf8');
    const store = new FileOutcomeStore(path);
    expect(() => store.listOutcomes()).toThrowError(/corrupt/);
  });

  it('unknown fields fail closed', () => {
    const path = tempStorePath();
    writeFileSync(
      path,
      JSON.stringify({
        schema_version: OUTCOME_STORE_SCHEMA_VERSION,
        updated_at: TEST_OUTCOME_NOW.toISOString(),
        outcomes: [],
        extra_field: true,
      }),
      'utf8',
    );
    const store = new FileOutcomeStore(path);
    expect(() => store.listOutcomes()).toThrowError(/corrupt/);
  });

  it('duplicate outcome_id fails closed', () => {
    const path = tempStorePath();
    const record = makeRecord();
    writeFileSync(
      path,
      JSON.stringify({
        schema_version: OUTCOME_STORE_SCHEMA_VERSION,
        updated_at: TEST_OUTCOME_NOW.toISOString(),
        outcomes: [record, record],
      }),
      'utf8',
    );
    const store = new FileOutcomeStore(path);
    expect(() => store.listOutcomes()).toThrowError(/duplicate outcome_ids/);
  });

  it('duplicate attempt_id fails closed', () => {
    const path = tempStorePath();
    const attempt = makeAttempt({ status: 'mismatch', reason_codes: ['OUTCOME_MISMATCH'] });
    const record = makeRecord({
      verification_status: 'pending',
      verification_attempts: [attempt, { ...attempt, finished_at: new Date(TEST_OUTCOME_NOW.getTime() + 2_000).toISOString() }],
    });
    writeFileSync(
      path,
      JSON.stringify({
        schema_version: OUTCOME_STORE_SCHEMA_VERSION,
        updated_at: TEST_OUTCOME_NOW.toISOString(),
        outcomes: [record],
      }),
      'utf8',
    );
    const store = new FileOutcomeStore(path);
    expect(() => store.listOutcomes()).toThrowError(/unique attempt_ids/);
  });

  it('invalid record inside the file fails closed', () => {
    const path = tempStorePath();
    const record = makeRecord({ verification_status: 'verified', verification_attempts: [] });
    writeFileSync(
      path,
      JSON.stringify({
        schema_version: OUTCOME_STORE_SCHEMA_VERSION,
        updated_at: TEST_OUTCOME_NOW.toISOString(),
        outcomes: [record],
      }),
      'utf8',
    );
    const store = new FileOutcomeStore(path);
    expect(() => store.listOutcomes()).toThrowError(/corrupt/);
  });

  it('corruption never resets the store to an empty state', () => {
    const path = tempStorePath();
    writeFileSync(path, '{broken', 'utf8');
    const store = new FileOutcomeStore(path);
    expect(() => store.listOutcomes()).toThrowError(OutcomeError);
    expect(() => store.getOutcome('out-store-1')).toThrowError(OutcomeError);
    expect(existsSync(path)).toBe(true); // the corrupt file is untouched
  });
});

describe('outcome transition validation', () => {
  it('rejects illegal verification_status transitions', async () => {
    const store = new InMemoryOutcomeStore();
    const record = makeRecord({ verification_status: 'not_required', verification_capability_id: null, expected_outcome_digest: null });
    await store.createOutcome(record);
    await expect(store.updateOutcome({ ...record, verification_status: 'pending', updated_at: new Date(TEST_OUTCOME_NOW.getTime() + 1_000).toISOString() })).rejects.toThrowError(/cannot transition not_required -> pending/);
  });

  it('rejects identity field mutation', async () => {
    const store = new InMemoryOutcomeStore();
    const record = makeRecord();
    await store.createOutcome(record);
    await expect(
      store.updateOutcome({ ...record, plan_id: 'plan-write-2', updated_at: new Date(TEST_OUTCOME_NOW.getTime() + 1_000).toISOString() }),
    ).rejects.toThrowError(/immutable field 'plan_id'/);
  });

  it('rejects rewriting existing attempt history (immutable audit trail)', async () => {
    const store = new InMemoryOutcomeStore();
    const created = makeRecord({ verification_status: 'pending' });
    await store.createOutcome(created);
    const attempt = makeAttempt({ status: 'mismatch', reason_codes: ['OUTCOME_MISMATCH'] });
    const withAttempt = {
      ...created,
      verification_attempts: [attempt],
      updated_at: new Date(TEST_OUTCOME_NOW.getTime() + 1_000).toISOString(),
    };
    await store.updateOutcome(withAttempt);
    const rewritten = {
      ...withAttempt,
      verification_attempts: [{ ...attempt, reason_codes: ['OUTCOME_VERIFIED'], status: 'verified' }],
      verification_status: 'verified',
      updated_at: new Date(TEST_OUTCOME_NOW.getTime() + 2_000).toISOString(),
    };
    await expect(store.updateOutcome(rewritten)).rejects.toThrowError(/attempt history was rewritten/);
  });

  it('rejects shrinking attempt history', async () => {
    const store = new InMemoryOutcomeStore();
    const created = makeRecord({ verification_status: 'pending' });
    await store.createOutcome(created);
    const attempt = makeAttempt({ status: 'mismatch', reason_codes: ['OUTCOME_MISMATCH'] });
    const withAttempt = {
      ...created,
      verification_attempts: [attempt],
      updated_at: new Date(TEST_OUTCOME_NOW.getTime() + 1_000).toISOString(),
    };
    await store.updateOutcome(withAttempt);
    await expect(
      store.updateOutcome({ ...withAttempt, verification_attempts: [], updated_at: new Date(TEST_OUTCOME_NOW.getTime() + 2_000).toISOString() }),
    ).rejects.toThrowError(/history can never shrink/);
  });

  it('rejects updated_at regressions', async () => {
    const store = new InMemoryOutcomeStore();
    const record = makeRecord({ updated_at: new Date(TEST_OUTCOME_NOW.getTime() + 5_000).toISOString() });
    await store.createOutcome(record);
    await expect(
      store.updateOutcome({ ...record, updated_at: new Date(TEST_OUTCOME_NOW.getTime() + 4_000).toISOString() }),
    ).rejects.toThrowError(/updated_at must be monotonic/);
  });

  it('rejects expected_outcome_digest mutation', async () => {
    const store = new InMemoryOutcomeStore();
    const record = makeRecord();
    await store.createOutcome(record);
    await expect(
      store.updateOutcome({ ...record, expected_outcome_digest: 'a'.repeat(64), updated_at: new Date(TEST_OUTCOME_NOW.getTime() + 1_000).toISOString() }),
    ).rejects.toThrowError(/expected_outcome_digest is immutable/);
  });

  it('rejects duplicate create and unknown update', async () => {
    const store = new InMemoryOutcomeStore();
    const record = makeRecord();
    await store.createOutcome(record);
    await expect(store.createOutcome(record)).rejects.toThrowError(/already exists/);
    await expect(store.updateOutcome({ ...makeRecord({ outcome_id: 'out-store-2' }) })).rejects.toThrowError(/does not exist/);
  });

  it('rejects structurally invalid records at create', async () => {
    const store = new InMemoryOutcomeStore();
    const broken = makeRecord({ verification_status: 'verified', verification_attempts: [] });
    await expect(store.createOutcome(broken)).rejects.toThrowError(/record is invalid/);
  });
});
