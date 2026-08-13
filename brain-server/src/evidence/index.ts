/**
 * Goal24 Checkpoint 6 (Lane A) - Evidence Core public surface.
 *
 * Model + provider contract + internal provider registry + qualification
 * runtime + coverage builder. No Guard control flow, no retrieve/clarify/
 * defer decisions, no Decision Kernel wiring and no process execution.
 */

export {
  GUARD_ACTIONS,
  GUARD_REASON_CODES,
  MAX_RETRIEVAL_ROUNDS,
  PROVIDER_OUTCOME_KINDS,
  ProviderOutcomeSchema,
  type ClarificationNeed,
  type CollectCoverage,
  type CollectCoverageParams,
  type CollectCoverageResult,
  type EvidenceGuardResult,
  type EvidenceGuardRequest,
  type EvidenceGuardRequestWithSignal,
  type GuardAction,
  type GuardReasonCode,
  type GuardTraceRound,
  type ProviderOutcome,
  type ProviderOutcomeKind,
} from './guard-types.js';

export {
  chooseControlAction,
  classifyClassControl,
  detectCoverageRegression,
  evidenceGateCleared,
  type ClassDecision,
  type ClassFinalKind,
  type ControlChoice,
} from './guard-policy.js';

export {
  runEvidenceGuard,
  evidenceGateCleared as guardEvidenceGateCleared,
} from './guard.js';

export {
  assertValidIdComponent,
  buildEvidenceId,
  canonicalJson,
  claimDigest,
  encodeEvidenceIdTuple,
  EvidenceCandidateSchema,
  EvidenceTimestampSchema,
  isFutureTimestamp,
  parseEvidenceTimestamp,
  QualifiedEvidenceSchema,
  SHA256_HEX_PATTERN,
  VERIFICATION_RANK,
  type EvidenceCandidate,
  type EvidenceTimestamp,
  type JsonValue,
  type QualifiedEvidence,
} from './model.js';

export {
  collectFromProvider,
  EVIDENCE_PROVIDER_ID_PATTERN,
  EVIDENCE_PROVIDER_OUTCOMES,
  EvidenceProviderDiagnosticSchema,
  EvidenceProviderResultSchema,
  EvidenceProviderV1MetadataSchema,
  type EvidenceCollectRequest,
  type EvidenceProviderDiagnostic,
  type EvidenceProviderOutcome,
  type EvidenceProviderResult,
  type EvidenceProviderV1,
  type EvidenceProviderV1Metadata,
} from './provider.js';

export {
  EvidenceProviderRegistry,
  sortProviders,
} from './provider-registry.js';

export {
  diagnosticEvidenceReference,
  QUALIFICATION_ISSUE_CODES,
  qualifyCandidate,
  type CandidateQualification,
  type QualificationContext,
  type QualificationIssue,
  type QualificationIssueCode,
} from './qualification.js';

export {
  buildEvidenceCoverage,
  DEFAULT_EVIDENCE_COLLECTION_LIMITS,
  type BuildEvidenceCoverageResult,
  type EvidenceBuildDiagnostic,
  type EvidenceCollectionLimits,
  type ProviderCollectionBatch,
} from './coverage-builder.js';

export {
  EVIDENCE_ERROR_CODES,
  EvidenceError,
  type EvidenceErrorCode,
} from './errors.js';

export {
  coverageDigest,
  normalizedInputsDigest,
  requirementsDigest,
  sha256Hex,
} from './digests.js';

export {
  assertValidSubjectKey,
  CapabilityEvidenceSubjectResolverRegistry,
  SUBJECT_KEY_MAX_LENGTH,
  type CapabilityEvidenceSubjectResolver,
} from './subject.js';

export {
  genericTestSubjectResolver,
  githubIssueReadSubjectResolver,
  githubIssueSearchSubjectResolver,
  githubPrChecksReadSubjectResolver,
  githubPrReadSubjectResolver,
  githubRepoInspectSubjectResolver,
  githubSubjectResolverRegistry,
} from './subject-resolvers.js';

export {
  DEFAULT_MAX_GUARD_RUNS,
  DEFAULT_MAX_QUALIFIED_RECORDS,
  EvidenceGuardRunRecordSchema,
  GuardRunStore,
  QUALIFICATION_OUTCOMES,
  QualifiedEvidenceRecordSchema,
  QualifiedEvidenceStore,
  type EvidenceGuardRunRecord,
  type QualificationOutcome,
  type QualifiedEvidenceRecord,
} from './stores.js';

export {
  DEFAULT_EVIDENCE_MAX_RETRIEVAL_ROUNDS,
  DEFAULT_EVIDENCE_PER_ROUND_TIMEOUT_MS,
  EvaluateForCapabilityRequestSchema,
  EvidenceSurfaceRuntime,
  MAX_NORMALIZED_INPUT_BYTES,
  MAX_NORMALIZED_INPUT_KEYS,
  collectCoverageIds,
  type EvidenceSurfaceEvaluation,
  type EvidenceSurfaceRuntimeOptions,
  type EvaluateForCapabilityRequest,
} from './runtime.js';

export {
  EvidenceEligibilityService,
  MaterializeEvidenceRequestSchema,
  type EvidenceEligibilityRecord,
  type EvidenceEligibilityServiceOptions,
  type MaterializeEvidenceRequest,
} from './eligibility.js';