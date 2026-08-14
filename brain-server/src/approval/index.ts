/**
 * Goal24 Checkpoint 7 (Lane A) - Brain approval public surface.
 *
 * Approval/risk policy, server-owned plan authorization lifecycle, immutable
 * approval binding digest, approval request model, authority enforcement and
 * the internal-only grant verifier abstraction.
 *
 * No public mutation API exists: grantApproval/approvePlan/setApproval/
 * setAuthority/markReady are not wired to REST, MCP, Tauri IPC or LLM tools
 * (approval UI/wiring is Checkpoint 9). No process execution exists here.
 */

export {
  APPROVAL_ERROR_CODES,
  ApprovalError,
  type ApprovalErrorCode,
} from './errors.js';

export {
  APPROVAL_ACTOR_KINDS,
  APPROVAL_STATUSES,
  ApprovalBindingPayloadSchema,
  ApprovalRequestRecordSchema,
  ExecutionAuthorizationRequestSchema,
  IsoTimestampSchema,
  PlanAuthorizationRecordSchema,
  TrustedApprovalActorSchema,
  VerifiedGrantRecordSchema,
  VerifiedGrantSchema,
  type ApprovalActorKind,
  type ApprovalBindingPayload,
  type ApprovalGrantVerificationResult,
  type ApprovalGrantVerifier,
  type ApprovalGrantVerifierRequest,
  type ApprovalRequestRecord,
  type ApprovalStatus,
  type ExecutionAuthorizationRequest,
  type PlanAuthorizationRecord,
  type TrustedApprovalActor,
  type VerifiedGrant,
  type VerifiedGrantRecord,
} from './contracts.js';

export {
  APPROVAL_POLICY_VERSION,
  AUTHORITY_RANK,
  DEFAULT_MAX_APPROVAL_TTL_MS,
  approvalRequired,
  authoritySatisfies,
  computePlanExpiry,
  deriveRiskSnapshot,
  isExpiredAt,
} from './policy.js';

export {
  approvalBindingDigest,
  bindingPayloadForPlan,
  buildApprovalBindingPayload,
  digestJsonValue,
  type ApprovalBindingInputs,
} from './binding.js';

export {
  AuthorizationStore,
  DEFAULT_MAX_AUTHORIZATION_RECORDS,
} from './authorization-store.js';

export {
  AuthorizationService,
  generateApprovalRequestId,
  generateAuthorizationPlanId,
  type AuthorizationServiceOptions,
  type PlanAuthorizationResult,
} from './authorization-service.js';