/**
 * Goal24 Checkpoint 8 (Lane A) - Outcome / verification contracts.
 *
 * The fundamental rule: a PROCESS EXECUTION RESULT and a VERIFIED OUTCOME are
 * two different concepts. exit_code=0 or BrokerExecutionResult.success=true
 * can never produce outcome.status=verified on its own; for any
 * side_effect_class != read_only, a trusted read-back observation must
 * satisfy a trusted evaluator expectation first.
 *
 * Authority boundaries enforced by these schemas:
 * - TrustedExecutionReceipt can only come from `source: native_broker` and
 *   carries a core-recomputed receipt digest; a caller can never hand the
 *   service a raw BrokerExecutionResult.
 * - ReadbackObservationEnvelope is a structured, bounded, JSON-safe object
 *   (no NaN/Infinity/BigInt/class instances/cycles); a caller can never
 *   hand the service a raw observation - the service only accepts ids and
 *   resolves them through an injected trusted resolver.
 * - OutcomeExpectation is derived by a trusted OutcomeEvaluatorV1 from the
 *   approved plan (capability definition + approved normalized_inputs +
 *   verification_plan). `expected`, `predicate`, `jsonpath`, `regex`,
 *   `success_condition`, `result` and `judge_prompt` cannot exist on the
 *   strict wire shape and can never become authority.
 * - OutcomeRecord / VerificationAttemptRecord are server-owned; outcome_id
 *   and attempt ids are core-generated.
 */

import { z } from 'zod';
import {
  CAPABILITY_ID_PATTERN,
  SEMVER_PATTERN,
  VERIFICATION_REQUIREMENTS,
} from '../capabilities/contracts.js';
import { JsonObjectSchema } from '../contracts/json-safe.js';
import { ADAPTER_ID_PATTERN, PLAN_ID_PATTERN } from '../execution/contracts.js';
import { SHA256_HEX_PATTERN } from '../evidence/model.js';
import { OUTCOME_REASON_CODES } from './errors.js';

export const IsoTimestampSchema = z.string().datetime({ offset: true });

// ---------------------------------------------------------------------------
// Execution effect state (local execution knowledge only)
// ---------------------------------------------------------------------------

/**
 * What the local runtime knows about the process execution. This NEVER
 * describes external effect truth: even `process_succeeded` does not mean
 * the external state changed as expected.
 */
export const EXECUTION_EFFECT_STATES = [
  'not_started',
  'spawn_started',
  'process_succeeded',
  'process_failed',
  'timed_out',
  'cancelled',
  'unknown_after_crash',
] as const;
export type ExecutionEffectState = (typeof EXECUTION_EFFECT_STATES)[number];

// ---------------------------------------------------------------------------
// Verification status (external effect truth)
// ---------------------------------------------------------------------------

export const VERIFICATION_STATUSES = [
  'not_required',
  'pending',
  'verified',
  'mismatch',
  'inconclusive',
  'verification_failed',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Attempt-level terminal statuses (pending attempts are service-memory only). */
export const ATTEMPT_STATUSES = ['verified', 'mismatch', 'inconclusive', 'verification_failed'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/**
 * Unified parser status vocabulary. The native layer emits 'parsed',
 * 'malformed' or 'truncated' (truncated output is never reported as a
 * complete parse); the Brain adds 'unsupported' for a trusted binding that
 * cannot represent the payload in the V1 structured format. A truncated
 * observation can never verify.
 */
export const PARSER_STATUSES = ['parsed', 'malformed', 'unsupported', 'truncated'] as const;
export type ParserStatus = (typeof PARSER_STATUSES)[number];

/** Trusted read-back sources. Production bridges emit `native_readback`; lane A tests use `synthetic_test`. */
export const VERIFICATION_SOURCES = ['native_readback', 'synthetic_test'] as const;
export type VerificationSource = (typeof VERIFICATION_SOURCES)[number];

export const OUTCOME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,199}$/;
export const ATTEMPT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,199}$/;

/** Observation payload size cap (256 KiB of canonical JSON). */
export const MAX_OBSERVATION_PAYLOAD_BYTES = 262_144;

/**
 * Maximum tolerated native-clock lead over the Brain clock when accepting
 * trusted observation timestamps (future-time observations beyond this skew
 * are rejected as replay/forgery candidates).
 */
export const MAX_OBSERVATION_CLOCK_SKEW_MS = 60_000;

// ---------------------------------------------------------------------------
// Trusted execution receipt
// ---------------------------------------------------------------------------

/**
 * The narrow internal execution receipt Lane A is allowed to consume. It is
 * resolved by id through an injected trusted receipt resolver; it is never
 * accepted as caller JSON. `receipt_digest` is recomputed by the core from
 * the canonical content and must match (mutation detection).
 */
export const TrustedExecutionReceiptSchema = z
  .strictObject({
    receipt_id: z.string().trim().min(1).max(200),
    plan_id: z.string().regex(PLAN_ID_PATTERN, 'plan_id must be a valid plan identifier'),
    decision_id: z.string().trim().min(1).max(200),
    capability_id: z.string().regex(CAPABILITY_ID_PATTERN, 'capability_id must be provider.resource.action'),
    capability_version: z.string().regex(SEMVER_PATTERN, 'capability_version must be semantic'),
    adapter_id: z.string().regex(ADAPTER_ID_PATTERN, 'adapter_id must be a lowercase implementation identifier'),
    /** SHA-256 over the canonical JSON of the approved normalized_inputs. */
    normalized_inputs_digest: z.string().regex(SHA256_HEX_PATTERN, 'normalized_inputs_digest must be lowercase SHA-256 hex'),
    /**
     * SHA-256 over the canonical JSON of the approved verification_plan
     * object (same definition as the CP7 approval binding), or absent for
     * plans without a verification plan.
     */
    verification_plan_digest: z
      .string()
      .regex(SHA256_HEX_PATTERN, 'verification_plan_digest must be lowercase SHA-256 hex')
      .optional(),
    execution_state: z.enum(EXECUTION_EFFECT_STATES),
    accepted_at: IsoTimestampSchema,
    spawn_started_at: IsoTimestampSchema.optional(),
    finished_at: IsoTimestampSchema.optional(),
    exit_code: z.number().int().min(0).max(4_294_967_295).optional(),
    timed_out: z.boolean(),
    cancelled: z.boolean(),
    receipt_digest: z.string().regex(SHA256_HEX_PATTERN, 'receipt_digest must be lowercase SHA-256 hex'),
    source: z.literal('native_broker'),
  })
  .superRefine((receipt, ctx) => {
    const addIssue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
    if (receipt.timed_out && receipt.cancelled) {
      addIssue('timed_out and cancelled cannot both be true', ['timed_out']);
    }
    if (receipt.spawn_started_at && Date.parse(receipt.spawn_started_at) < Date.parse(receipt.accepted_at)) {
      addIssue('spawn_started_at must not precede accepted_at', ['spawn_started_at']);
    }
    if (receipt.finished_at && Date.parse(receipt.finished_at) < Date.parse(receipt.accepted_at)) {
      addIssue('finished_at must not precede accepted_at', ['finished_at']);
    }
    if (
      receipt.spawn_started_at &&
      receipt.finished_at &&
      Date.parse(receipt.finished_at) < Date.parse(receipt.spawn_started_at)
    ) {
      addIssue('finished_at must not precede spawn_started_at', ['finished_at']);
    }
    switch (receipt.execution_state) {
      case 'not_started':
        // Only a provably-never-spawned receipt (native spawn_failed) maps
        // here; a recovered accepted receipt must be unknown_after_crash.
        if (receipt.spawn_started_at) addIssue('not_started receipts must not carry spawn_started_at', ['spawn_started_at']);
        if (receipt.finished_at) addIssue('not_started receipts must not carry finished_at', ['finished_at']);
        if (receipt.exit_code !== undefined) addIssue('not_started receipts must not carry exit_code', ['exit_code']);
        if (receipt.timed_out) addIssue('not_started receipts must not carry timed_out=true', ['timed_out']);
        if (receipt.cancelled) addIssue('not_started receipts must not carry cancelled=true', ['cancelled']);
        break;
      case 'spawn_started':
        if (!receipt.spawn_started_at) addIssue('spawn_started receipts require spawn_started_at', ['spawn_started_at']);
        if (receipt.finished_at) addIssue('spawn_started receipts must not carry finished_at', ['finished_at']);
        if (receipt.exit_code !== undefined) addIssue('spawn_started receipts must not carry exit_code', ['exit_code']);
        if (receipt.timed_out) addIssue('spawn_started receipts must not carry timed_out=true', ['timed_out']);
        if (receipt.cancelled) addIssue('spawn_started receipts must not carry cancelled=true', ['cancelled']);
        break;
      case 'process_succeeded':
      case 'process_failed':
        if (!receipt.spawn_started_at) addIssue(`${receipt.execution_state} receipts require spawn_started_at`, ['spawn_started_at']);
        if (!receipt.finished_at) addIssue(`${receipt.execution_state} receipts require finished_at`, ['finished_at']);
        if (receipt.exit_code === undefined) addIssue(`${receipt.execution_state} receipts require exit_code`, ['exit_code']);
        break;
      case 'timed_out':
        if (!receipt.spawn_started_at) addIssue('timed_out receipts require spawn_started_at', ['spawn_started_at']);
        if (!receipt.finished_at) addIssue('timed_out receipts require finished_at', ['finished_at']);
        if (!receipt.timed_out) addIssue('execution_state=timed_out requires timed_out=true', ['timed_out']);
        break;
      case 'cancelled':
        if (!receipt.spawn_started_at) addIssue('cancelled receipts require spawn_started_at', ['spawn_started_at']);
        if (!receipt.finished_at) addIssue('cancelled receipts require finished_at', ['finished_at']);
        if (!receipt.cancelled) addIssue('execution_state=cancelled requires cancelled=true', ['cancelled']);
        break;
      case 'unknown_after_crash':
        // Recovered receipts have no completion markers. A spawn marker may
        // exist (recovered from spawn_started) or not (recovered from
        // accepted); exit/flags prove nothing either way and must be absent.
        if (receipt.finished_at) addIssue('unknown_after_crash receipts must not carry finished_at', ['finished_at']);
        if (receipt.exit_code !== undefined) addIssue('unknown_after_crash receipts must not carry exit_code', ['exit_code']);
        if (receipt.timed_out) addIssue('unknown_after_crash receipts must not carry timed_out=true', ['timed_out']);
        if (receipt.cancelled) addIssue('unknown_after_crash receipts must not carry cancelled=true', ['cancelled']);
        break;
    }
  });
export type TrustedExecutionReceipt = z.infer<typeof TrustedExecutionReceiptSchema>;

// ---------------------------------------------------------------------------
// Read-back observation envelope
// ---------------------------------------------------------------------------

/**
 * Structured observation produced by the trusted native read-back bridge.
 * `payload` is JSON-safe and bounded; `payload_digest` is core-recomputed and
 * must match. A truncated / malformed / unsupported observation can never
 * reach the semantic evaluator (fail closed).
 */
export const ReadbackObservationEnvelopeSchema = z
  .strictObject({
    observation_id: z.string().trim().min(1).max(200),
    /**
     * Canonical attempt binding id. The native layer names the same id
     * `native_attempt_id`; the two names denote the exact same value and
     * namespace (see docs/goal24/cp8-readback-observation-contract.json).
     */
    verification_attempt_id: z.string().trim().min(1).max(200),
    origin_plan_id: z.string().regex(PLAN_ID_PATTERN, 'origin_plan_id must be a valid plan identifier'),
    origin_execution_receipt_id: z.string().trim().min(1).max(200),
    verification_capability_id: z.string().regex(CAPABILITY_ID_PATTERN, 'verification_capability_id must be a capability id'),
    subject_key: z.string().trim().min(1).max(200),
    /** Trusted native clock: the durable attempt reservation timestamp. */
    attempt_started_at: IsoTimestampSchema,
    /** Trusted native clock: when the observation payload was acquired. */
    observed_at: IsoTimestampSchema,
    verification_source: z.enum(VERIFICATION_SOURCES),
    verification_level: z.enum(VERIFICATION_REQUIREMENTS),
    payload: JsonObjectSchema,
    payload_digest: z.string().regex(SHA256_HEX_PATTERN, 'payload_digest must be lowercase SHA-256 hex'),
    truncated: z.boolean(),
    parser_status: z.enum(PARSER_STATUSES),
    /** Trusted native source identity: adapter that produced the payload. */
    source_adapter: z.string().trim().min(1).max(200),
    /** Trusted native source identity: binding that produced the payload. */
    source_binding: z.string().trim().min(1).max(200),
    process_exit_code: z.number().int().min(0).max(4_294_967_295).optional(),
    process_timed_out: z.boolean(),
    process_cancelled: z.boolean(),
    resolved_executable_fingerprint: z.string().trim().min(1).max(500),
    process_duration_ms: z.number().int().min(0).max(2_147_483_647),
  })
  .superRefine((observation, ctx) => {
    if (observation.truncated && observation.parser_status !== 'parsed' && observation.parser_status !== 'truncated') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a truncated observation cannot be reported as malformed/unsupported at the same time',
        path: ['parser_status'],
      });
    }
    if (observation.process_timed_out && observation.process_cancelled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'process_timed_out and process_cancelled cannot both be true',
        path: ['process_timed_out'],
      });
    }
    if (Date.parse(observation.observed_at) < Date.parse(observation.attempt_started_at)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'observed_at must not precede attempt_started_at',
        path: ['observed_at'],
      });
    }
  });
export type ReadbackObservationEnvelope = z.infer<typeof ReadbackObservationEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Outcome expectation (trusted evaluator output)
// ---------------------------------------------------------------------------

/**
 * Structured, evaluator-specific expected post-state. `assertions` is a
 * structured expected object (e.g. { item_id, value }) that the evaluator
 * compares field by field. It is NOT a general executable expression
 * language, and it can only be derived by trusted OutcomeEvaluatorV1 code
 * from the approved plan.
 */
export const OutcomeExpectationSchema = z.strictObject({
  evaluator_id: z.string().trim().min(1).max(200),
  capability_id: z.string().regex(CAPABILITY_ID_PATTERN, 'capability_id must be provider.resource.action'),
  verification_capability_id: z.string().regex(CAPABILITY_ID_PATTERN, 'verification_capability_id must be a capability id'),
  subject_key: z.string().trim().min(1).max(200),
  assertions: JsonObjectSchema,
});
export type OutcomeExpectation = z.infer<typeof OutcomeExpectationSchema>;

// ---------------------------------------------------------------------------
// Verification attempt record
// ---------------------------------------------------------------------------

export const VerificationAttemptRecordSchema = z
  .strictObject({
    attempt_id: z.string().regex(ATTEMPT_ID_PATTERN, 'attempt_id must be a valid attempt identifier'),
    started_at: IsoTimestampSchema,
    finished_at: IsoTimestampSchema.optional(),
    observation_id: z.string().trim().min(1).max(200).optional(),
    observation_digest: z.string().regex(SHA256_HEX_PATTERN, 'observation_digest must be lowercase SHA-256 hex').optional(),
    status: z.enum(ATTEMPT_STATUSES),
    reason_codes: z.array(z.enum(OUTCOME_REASON_CODES)).max(50),
  })
  .superRefine((attempt, ctx) => {
    if (new Set(attempt.reason_codes).size !== attempt.reason_codes.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'reason_codes must not contain duplicates', path: ['reason_codes'] });
    }
    if (attempt.status === 'verified' && !attempt.reason_codes.includes('OUTCOME_VERIFIED')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'status=verified requires reason code OUTCOME_VERIFIED',
        path: ['reason_codes'],
      });
    }
    if (attempt.finished_at && Date.parse(attempt.finished_at) < Date.parse(attempt.started_at)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'finished_at must not precede started_at', path: ['finished_at'] });
    }
    if (attempt.observation_id && !attempt.observation_digest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'observation_digest is required when observation_id is present',
        path: ['observation_digest'],
      });
    }
  });
export type VerificationAttemptRecord = z.infer<typeof VerificationAttemptRecordSchema>;

// ---------------------------------------------------------------------------
// Outcome record
// ---------------------------------------------------------------------------

export const OutcomeRecordSchema = z
  .strictObject({
    outcome_id: z.string().regex(OUTCOME_ID_PATTERN, 'outcome_id must be a valid outcome identifier'),
    plan_id: z.string().regex(PLAN_ID_PATTERN, 'plan_id must be a valid plan identifier'),
    decision_id: z.string().trim().min(1).max(200),
    capability_id: z.string().regex(CAPABILITY_ID_PATTERN, 'capability_id must be provider.resource.action'),
    capability_version: z.string().regex(SEMVER_PATTERN, 'capability_version must be semantic'),
    execution_receipt_id: z.string().trim().min(1).max(200),
    execution_effect_state: z.enum(EXECUTION_EFFECT_STATES),
    verification_status: z.enum(VERIFICATION_STATUSES),
    verification_capability_id: z.string().regex(CAPABILITY_ID_PATTERN).optional(),
    expected_outcome_digest: z.string().regex(SHA256_HEX_PATTERN).optional(),
    latest_observation_digest: z.string().regex(SHA256_HEX_PATTERN).optional(),
    verification_attempts: z.array(VerificationAttemptRecordSchema).max(20),
    revisit_required: z.boolean(),
    rollback_candidate: z.boolean(),
    created_at: IsoTimestampSchema,
    updated_at: IsoTimestampSchema,
    correlation_id: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((record, ctx) => {
    const addIssue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
    if (Date.parse(record.updated_at) < Date.parse(record.created_at)) {
      addIssue('updated_at must not precede created_at', ['updated_at']);
    }
    const attemptIds = record.verification_attempts.map((attempt) => attempt.attempt_id);
    if (new Set(attemptIds).size !== attemptIds.length) {
      addIssue('verification_attempts must have unique attempt_ids', ['verification_attempts']);
    }
    const observationIds = record.verification_attempts
      .map((attempt) => attempt.observation_id)
      .filter((id): id is string => id !== undefined);
    if (new Set(observationIds).size !== observationIds.length) {
      addIssue('verification_attempts must have unique observation_ids', ['verification_attempts']);
    }
    const last = record.verification_attempts[record.verification_attempts.length - 1];
    switch (record.verification_status) {
      case 'verified':
        if (!last || last.status !== 'verified') addIssue('status=verified requires a final verified attempt', ['verification_status']);
        break;
      case 'mismatch':
        if (!last || last.status !== 'mismatch') addIssue('status=mismatch requires a final mismatch attempt', ['verification_status']);
        break;
      case 'inconclusive':
        if (!last || last.status !== 'inconclusive') addIssue('status=inconclusive requires a final inconclusive attempt', ['verification_status']);
        break;
      case 'verification_failed':
        if (!last || last.status !== 'verification_failed') {
          addIssue('status=verification_failed requires a final verification_failed attempt', ['verification_status']);
        }
        break;
      case 'pending':
        if (last && last.status === 'verified') addIssue('pending outcomes cannot end with a verified attempt', ['verification_status']);
        break;
      case 'not_required':
        if (record.verification_attempts.length !== 0) addIssue('status=not_required requires no attempts', ['verification_attempts']);
        break;
    }
    if (record.verification_status === 'not_required' && record.expected_outcome_digest) {
      addIssue('status=not_required must not carry expected_outcome_digest', ['expected_outcome_digest']);
    }
  });
export type OutcomeRecord = z.infer<typeof OutcomeRecordSchema>;

// ---------------------------------------------------------------------------
// Outcome store file
// ---------------------------------------------------------------------------

export const OUTCOME_STORE_SCHEMA_VERSION = 1;

/** On-disk shape of the FileOutcomeStore. Strict: unknown fields fail closed. */
export const OutcomeStoreFileSchema = z
  .strictObject({
    schema_version: z.literal(OUTCOME_STORE_SCHEMA_VERSION),
    updated_at: IsoTimestampSchema,
    outcomes: z.array(OutcomeRecordSchema).max(100_000),
  })
  .superRefine((file, ctx) => {
    const ids = file.outcomes.map((record) => record.outcome_id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'outcome store must not contain duplicate outcome_ids', path: ['outcomes'] });
    }
  });
export type OutcomeStoreFile = z.infer<typeof OutcomeStoreFileSchema>;

