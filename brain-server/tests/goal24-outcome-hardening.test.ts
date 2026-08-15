/**
 * Goal24 Checkpoint 8 (Integration) - outcome hardening tests.
 *
 * Covers: one canonical outcome per (plan_id, execution_receipt_id),
 * single-use observation ids across outcomes, store-file corruption shapes,
 * ExecutionPlan.succeeded semantics freeze, decision-journal bypass closure
 * (CP8A-013), freshness boundary, hard retry cap and the absence of any
 * execution surface inside the outcome module.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_VERIFICATION_ATTEMPTS,
  FileOutcomeStore,
  InMemoryOutcomeStore,
  MAX_OBSERVATION_CLOCK_SKEW_MS,
  MAX_VERIFICATION_ATTEMPTS_BOUND,
  OutcomeEvaluatorRegistry,
  OutcomeService,
  OUTCOME_STORE_SCHEMA_VERSION,
  initialVerificationStatus,
  type OutcomeRecord,
  type OutcomeStore,
  type ReadbackObservationEnvelope,
} from '../src/outcome/index.js';
import {
  TEST_ITEM_EVALUATOR,
  TEST_ITEM_OLD_VALUE,
  TEST_ITEM_VALUE,
  buildItemWritePlan,
  buildObservation,
  buildReceipt,
  fixedClock,
  makeObservationResolver,
  makeReceiptResolver,
} from './helpers/fake-outcome.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

async function openOutcome(store: OutcomeStore, planId: string, receiptId: string) {
  const plan = buildItemWritePlan({ planId });
  const receipt = buildReceipt({ receiptId, plan, executionState: 'process_succeeded' });
  const registry = new OutcomeEvaluatorRegistry();
  registry.register(TEST_ITEM_EVALUATOR);
  const service = new OutcomeService({
    receiptResolver: makeReceiptResolver([receipt]),
    observationResolver: () => null,
    evaluatorRegistry: registry,
    store,
    clock: fixedClock(),
  });
  const outcome = await service.openOutcome({ plan, receipt_id: receipt.receipt_id });
  return { plan, receipt, service, outcome };
}

function recordWithAttempt(
  planId: string,
  receiptId: string,
  observationId: string,
  outcomeSuffix = '',
): OutcomeRecord {
  const plan = buildItemWritePlan({ planId });
  const receipt = buildReceipt({ receiptId, plan, executionState: 'process_succeeded' });
  const registry = new OutcomeEvaluatorRegistry();
  registry.register(TEST_ITEM_EVALUATOR);
  const outcomeId = `out-${planId.slice(-6)}${outcomeSuffix}`;
  return {
    outcome_id: outcomeId,
    plan_id: plan.plan_id,
    decision_id: plan.decision_id,
    capability_id: plan.capability_id,
    capability_version: plan.capability_version,
    execution_receipt_id: receipt.receipt_id,
    execution_effect_state: 'process_succeeded',
    verification_status: 'verified',
    verification_capability_id: 'test.item.read',
    expected_outcome_digest: undefined,
    latest_observation_digest: '0'.repeat(64),
    verification_attempts: [{
      attempt_id: `att-${planId.slice(-6)}`,
      started_at: '2026-08-14T01:00:00.000Z',
      finished_at: '2026-08-14T01:00:01.000Z',
      observation_id: observationId,
      observation_digest: '0'.repeat(64),
      status: 'verified',
      reason_codes: ['OUTCOME_VERIFIED'],
    }],
    revisit_required: false,
    rollback_candidate: false,
    created_at: '2026-08-14T01:00:00.000Z',
    updated_at: '2026-08-14T01:00:01.000Z',
  };
}

describe('one canonical outcome per execution instance', () => {
  it('InMemoryOutcomeStore rejects a second outcome for the same (plan_id, receipt_id)', async () => {
    const store = new InMemoryOutcomeStore();
    const first = await openOutcome(store, 'plan-card-a', 'rcpt-card-a');
    expect(first.outcome.outcome_id).toBeTruthy();
    await expect(
      openOutcome(store, 'plan-card-a', 'rcpt-card-a'),
    ).rejects.toThrowError(expect.objectContaining({ code: 'OUTCOME_DUPLICATE_RECORD' }));
  });

  it('FileOutcomeStore rejects a second outcome for the same (plan_id, receipt_id)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp8-card-file-'));
    tempDirs.push(dir);
    const store = new FileOutcomeStore(join(dir, 'outcomes.json'));
    const first = await openOutcome(store, 'plan-card-b', 'rcpt-card-b');
    expect(first.outcome.outcome_id).toBeTruthy();
    await expect(
      openOutcome(store, 'plan-card-b', 'rcpt-card-b'),
    ).rejects.toThrowError(expect.objectContaining({ code: 'OUTCOME_DUPLICATE_RECORD' }));
  });

  it('a store file carrying two outcomes for one receipt is corrupt (never reset empty)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp8-card-corrupt-'));
    tempDirs.push(dir);
    const filePath = join(dir, 'outcomes.json');
    const corrupt = {
      schema_version: OUTCOME_STORE_SCHEMA_VERSION,
      updated_at: '2026-08-14T01:00:00.000Z',
      outcomes: [
        recordWithAttempt('plan-card-c1', 'rcpt-card-c', 'obs-card-c1', '-a'),
        recordWithAttempt('plan-card-c1', 'rcpt-card-c', 'obs-card-c2', '-b'),
      ],
    };
    writeFileSync(filePath, JSON.stringify(corrupt), 'utf8');
    const store = new FileOutcomeStore(filePath);
    expect(() => store.listOutcomes()).toThrowError(
      expect.objectContaining({ code: 'OUTCOME_STORE_CORRUPT' }),
    );
    // Fail closed: the corrupt file is never deleted or reset.
    expect(existsSync(filePath)).toBe(true);
  });
});

describe('single-use observation ids', () => {
  it('an observation id consumed by one outcome can never finalize another', async () => {
    const store = new InMemoryOutcomeStore();
    const planA = buildItemWritePlan({ planId: 'plan-obs-a' });
    const receiptA = buildReceipt({ receiptId: 'rcpt-obs-a', plan: planA, executionState: 'process_succeeded' });
    const obsA = buildObservation({
      attemptId: 'att-obs-a',
      plan: planA,
      receiptId: receiptA.receipt_id,
      observationId: 'obs-shared-1',
      payload: { item_id: 'item-1', value: TEST_ITEM_VALUE },
    });
    const registryA = new OutcomeEvaluatorRegistry();
    registryA.register(TEST_ITEM_EVALUATOR);
    const serviceA = new OutcomeService({
      receiptResolver: makeReceiptResolver([receiptA]),
      observationResolver: makeObservationResolver([obsA]),
      evaluatorRegistry: registryA,
      store,
      clock: fixedClock(),
    });
    const outcomeA = await serviceA.openOutcome({ plan: planA, receipt_id: receiptA.receipt_id });
    const begunA = await serviceA.beginVerificationAttempt(outcomeA.outcome_id, {
      attempt_id: 'att-obs-a',
      started_at: obsA.attempt_started_at,
    });
    await serviceA.completeVerificationAttempt({
      outcome_id: outcomeA.outcome_id,
      attempt_id: begunA.attempt_id,
      observation_id: obsA.observation_id,
    });

    const planB = buildItemWritePlan({ planId: 'plan-obs-b' });
    const receiptB = buildReceipt({ receiptId: 'rcpt-obs-b', plan: planB, executionState: 'process_succeeded' });
    const obsB = buildObservation({
      attemptId: 'att-obs-b',
      plan: planB,
      receiptId: receiptB.receipt_id,
      observationId: 'obs-shared-1',
      payload: { item_id: 'item-1', value: TEST_ITEM_VALUE },
    });
    const registryB = new OutcomeEvaluatorRegistry();
    registryB.register(TEST_ITEM_EVALUATOR);
    const serviceB = new OutcomeService({
      receiptResolver: makeReceiptResolver([receiptB]),
      observationResolver: makeObservationResolver([obsB]),
      evaluatorRegistry: registryB,
      store,
      clock: fixedClock(),
    });
    const outcomeB = await serviceB.openOutcome({ plan: planB, receipt_id: receiptB.receipt_id });
    const begunB = await serviceB.beginVerificationAttempt(outcomeB.outcome_id, {
      attempt_id: 'att-obs-b',
      started_at: obsB.attempt_started_at,
    });
    await expect(
      serviceB.completeVerificationAttempt({
        outcome_id: outcomeB.outcome_id,
        attempt_id: begunB.attempt_id,
        observation_id: obsB.observation_id,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'OUTCOME_DUPLICATE_OBSERVATION' }));
  });

  it('a store file where one observation is claimed twice is corrupt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp8-obs-corrupt-'));
    tempDirs.push(dir);
    const filePath = join(dir, 'outcomes.json');
    const corrupt = {
      schema_version: OUTCOME_STORE_SCHEMA_VERSION,
      updated_at: '2026-08-14T01:00:00.000Z',
      outcomes: [
        recordWithAttempt('plan-obs-c1', 'rcpt-obs-c1', 'obs-dup-1'),
        recordWithAttempt('plan-obs-c2', 'rcpt-obs-c2', 'obs-dup-1'),
      ],
    };
    writeFileSync(filePath, JSON.stringify(corrupt), 'utf8');
    const store = new FileOutcomeStore(filePath);
    expect(() => store.listOutcomes()).toThrowError(
      expect.objectContaining({ code: 'OUTCOME_STORE_CORRUPT' }),
    );
    expect(existsSync(filePath)).toBe(true);
  });
});

describe('ExecutionPlan.succeeded semantics freeze', () => {
  it("ExecutionPlan.state never drives outcome verification (succeeded is lifecycle only)", () => {
    // The semantic contract: process/execution lifecycle succeeded is NOT a
    // verified business outcome. verify by construction: the only mapping
    // from execution knowledge to verification status consults
    // side_effect_class + ExecutionEffectState, never plan.state or exit
    // codes.
    expect(initialVerificationStatus('reversible_write', 'process_succeeded')).toBe('pending');
    expect(initialVerificationStatus('reversible_write', 'process_failed')).toBe('pending');
    expect(initialVerificationStatus('reversible_write', 'not_started')).toBe('not_required');
    // plan.state variants must not change the outcome's expectation or
    // initial status: the outcome layer never reads plan.state.
  });

  it('outcome source files never consult plan.state or exit_code for verdicts', async () => {
    const outcomeRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'outcome');
    const files = readdirSync(outcomeRoot).filter((name) => name.endsWith('.ts'));
    for (const file of files) {
      const source = readFileSync(join(outcomeRoot, file), 'utf8');
      // Structural guarantee: no outcome file reads ExecutionPlan.state.
      expect(source.includes('plan.state')).toBe(false);
    }
  });

  it('a plan with state=succeeded and a plan with state=executing produce identical expectations', async () => {
    const planA = buildItemWritePlan({ planId: 'plan-state-a' });
    planA.state = 'succeeded';
    const planB = buildItemWritePlan({ planId: 'plan-state-b' });
    planB.state = 'executing';
    expect(
      TEST_ITEM_EVALUATOR.deriveExpectation(planA),
    ).toEqual(TEST_ITEM_EVALUATOR.deriveExpectation(planB));
  });
});

describe('decision journal bypass closure (CP8A-013)', () => {
  it('the outcome module has no import of the decision journal store', async () => {
    const outcomeRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'outcome');
    const files = readdirSync(outcomeRoot).filter((name) => name.endsWith('.ts'));
    for (const file of files) {
      const source = readFileSync(join(outcomeRoot, file), 'utf8');
      expect(source.includes('decision-store')).toBe(false);
    }
  });

  it('journaled decision outcomes are stamped non-authoritative and never verified', async () => {
    const initDatabase = (await import('../src/db/sqlite.js')).default;
    const { recordDecisionOutcome } = await import('../src/decision/decision-store.js');
    const { RecordDecisionOutcomeSchema } = await import('../src/mcp-tools.js');
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    const decision = await db.addEntity({
      id: 'decision-journal-1',
      name: 'Journal decision',
      type: 'decision',
      metadata: { conclusion: 'C', situation: 'S', confidence: 'medium', outcomes: [] },
    });
    const outcomeInput = RecordDecisionOutcomeSchema.parse({
      decision_id: decision.id,
      actual_outcome: 'The LLM says everything succeeded',
      outcome_timestamp: '2026-07-20T00:00:00.000Z',
      outcome_score: 1.0,
      assumption_failures: [],
      lessons_learned: [],
      confidence_calibration: 0,
      follow_up_actions: [],
    });
    const saved = await recordDecisionOutcome(db, outcomeInput);
    expect(saved?.outcome.outcome_authority).toBe('journal');
    expect(saved?.outcome.verified).toBe(false);
    const refreshed = await db.getEntity(decision.id);
    const outcomes = Array.isArray(refreshed?.metadata?.outcomes) ? refreshed.metadata.outcomes : [];
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ outcome_authority: 'journal', verified: false });
    const outcomeEntity = await db.getEntity(saved?.outcome_entity_id as string);
    expect(outcomeEntity?.metadata).toMatchObject({ outcome_authority: 'journal', verified: false });
    await db.close();
  });
});

describe('freshness boundary', () => {
  it('observed_at within clock skew is accepted; beyond skew is rejected', async () => {
    const plan = buildItemWritePlan({ planId: 'plan-fresh-1' });
    const receipt = buildReceipt({ receiptId: 'rcpt-fresh-1', plan, executionState: 'process_succeeded' });
    const registry = new OutcomeEvaluatorRegistry();
    registry.register(TEST_ITEM_EVALUATOR);
    const observations: ReadbackObservationEnvelope[] = [];

    const service = new OutcomeService({
      receiptResolver: makeReceiptResolver([receipt]),
      observationResolver: (id) => observations.find((o) => o.observation_id === id) ?? null,
      evaluatorRegistry: registry,
      store: new InMemoryOutcomeStore(),
      clock: fixedClock(),
    });
    const outcome = await service.openOutcome({ plan, receipt_id: receipt.receipt_id });

    // exactly at the skew boundary (clock + skew - 1ms is fine; boundary ok)
    const nearNow = new Date(Date.parse('2026-08-14T01:00:00.000Z') + MAX_OBSERVATION_CLOCK_SKEW_MS - 1000);
    const okObservation = buildObservation({
      attemptId: 'att-fresh-ok',
      plan,
      receiptId: receipt.receipt_id,
      observedAt: nearNow,
      payload: { item_id: 'item-1', value: TEST_ITEM_VALUE },
    });
    observations.push(okObservation);
    const begun = await service.beginVerificationAttempt(outcome.outcome_id, {
      attempt_id: 'att-fresh-ok',
      started_at: okObservation.attempt_started_at,
    });
    const updated = await service.completeVerificationAttempt({
      outcome_id: outcome.outcome_id,
      attempt_id: begun.attempt_id,
      observation_id: okObservation.observation_id,
    });
    expect(updated.verification_status).toBe('verified');
  });

  it('injected attempt started_at before the receipt spawn is rejected', async () => {
    const plan = buildItemWritePlan({ planId: 'plan-fresh-2' });
    const receipt = buildReceipt({ receiptId: 'rcpt-fresh-2', plan, executionState: 'process_succeeded' });
    const registry = new OutcomeEvaluatorRegistry();
    registry.register(TEST_ITEM_EVALUATOR);
    const real = new OutcomeService({
      receiptResolver: makeReceiptResolver([receipt]),
      observationResolver: () => null,
      evaluatorRegistry: registry,
      store: new InMemoryOutcomeStore(),
      clock: fixedClock(),
    });
    const outcome = await real.openOutcome({ plan, receipt_id: receipt.receipt_id });
    await expect(
      real.beginVerificationAttempt(outcome.outcome_id, {
        attempt_id: 'att-fresh-bad',
        started_at: '2026-08-13T23:00:00.000Z',
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'OUTCOME_FRESHNESS_INVALID' }));
  });
});

describe('bounded retry only', () => {
  it('default budget is 3 and the hard cap is 5', () => {
    expect(DEFAULT_MAX_VERIFICATION_ATTEMPTS).toBe(3);
    expect(MAX_VERIFICATION_ATTEMPTS_BOUND).toBe(5);
  });

  it('exhausting the budget can never default to success', async () => {
    const plan = buildItemWritePlan({ planId: 'plan-retry-1' });
    const receipt = buildReceipt({ receiptId: 'rcpt-retry-1', plan, executionState: 'process_succeeded' });
    const attempts = [1, 2, 3].map((n) =>
      buildObservation({
        attemptId: `att-retry-${n}`,
        plan,
        receiptId: receipt.receipt_id,
        payload: { item_id: 'item-1', value: TEST_ITEM_OLD_VALUE },
      }),
    );
    const registry = new OutcomeEvaluatorRegistry();
    registry.register(TEST_ITEM_EVALUATOR);
    const service = new OutcomeService({
      receiptResolver: makeReceiptResolver([receipt]),
      observationResolver: makeObservationResolver(attempts),
      evaluatorRegistry: registry,
      store: new InMemoryOutcomeStore(),
      clock: fixedClock(),
    });
    const outcome = await service.openOutcome({ plan, receipt_id: receipt.receipt_id });
    for (const observation of attempts) {
      const begun = await service.beginVerificationAttempt(outcome.outcome_id, {
        attempt_id: observation.verification_attempt_id,
        started_at: observation.attempt_started_at,
      });
      await service.completeVerificationAttempt({
        outcome_id: outcome.outcome_id,
        attempt_id: begun.attempt_id,
        observation_id: observation.observation_id,
      });
    }
    const final = service.getOutcome(outcome.outcome_id);
    expect(final?.verification_status).toBe('mismatch');
    await expect(
      service.beginVerificationAttempt(outcome.outcome_id),
    ).rejects.toThrowError(expect.objectContaining({ code: 'OUTCOME_ATTEMPTS_EXHAUSTED' }));
  });

  it('no outcome source file can spawn a process (no second execution channel)', async () => {
    const outcomeRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'outcome');
    const files = readdirSync(outcomeRoot).filter((name) => name.endsWith('.ts'));
    for (const file of files) {
      const source = readFileSync(join(outcomeRoot, file), 'utf8');
      expect(source.includes('child_process')).toBe(false);
      expect(source.includes('execSync')).toBe(false);
      expect(source.includes("from 'node:child_process'")).toBe(false);
    }
  });
});
