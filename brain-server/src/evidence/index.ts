/**
 * Goal24 Checkpoint 6 (Lane A) - Evidence Core public surface.
 *
 * Model + provider contract + internal provider registry + qualification
 * runtime + coverage builder. No Guard control flow, no retrieve/clarify/
 * defer decisions, no Decision Kernel wiring and no process execution.
 */

export {
  buildEvidenceId,
  canonicalJson,
  claimDigest,
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