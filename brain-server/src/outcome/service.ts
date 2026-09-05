/**
 * Goal24 Checkpoint 8 (Lane A) - Outcome service.
 *
 * The trusted verification pipeline:
 *
 *   openOutcome({ plan, receipt_id })
 *     -> trusted receipt resolver (receipt_id only; raw BrokerExecutionResult
 *        can never enter as caller authority)
 *     -> receipt integrity + plan binding
 *     -> initial verification status (execution success is NOT verified)
 *     -> trusted OutcomeEvaluatorV1 derives the expectation
 *     -> core-generated outcome_id, core-computed expected_outcome_digest
 *     -> persistent OutcomeRecord
 *
 *   beginVerificationAttempt(outcome_id)
 *     -> bounded retry budget (max 5, V1 default 3), pending state only
 *     -> core-generated attempt_id (memory-only until finalized)
 *
 *   completeVerificationAttempt({ outcome_id, attempt_id, observation_id })
 *     -> trusted observation resolver (observation_id only; handcrafted
 *        payloads can never finalize an outcome)
 *     -> plan/receipt/attempt/capability/subject binding checks
 *     -> expectation stability check (OUTCOME_EXPECTATION_CHANGED)
 *     -> parser/truncation gate (malformed/unsupported/truncated -> fail
 *        closed verification_failed BEFORE any evaluator runs)
 *     -> deterministic evaluator result (verified/mismatch/inconclusive)
 *     -> attempt appended (history is immutable), status transition
 *     -> revisit_required / rollback_candidate derived (candidate only;
 *        CP8 never executes a rollback)
 *
 * LLM text ("mark verified"), skill procedures and evidence notes can never
 * reach any of these paths: the only inputs are server-owned ids.
 *
 * No process execution, no shell, no Broker/gh calls exist in this module.
 */

import { randomUUID } from 'node:crypto';
import {
  ExecutionPlanSchema,
  type ExecutionPlan,
} from '../execution/contracts.js';
import {
  OutcomeRecordSchema,
  type OutcomeRecord,
  type ReadbackObservationEnvelope,
  type TrustedExecutionReceipt,
  type VerificationAttemptRecord,
} from './contracts.js';
import {
  normalizedInputsDigest,
  observationDigest,
  outcomeExpectationDigest,
  validateObservationEnvelope,
  verificationPlanDigest,
  verifyReceiptIntegrity,
} from './digests.js';
import { OutcomeError } from './errors.js';
import {
  parseEvaluationResult,
  validateExpectationFromEvaluator,
  type EvaluationResult,
  type OutcomeEvaluatorV1,
} from './evaluator.js';
import { OutcomeEvaluatorRegistry } from './evaluator-registry.js';
import {
  assertExpectationMatchesRecord,
  assertValidOutcomeId,
  attemptsExhausted,
  DEFAULT_MAX_VERIFICATION_ATTEMPTS,
  deriveRevisitRequired,
  deriveRollbackCandidate,
  initialVerificationStatus,
  MAX_VERIFICATION_ATTEMPTS_BOUND,
  nextVerificationStatus,
} from './lifecycle.js';
import type { OutcomeStore } from './store.js';
import {
  ATTEMPT_ID_PATTERN,
  IsoTimestampSchema,
  MAX_OBSERVATION_CLOCK_SKEW_MS,
  type OutcomeExpectation,
} from './contracts.js';

export type TrustedReceiptResolver = (receiptId: string) => TrustedExecutionReceipt | null;
export type TrustedObservationResolver = (observationId: string) => ReadbackObservationEnvelope | null;

export interface OutcomeServiceOptions {
  /** Trusted native receipt resolver (Lane A: fake in tests; Lane B: native broker). */
  receiptResolver: TrustedReceiptResolver;
  /** Trusted observation resolver (Lane A: fake in tests; Lane B: native read-back bridge). */
  observationResolver: TrustedObservationResolver;
  /** Internal trusted evaluator registry (application code only). */
  evaluatorRegistry: OutcomeEvaluatorRegistry;
  /** Persistent outcome store (server-owned). */
  store: OutcomeStore;
  /** Trusted injected clock; defaults to the system clock. Callers cannot submit time. */
  clock?: () => Date;
  /** Retry budget per outcome; bounded to [1, MAX_VERIFICATION_ATTEMPTS_BOUND]. */
  maxVerificationAttempts?: number;
}

interface OutcomeRuntimeContext {
  plan: ExecutionPlan;
  receipt: TrustedExecutionReceipt;
  expectation: OutcomeExpectation;
  evaluator: OutcomeEvaluatorV1;
}

interface PendingAttempt {
  attempt_id: string;
  started_at: string;
}

/**
 * Server-internal, bounded context used only to construct an immutable
 * DecisionRevision snapshot.  It intentionally contains no native bridge
 * handles, raw process output, grant material or mutable store reference.
 */
export interface TrustedOutcomeRevisionContext {
  outcome: OutcomeRecord;
  expected_state: import('../contracts/json-safe.js').JsonObject | null;
  trusted_observed_state: import('../contracts/json-safe.js').JsonObject | null;
  observation_id: string | null;
}

export function generateOutcomeId(): string {
  return `out-${randomUUID()}`;
}

export function generateAttemptId(): string {
  return `att-${randomUUID()}`;
}

export interface BeginVerificationAttemptResult {
  outcome_id: string;
  attempt_id: string;
  started_at: string;
}

export class OutcomeService {
  private readonly receiptResolver: TrustedReceiptResolver;
  private readonly observationResolver: TrustedObservationResolver;
  private readonly evaluatorRegistry: OutcomeEvaluatorRegistry;
  private readonly store: OutcomeStore;
  private readonly clock: () => Date;
  private readonly maxVerificationAttempts: number;
  /** Server-owned in-memory runtime context (plan + expectation) keyed by outcome. */
  private readonly contextByOutcome = new Map<string, OutcomeRuntimeContext>();
  /** Server-owned in-memory pending attempt slots (finalized attempts persist). */
  private readonly pendingAttempts = new Map<string, PendingAttempt>();

  constructor(options: OutcomeServiceOptions) {
    if (typeof options.receiptResolver !== 'function') {
      throw new OutcomeError('OUTCOME_INPUT_INVALID', 'receiptResolver must be a function');
    }
    if (typeof options.observationResolver !== 'function') {
      throw new OutcomeError('OUTCOME_INPUT_INVALID', 'observationResolver must be a function');
    }
    if (!(options.evaluatorRegistry instanceof OutcomeEvaluatorRegistry)) {
      throw new OutcomeError('OUTCOME_INPUT_INVALID', 'evaluatorRegistry must be an OutcomeEvaluatorRegistry');
    }
    if (!options.store || typeof options.store.createOutcome !== 'function') {
      throw new OutcomeError('OUTCOME_INPUT_INVALID', 'store must implement OutcomeStore');
    }
    const maxAttempts = options.maxVerificationAttempts ?? DEFAULT_MAX_VERIFICATION_ATTEMPTS;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_VERIFICATION_ATTEMPTS_BOUND) {
      throw new OutcomeError(
        'OUTCOME_INPUT_INVALID',
        `maxVerificationAttempts must be between 1 and ${MAX_VERIFICATION_ATTEMPTS_BOUND}`,
      );
    }
    this.receiptResolver = options.receiptResolver;
    this.observationResolver = options.observationResolver;
    this.evaluatorRegistry = options.evaluatorRegistry;
    this.store = options.store;
    this.clock = options.clock ?? (() => new Date());
    this.maxVerificationAttempts = maxAttempts;
  }

  /**
   * Open a server-owned outcome record for an executed plan. The plan is
   * passed by server-internal trusted code (the AuthorizationService
   * pipeline); the receipt is resolved by id through the trusted resolver.
   */
  async openOutcome(input: { plan: ExecutionPlan; receipt_id: string }): Promise<OutcomeRecord> {
    const planParsed = ExecutionPlanSchema.safeParse(input.plan);
    if (!planParsed.success) {
      throw new OutcomeError(
        'OUTCOME_INPUT_INVALID',
        `plan is invalid: ${planParsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    const plan = planParsed.data;

    const receipt = this.receiptResolver(input.receipt_id);
    if (receipt === null) {
      throw new OutcomeError('OUTCOME_RECEIPT_UNAVAILABLE', `no trusted receipt for '${input.receipt_id}'`);
    }
    const verifiedReceipt = verifyReceiptIntegrity(receipt);
    this.bindReceiptToPlan(verifiedReceipt, plan);

    const now = this.clock();
    const nowIso = now.toISOString();
    const executionEffectState = verifiedReceipt.execution_state;
    const verificationStatus = initialVerificationStatus(
      plan.risk_snapshot.side_effect_class,
      executionEffectState,
    );

    let expectation: OutcomeExpectation | null = null;
    let evaluationContext: OutcomeRuntimeContext | null = null;
    let expectedDigest: string | undefined;
    if (verificationStatus === 'pending') {
      // Write path: a trusted evaluator must exist and bind the declared
      // verification capability before any outcome can be opened.
      const verificationPlan = plan.verification_plan;
      if (!verificationPlan) {
        throw new OutcomeError('OUTCOME_INPUT_INVALID', 'write plan must carry a verification_plan');
      }
      const evaluator = this.evaluatorRegistry.getForCapability(plan.capability_id);
      if (!evaluator) {
        throw new OutcomeError('OUTCOME_EVALUATOR_NOT_FOUND', `no trusted evaluator for capability '${plan.capability_id}'`);
      }
      if (evaluator.metadata.verification_capability_id !== verificationPlan.verification_capability_id) {
        throw new OutcomeError(
          'OUTCOME_EVALUATOR_NOT_FOUND',
          `evaluator verification capability '${evaluator.metadata.verification_capability_id}' does not match plan '${verificationPlan.verification_capability_id}'`,
        );
      }
      expectation = validateExpectationFromEvaluator(evaluator, evaluator.deriveExpectation(plan));
      expectedDigest = outcomeExpectationDigest(expectation);
      evaluationContext = { plan, receipt: verifiedReceipt, expectation, evaluator };
    }

    const record = OutcomeRecordSchema.parse({
      outcome_id: generateOutcomeId(),
      plan_id: plan.plan_id,
      decision_id: plan.decision_id,
      capability_id: plan.capability_id,
      capability_version: plan.capability_version,
      execution_receipt_id: verifiedReceipt.receipt_id,
      execution_effect_state: executionEffectState,
      verification_status: verificationStatus,
      verification_capability_id: plan.verification_plan?.verification_capability_id,
      expected_outcome_digest: expectedDigest,
      latest_observation_digest: undefined,
      verification_attempts: [],
      revisit_required: deriveRevisitRequired(verificationStatus),
      rollback_candidate: false,
      created_at: nowIso,
      updated_at: nowIso,
      correlation_id: plan.correlation_id,
    });

    if (expectation !== null && evaluationContext !== null) {
      this.contextByOutcome.set(record.outcome_id, evaluationContext);
    }
    await this.store.createOutcome(record);
    return record;
  }

  /**
   * Begin a bounded verification attempt (memory-only until finalized).
   *
   * The optional injected attempt is the trusted internal bridge contract:
   * the native layer can reserve a durable single-use attempt id BEFORE it
   * spawns the read-back process and hand that reservation to the service
   * (server-owned internal injection, never caller JSON). Without an
   * injected attempt the core generates its own id/clock pair. In both
   * cases the attempt slot is server-owned memory until a trusted
   * observation finalizes it.
   */
  async beginVerificationAttempt(
    outcomeId: string,
    injected?: { attempt_id: string; started_at: string },
  ): Promise<BeginVerificationAttemptResult> {
    assertValidOutcomeId(outcomeId);
    const outcome = this.store.getOutcome(outcomeId);
    if (!outcome) {
      throw new OutcomeError('OUTCOME_NOT_FOUND', `outcome '${outcomeId}' does not exist`);
    }
    if (outcome.verification_status === 'not_required') {
      throw new OutcomeError('OUTCOME_VERIFICATION_NOT_REQUIRED', `outcome '${outcomeId}' does not require verification`);
    }
    if (outcome.verification_status !== 'pending') {
      throw new OutcomeError(
        'OUTCOME_ATTEMPTS_EXHAUSTED',
        `outcome '${outcomeId}' exhausted its verification attempts (terminal status: ${outcome.verification_status})`,
      );
    }
    if (attemptsExhausted(outcome.verification_attempts.length, this.maxVerificationAttempts)) {
      throw new OutcomeError('OUTCOME_ATTEMPTS_EXHAUSTED', `outcome '${outcomeId}' exhausted its ${this.maxVerificationAttempts}-attempt budget`);
    }
    if (this.pendingAttempts.has(outcomeId)) {
      throw new OutcomeError('OUTCOME_TRANSITION_INVALID', `outcome '${outcomeId}' already has an in-flight verification attempt`);
    }
    const attemptId = injected?.attempt_id ?? generateAttemptId();
    if (!ATTEMPT_ID_PATTERN.test(attemptId)) {
      throw new OutcomeError('OUTCOME_INPUT_INVALID', 'attempt_id must be a valid attempt identifier');
    }
    const context = this.contextByOutcome.get(outcomeId);
    if (context && context.receipt.spawn_started_at) {
      const spawnStarted = Date.parse(context.receipt.spawn_started_at);
      if (injected?.started_at) {
        const started = Date.parse(injected.started_at);
        if (Number.isNaN(started)) {
          throw new OutcomeError('OUTCOME_INPUT_INVALID', 'started_at must be a valid timestamp');
        }
        if (started < spawnStarted) {
          throw new OutcomeError(
            'OUTCOME_FRESHNESS_INVALID',
            'attempt must not start before the execution receipt spawned',
          );
        }
        if (started > this.clock().getTime() + MAX_OBSERVATION_CLOCK_SKEW_MS) {
          throw new OutcomeError('OUTCOME_FRESHNESS_INVALID', 'attempt started_at is in the future beyond allowed clock skew');
        }
      }
    }
    const startedAt = injected?.started_at ?? this.clock().toISOString();
    if (!IsoTimestampSchema.safeParse(startedAt).success) {
      throw new OutcomeError('OUTCOME_INPUT_INVALID', 'started_at must be an ISO-8601 timestamp with offset');
    }
    for (const attempt of outcome.verification_attempts) {
      if (attempt.attempt_id === attemptId) {
        throw new OutcomeError('OUTCOME_ATTEMPT_MISMATCH', 'attempt_id was already finalized for this outcome');
      }
    }
    this.pendingAttempts.set(outcomeId, { attempt_id: attemptId, started_at: startedAt });
    return { outcome_id: outcomeId, attempt_id: attemptId, started_at: startedAt };
  }

  /**
   * Finalize the in-flight attempt with a trusted observation resolved by
   * id. A caller can only supply ids; handcrafted payloads, LLM text, skill
   * claims and evidence notes cannot reach this path.
   */
  async completeVerificationAttempt(input: {
    outcome_id: string;
    attempt_id: string;
    observation_id: string;
  }): Promise<OutcomeRecord> {
    assertValidOutcomeId(input.outcome_id);
    const outcome = this.store.getOutcome(input.outcome_id);
    if (!outcome) {
      throw new OutcomeError('OUTCOME_NOT_FOUND', `outcome '${input.outcome_id}' does not exist`);
    }

    try {
      const context = this.contextByOutcome.get(input.outcome_id);
      if (!context) {
        // Process restart invalidates in-memory plan/expectation context
        // (fail closed): re-materialize the outcome before verifying.
        throw new OutcomeError(
          'OUTCOME_CONTEXT_UNAVAILABLE',
          `no runtime context for outcome '${input.outcome_id}' (Brain restart invalidates in-flight verification)`,
        );
      }

      const pending = this.pendingAttempts.get(input.outcome_id);
      if (!pending || pending.attempt_id !== input.attempt_id) {
        throw new OutcomeError(
          'OUTCOME_ATTEMPT_MISMATCH',
          `attempt '${input.attempt_id}' is not the in-flight attempt for outcome '${input.outcome_id}'`,
        );
      }

      const observation = this.observationResolver(input.observation_id);
      if (observation === null) {
        throw new OutcomeError('OUTCOME_OBSERVATION_UNAVAILABLE', `no trusted observation for '${input.observation_id}'`);
      }
      const verifiedObservation = validateObservationEnvelope(observation);
      this.bindObservationToOutcome(verifiedObservation, outcome, input.attempt_id, context, pending);
      this.assertObservationFreshness(verifiedObservation, outcome, context);

      // Replay defense: one observation id can never finalize two attempts
      // of the same outcome (cross-outcome reuse is rejected by the store's
      // global observation index).
      for (const attempt of outcome.verification_attempts) {
        if (attempt.observation_id === verifiedObservation.observation_id) {
          throw new OutcomeError(
            'OUTCOME_DUPLICATE_OBSERVATION',
            `observation '${verifiedObservation.observation_id}' was already consumed by this outcome`,
          );
        }
      }

      // Expectation stability: the expectation derived today must hash to
      // the digest captured at openOutcome.
      const recomputedExpectationDigest = outcomeExpectationDigest(context.expectation);
      assertExpectationMatchesRecord(outcome, recomputedExpectationDigest);

      // Parser / truncation gate (fail closed, BEFORE any evaluator runs).
      let attemptStatus: VerificationAttemptRecord['status'];
      let reasonCodes: EvaluationResult['reason_codes'];
      if (verifiedObservation.truncated || verifiedObservation.parser_status === 'truncated') {
        attemptStatus = 'verification_failed';
        reasonCodes = ['READBACK_TRUNCATED'];
      } else if (verifiedObservation.parser_status !== 'parsed') {
        attemptStatus = 'verification_failed';
        reasonCodes = [
          verifiedObservation.parser_status === 'malformed' ? 'READBACK_MALFORMED' : 'READBACK_UNSUPPORTED',
        ];
      } else {
        const evaluation = this.evaluateTrusted(context, verifiedObservation);
        attemptStatus = evaluation.status;
        reasonCodes = [...evaluation.reason_codes];
      }

      const now = this.clock().toISOString();
      const digest = observationDigest(verifiedObservation);
      const attempt: VerificationAttemptRecord = {
        attempt_id: input.attempt_id,
        started_at: pending.started_at,
        finished_at: now,
        observation_id: verifiedObservation.observation_id,
        observation_digest: digest,
        status: attemptStatus,
        reason_codes: reasonCodes,
      };

      const nextStatus = nextVerificationStatus({
        attemptStatus,
        attemptCount: outcome.verification_attempts.length + 1,
        maxAttempts: this.maxVerificationAttempts,
      });

      const updated: OutcomeRecord = {
        ...outcome,
        verification_status: nextStatus,
        latest_observation_digest: digest,
        verification_attempts: [...(outcome.verification_attempts ?? []), attempt],
        revisit_required: deriveRevisitRequired(nextStatus),
        rollback_candidate: deriveRollbackCandidate({
          verificationStatus: nextStatus,
          hasRollbackPlan: context.plan.rollback_plan !== null,
          reversible: context.plan.risk_snapshot.reversible,
        }),
        updated_at: now,
      };

      await this.store.updateOutcome(updated);
      return updated;
    } finally {
      this.pendingAttempts.delete(input.outcome_id);
    }
  }

  getOutcome(outcomeId: string): OutcomeRecord | undefined {
    return this.store.getOutcome(outcomeId);
  }

  listOutcomes(): readonly OutcomeRecord[] {
    return this.store.listOutcomes();
  }

  /**
   * Return a detached, trusted projection of the expectation and most recent
   * observation for a finalized outcome.  This is not a public API: callers
   * cannot choose an outcome id from the network and it does not expose the
   * evaluator, receipt resolver, observation resolver or any capability to
   * verify/retry/rewrite an outcome.
   */
  getTrustedRevisionContext(outcomeId: string): TrustedOutcomeRevisionContext | null {
    const outcome = this.store.getOutcome(outcomeId);
    const context = this.contextByOutcome.get(outcomeId);
    if (!outcome || !context) return null;
    const finalAttempt = outcome.verification_attempts[outcome.verification_attempts.length - 1];
    const observation = finalAttempt?.observation_id
      ? this.observationResolver(finalAttempt.observation_id)
      : null;
    return {
      outcome: structuredClone(outcome),
      expected_state: structuredClone(context.expectation.assertions),
      trusted_observed_state: observation ? structuredClone(observation.payload) : null,
      observation_id: finalAttempt?.observation_id ?? null,
    };
  }

  /**
   * Freshness / replay defense. Timestamps only ever come from the trusted
   * native receipt and the trusted native observation; a caller can never
   * declare observed_at. Enforced here:
   * - attempt_started_at must equal the server-owned reservation (binding);
   * - attempt_started_at must not precede the receipt spawn marker;
   * - observed_at must not precede attempt_started_at;
   * - observed_at must not be in the future beyond the allowed clock skew;
   * - the observation's native clock must not precede the receipt's
   *   accepted_at (a stale observation can never verify).
   */
  private assertObservationFreshness(
    observation: ReadbackObservationEnvelope,
    outcome: OutcomeRecord,
    context: OutcomeRuntimeContext,
  ): void {
    const receipt = context.receipt;
    const now = this.clock().getTime();
    const attemptStarted = Date.parse(observation.attempt_started_at);
    const observedAt = Date.parse(observation.observed_at);
    if (receipt.spawn_started_at) {
      const spawnStarted = Date.parse(receipt.spawn_started_at);
      if (attemptStarted < spawnStarted) {
        throw new OutcomeError(
          'OUTCOME_FRESHNESS_INVALID',
          'observation attempt_started_at precedes the execution receipt spawn_started_at',
        );
      }
    }
    if (observedAt < attemptStarted) {
      throw new OutcomeError('OUTCOME_FRESHNESS_INVALID', 'observation observed_at precedes attempt_started_at');
    }
    if (observedAt > now + MAX_OBSERVATION_CLOCK_SKEW_MS) {
      throw new OutcomeError('OUTCOME_FRESHNESS_INVALID', 'observation observed_at is in the future beyond allowed clock skew');
    }
    const acceptedAt = Date.parse(receipt.accepted_at);
    if (observedAt < acceptedAt) {
      throw new OutcomeError('OUTCOME_FRESHNESS_INVALID', 'observation observed_at precedes the receipt accepted_at');
    }
    void outcome;
  }

  private bindReceiptToPlan(receipt: TrustedExecutionReceipt, plan: ExecutionPlan): void {
    if (receipt.plan_id !== plan.plan_id) {
      throw new OutcomeError('OUTCOME_PLAN_MISMATCH', 'receipt plan_id does not match the plan');
    }
    if (receipt.decision_id !== plan.decision_id) {
      throw new OutcomeError('OUTCOME_RECEIPT_INVALID', 'receipt decision_id does not match the plan');
    }
    if (receipt.capability_id !== plan.capability_id || receipt.capability_version !== plan.capability_version) {
      throw new OutcomeError('OUTCOME_RECEIPT_INVALID', 'receipt capability identity does not match the plan');
    }
    if (receipt.adapter_id !== plan.adapter_id) {
      throw new OutcomeError('OUTCOME_RECEIPT_INVALID', 'receipt adapter_id does not match the plan');
    }
    const recomputedInputsDigest = normalizedInputsDigest(plan.normalized_inputs);
    if (receipt.normalized_inputs_digest !== recomputedInputsDigest) {
      throw new OutcomeError(
        'OUTCOME_RECEIPT_INVALID',
        'receipt normalized_inputs_digest does not match the approved plan inputs',
      );
    }
    const recomputedVerificationDigest = verificationPlanDigest(plan);
    if ((receipt.verification_plan_digest ?? null) !== recomputedVerificationDigest) {
      throw new OutcomeError(
        'OUTCOME_RECEIPT_INVALID',
        'receipt verification_plan_digest does not match the approved verification plan',
      );
    }
  }

  private bindObservationToOutcome(
    observation: ReadbackObservationEnvelope,
    outcome: OutcomeRecord,
    attemptId: string,
    context: OutcomeRuntimeContext,
    pending?: PendingAttempt,
  ): void {
    if (observation.verification_attempt_id !== attemptId) {
      throw new OutcomeError('OUTCOME_ATTEMPT_MISMATCH', 'observation verification_attempt_id does not match the in-flight attempt');
    }
    if (pending && observation.attempt_started_at !== pending.started_at) {
      throw new OutcomeError(
        'OUTCOME_ATTEMPT_MISMATCH',
        'observation attempt_started_at does not match the server-owned attempt reservation',
      );
    }
    if (observation.origin_plan_id !== outcome.plan_id) {
      throw new OutcomeError('OUTCOME_PLAN_MISMATCH', 'observation origin_plan_id does not match the outcome plan');
    }
    if (observation.origin_execution_receipt_id !== outcome.execution_receipt_id) {
      throw new OutcomeError('OUTCOME_RECEIPT_MISMATCH', 'observation origin_execution_receipt_id does not match the outcome receipt');
    }
    if (observation.verification_capability_id !== outcome.verification_capability_id) {
      throw new OutcomeError(
        'OUTCOME_VERIFICATION_CAPABILITY_MISMATCH',
        'observation verification_capability_id does not match the outcome',
      );
    }
    if (observation.verification_capability_id !== context.plan.verification_plan?.verification_capability_id) {
      throw new OutcomeError(
        'OUTCOME_VERIFICATION_CAPABILITY_MISMATCH',
        'observation verification_capability_id does not match the approved verification plan',
      );
    }
    if (observation.subject_key !== context.expectation.subject_key) {
      throw new OutcomeError('OUTCOME_SUBJECT_MISMATCH', 'observation subject_key does not match the expectation');
    }
  }

  /** Trusted evaluator execution with fail-closed result validation. */
  private evaluateTrusted(
    context: OutcomeRuntimeContext,
    observation: ReadbackObservationEnvelope,
  ): EvaluationResult {
    try {
      return parseEvaluationResult(context.evaluator.evaluate(context.expectation, observation));
    } catch (error) {
      if (error instanceof OutcomeError) throw error;
      throw new OutcomeError(
        'OUTCOME_INPUT_INVALID',
        `trusted evaluator threw: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}







