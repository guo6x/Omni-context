/**
 * Goal24 Checkpoint 8 (Lane A) - Outcome digests.
 *
 * All digests are core-computed: canonical deterministic JSON (stable key
 * sort, array order preserved, JSON-safe validation) + SHA-256 lowercase hex.
 * A caller can compute the same digest - that proves nothing; authority lives
 * in the trusted receipt resolver / trusted observation resolver and in the
 * server-owned store records, never in a digest field.
 */

import { createHash } from 'node:crypto';
import { JsonObjectSchema, type JsonObject } from '../contracts/json-safe.js';
import { canonicalJson, SHA256_HEX_PATTERN } from '../evidence/model.js';
import { VerificationPlanSchema } from '../execution/contracts.js';
import {
  OutcomeExpectationSchema,
  ReadbackObservationEnvelopeSchema,
  TrustedExecutionReceiptSchema,
  MAX_OBSERVATION_PAYLOAD_BYTES,
  type OutcomeExpectation,
  type ReadbackObservationEnvelope,
  type TrustedExecutionReceipt,
} from './contracts.js';
import { OutcomeError } from './errors.js';

export function sha256Hex(payload: string | Buffer): string {
  return createHash('sha256').update(payload).digest('hex');
}

function canonicalOutcomeJson(value: unknown): string {
  try {
    return canonicalJson(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown canonicalization error';
    throw new OutcomeError('OUTCOME_INPUT_INVALID', `value is not canonical JSON-safe: ${message}`);
  }
}

/** Deterministic digest of an observation payload (bounded to 256 KiB). */
export function observationPayloadDigest(payload: JsonObject): string {
  const parsed = JsonObjectSchema.safeParse(payload);
  if (!parsed.success) {
    throw new OutcomeError('OUTCOME_OBSERVATION_INVALID', 'observation payload must be a JSON-safe plain object');
  }
  const encoded = canonicalOutcomeJson(parsed.data);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_OBSERVATION_PAYLOAD_BYTES) {
    throw new OutcomeError('OUTCOME_OBSERVATION_INVALID', `observation payload exceeds the ${MAX_OBSERVATION_PAYLOAD_BYTES} byte bound`);
  }
  return sha256Hex(encoded);
}

/**
 * SHA-256 over the canonical JSON of the approved normalized_inputs. Must
 * match the native receipt's normalized_inputs_digest exactly (same
 * canonical rules as the CP7 approval binding).
 */
export function normalizedInputsDigest(inputs: JsonObject): string {
  const parsed = JsonObjectSchema.safeParse(inputs);
  if (!parsed.success) {
    throw new OutcomeError('OUTCOME_INPUT_INVALID', 'normalized inputs must be a JSON-safe plain object');
  }
  return sha256Hex(canonicalOutcomeJson(parsed.data));
}

/**
 * SHA-256 over the canonical JSON of the approved verification_plan object
 * (same definition as the CP7 approval binding / the native
 * verification_plan_digest). The object is constructed explicitly so that an
 * absent description never produces a divergent digest across languages:
 * undefined and null are both serialized as an absent key.
 */
export function verificationPlanDigest(plan: { verification_plan?: unknown }): string | null {
  if (!plan.verification_plan) return null;
  const parsed = VerificationPlanSchema.safeParse(plan.verification_plan);
  if (!parsed.success) {
    throw new OutcomeError(
      'OUTCOME_INPUT_INVALID',
      `verification plan is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  const verificationPlan = parsed.data;
  const object: Record<string, unknown> = {
    verification_capability_id: verificationPlan.verification_capability_id,
    verification_inputs: verificationPlan.verification_inputs,
  };
  if (verificationPlan.description !== undefined && verificationPlan.description !== null) {
    object.description = verificationPlan.description;
  }
  return sha256Hex(canonicalOutcomeJson(object));
}

/** Deterministic digest of a trusted outcome expectation (audit). */
export function outcomeExpectationDigest(expectation: OutcomeExpectation): string {
  const parsed = OutcomeExpectationSchema.safeParse(expectation);
  if (!parsed.success) {
    throw new OutcomeError(
      'OUTCOME_INPUT_INVALID',
      `expectation is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return sha256Hex(canonicalOutcomeJson(parsed.data));
}

/**
 * Canonical content digest of a trusted execution receipt (everything except
 * the receipt_digest field itself). The core recomputes this and compares it
 * to the receipt's stored receipt_digest to detect mutation after the native
 * broker emitted the receipt.
 */
export function recomputeReceiptDigest(receipt: TrustedExecutionReceipt): string {
  const parsed = TrustedExecutionReceiptSchema.safeParse(receipt);
  if (!parsed.success) {
    throw new OutcomeError(
      'OUTCOME_RECEIPT_INVALID',
      `receipt is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  const content: Record<string, unknown> = { ...parsed.data };
  delete content.receipt_digest;
  return sha256Hex(canonicalOutcomeJson(content));
}

/**
 * Verify the internal integrity of a receipt (digest field matches content).
 * Returns the parsed receipt on success, throws OUTCOME_RECEIPT_INVALID on any
 * structural or digest mismatch. Never trusts `receipt_digest` by itself.
 */
export function verifyReceiptIntegrity(receipt: unknown): TrustedExecutionReceipt {
  const parsed = TrustedExecutionReceiptSchema.safeParse(receipt);
  if (!parsed.success) {
    throw new OutcomeError(
      'OUTCOME_RECEIPT_INVALID',
      `receipt is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  const expected = recomputeReceiptDigest(parsed.data);
  if (expected !== parsed.data.receipt_digest) {
    throw new OutcomeError('OUTCOME_RECEIPT_INVALID', 'receipt_digest does not match the receipt content');
  }
  return parsed.data;
}

/**
 * Deterministic observation digest: payload digest plus the observation
 * metadata (ids, plan/receipt binding, capability, subject, timestamps,
 * source, level, truncation and parser status). We deliberately do not hash
 * raw stdout or inline the payload: the payload is bound via its digest.
 *
 * The envelope's payload_digest is recomputed from the payload first and must
 * match (OUTCOME_OBSERVATION_INVALID otherwise).
 */
export function observationDigest(observation: ReadbackObservationEnvelope): string {
  const parsed = ReadbackObservationEnvelopeSchema.safeParse(observation);
  if (!parsed.success) {
    throw new OutcomeError(
      'OUTCOME_OBSERVATION_INVALID',
      `observation is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  const envelope = parsed.data;
  const payloadDigest = observationPayloadDigest(envelope.payload);
  if (payloadDigest !== envelope.payload_digest) {
    throw new OutcomeError('OUTCOME_OBSERVATION_INVALID', 'payload_digest does not match the observation payload');
  }
  const digestable = {
    observation_id: envelope.observation_id,
    verification_attempt_id: envelope.verification_attempt_id,
    origin_plan_id: envelope.origin_plan_id,
    origin_execution_receipt_id: envelope.origin_execution_receipt_id,
    verification_capability_id: envelope.verification_capability_id,
    subject_key: envelope.subject_key,
    attempt_started_at: envelope.attempt_started_at,
    observed_at: envelope.observed_at,
    verification_source: envelope.verification_source,
    verification_level: envelope.verification_level,
    payload_digest: envelope.payload_digest,
    truncated: envelope.truncated,
    parser_status: envelope.parser_status,
    source_adapter: envelope.source_adapter,
    source_binding: envelope.source_binding,
    process_exit_code: envelope.process_exit_code ?? null,
    process_timed_out: envelope.process_timed_out,
    process_cancelled: envelope.process_cancelled,
    resolved_executable_fingerprint: envelope.resolved_executable_fingerprint,
    process_duration_ms: envelope.process_duration_ms,
  };
  return sha256Hex(canonicalOutcomeJson(digestable));
}

/** Validate the envelope fully and return the parsed value (fail closed). */
export function validateObservationEnvelope(observation: unknown): ReadbackObservationEnvelope {
  const parsed = ReadbackObservationEnvelopeSchema.safeParse(observation);
  if (!parsed.success) {
    throw new OutcomeError(
      'OUTCOME_OBSERVATION_INVALID',
      `observation is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  const data = parsed.data;
  const payloadDigest = observationPayloadDigest(data.payload);
  if (data.payload_digest !== payloadDigest) {
    throw new OutcomeError('OUTCOME_OBSERVATION_INVALID', 'payload_digest does not match the observation payload');
  }
  return {
    observation_id: data.observation_id,
    verification_attempt_id: data.verification_attempt_id,
    origin_plan_id: data.origin_plan_id,
    origin_execution_receipt_id: data.origin_execution_receipt_id,
    verification_capability_id: data.verification_capability_id,
    subject_key: data.subject_key,
    attempt_started_at: data.attempt_started_at,
    observed_at: data.observed_at,
    verification_source: data.verification_source,
    verification_level: data.verification_level,
    payload: data.payload,
    payload_digest: data.payload_digest,
    truncated: data.truncated,
    parser_status: data.parser_status,
    source_adapter: data.source_adapter,
    source_binding: data.source_binding,
    process_exit_code: data.process_exit_code,
    process_timed_out: data.process_timed_out,
    process_cancelled: data.process_cancelled,
    resolved_executable_fingerprint: data.resolved_executable_fingerprint,
    process_duration_ms: data.process_duration_ms,
  };
}

export { SHA256_HEX_PATTERN };



