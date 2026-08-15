/**
 * Goal24 Checkpoint 8 (Lane A) - Outcome core public surface.
 *
 * Outcome contracts, trusted deterministic evaluator runtime, outcome
 * lifecycle, persistent outcome store, outcome service and digests.
 *
 * Boundaries (all enforced here):
 * - process execution result != verified outcome (exit_code / success flags
 *   can never verify an external effect);
 * - no LLM judge: verification is deterministic and typed;
 * - caller can never supply an expectation, a raw receipt, a raw observation,
 *   an outcome id, an attempt id or any timestamp as authority;
 * - no rollback execution, no automatic rollback, no process execution.
 */

export {
  OUTCOME_ERROR_CODES,
  OUTCOME_REASON_CODES,
  OutcomeError,
  type OutcomeErrorCode,
  type OutcomeReasonCode,
} from './errors.js';

export {
  ATTEMPT_STATUSES,
  EXECUTION_EFFECT_STATES,
  MAX_OBSERVATION_CLOCK_SKEW_MS,
  MAX_OBSERVATION_PAYLOAD_BYTES,
  OUTCOME_ID_PATTERN,
  ATTEMPT_ID_PATTERN,
  OUTCOME_STORE_SCHEMA_VERSION,
  OutcomeExpectationSchema,
  OutcomeRecordSchema,
  OutcomeStoreFileSchema,
  PARSER_STATUSES,
  ReadbackObservationEnvelopeSchema,
  TrustedExecutionReceiptSchema,
  VERIFICATION_SOURCES,
  VERIFICATION_STATUSES,
  VerificationAttemptRecordSchema,
  IsoTimestampSchema,
  type AttemptStatus,
  type ExecutionEffectState,
  type OutcomeExpectation,
  type OutcomeRecord,
  type OutcomeStoreFile,
  type ParserStatus,
  type ReadbackObservationEnvelope,
  type TrustedExecutionReceipt,
  type VerificationAttemptRecord,
  type VerificationSource,
  type VerificationStatus,
} from './contracts.js';

export {
  normalizedInputsDigest,
  observationDigest,
  observationPayloadDigest,
  outcomeExpectationDigest,
  recomputeReceiptDigest,
  sha256Hex,
  validateObservationEnvelope,
  verificationPlanDigest,
  verifyReceiptIntegrity,
} from './digests.js';

export {
  EvaluationResultSchema,
  OutcomeEvaluatorV1MetadataSchema,
  parseEvaluationResult,
  validateExpectationFromEvaluator,
  type EvaluationResult,
  type OutcomeEvaluatorV1,
  type OutcomeEvaluatorV1Metadata,
} from './evaluator.js';

export { OutcomeEvaluatorRegistry } from './evaluator-registry.js';

export {
  attemptsExhausted,
  assertExpectationMatchesRecord,
  assertValidOutcomeId,
  DEFAULT_MAX_VERIFICATION_ATTEMPTS,
  deriveRevisitRequired,
  deriveRollbackCandidate,
  initialVerificationStatus,
  isVerificationRetryable,
  MAX_VERIFICATION_ATTEMPTS_BOUND,
  nextVerificationStatus,
  parseOutcomeRecord,
  validateOutcomeTransition,
} from './lifecycle.js';

export {
  FileOutcomeStore,
  InMemoryOutcomeStore,
  validateCreateOutcome,
  executionInstanceKey,
  collectObservationClaims,
  type OutcomeStore,
} from './store.js';

export {
  EXECUTION_STATE_MAPPING_ERRORS,
  NATIVE_EXECUTION_RECEIPT_STATES,
  isNativeReadbackEligible,
  mapNativeStateToEffectState,
  type ExecutionStateMappingError,
  type ExecutionStateMappingResult,
  type NativeExecutionReceiptState,
  type NativeStateMappingInput,
} from './execution-state-map.js';

export {
  generateAttemptId,
  generateOutcomeId,
  OutcomeService,
  type BeginVerificationAttemptResult,
  type OutcomeServiceOptions,
  type TrustedObservationResolver,
  type TrustedReceiptResolver,
} from './service.js';
