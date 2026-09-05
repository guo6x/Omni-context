/**
 * Frozen exit-code and error-taxonomy contract (see
 * docs/goal24/distribution/02-cli-command-contract.md).
 *
 * 0 SUCCESS | 2 USAGE_ERROR | 3 FEATURE_LOCKED_OR_POLICY_BLOCKED |
 * 4 AUTH_ERROR | 5 SERVICE_UNAVAILABLE | 6 CONTRACT_OR_DATA_ERROR |
 * 7 INTERNAL_ERROR
 */

export const EXIT = Object.freeze({
  SUCCESS: 0,
  USAGE_ERROR: 2,
  FEATURE_LOCKED: 3,
  AUTH_ERROR: 4,
  SERVICE_UNAVAILABLE: 5,
  CONTRACT_OR_DATA_ERROR: 6,
  INTERNAL_ERROR: 7,
});

export class OmctxError extends Error {
  constructor(code, message, exitCode) {
    super(message);
    this.name = 'OmctxError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

export const errorFor = {
  brainOffline: (detail) => new OmctxError('OMCTX_BRAIN_OFFLINE', `Brain Server is not reachable: ${detail}`, EXIT.SERVICE_UNAVAILABLE),
  authMissing: () => new OmctxError('OMCTX_AUTH_MISSING', 'no local API token found (set OMNI_LOCAL_API_TOKEN or run the Omni Desktop app once)', EXIT.AUTH_ERROR),
  authRejected: () => new OmctxError('OMCTX_AUTH_REJECTED', 'Brain Server rejected authentication', EXIT.AUTH_ERROR),
  controlAuthMissing: () => new OmctxError('OMCTX_CONTROL_SESSION_MISSING', 'no active Desktop control session found; enable CLI approvals in Omni Desktop', EXIT.AUTH_ERROR),
  controlAuthRejected: () => new OmctxError('OMCTX_CONTROL_AUTH_REJECTED', 'Desktop control session was rejected or expired', EXIT.AUTH_ERROR),
  controlScopeDenied: () => new OmctxError('OMCTX_CONTROL_SCOPE_INSUFFICIENT', 'control session is not scoped for approvals', EXIT.AUTH_ERROR),
  controlRateLimited: () => new OmctxError('OMCTX_CONTROL_RATE_LIMITED', 'approval requests are temporarily rate limited', EXIT.SERVICE_UNAVAILABLE),
  verificationAuthMissing: () => new OmctxError('OMCTX_VERIFY_SESSION_MISSING', 'no active Desktop verification session found; enable CLI verification in Omni Desktop', EXIT.AUTH_ERROR),
  verificationAuthRejected: () => new OmctxError('OMCTX_VERIFY_AUTH_REJECTED', 'Desktop verification session was rejected or expired', EXIT.AUTH_ERROR),
  verificationScopeDenied: () => new OmctxError('OMCTX_VERIFY_SCOPE_INSUFFICIENT', 'control session is not scoped for verification', EXIT.AUTH_ERROR),
  verificationRejected: (detail) => new OmctxError('OMCTX_VERIFICATION_REJECTED', `verification was rejected${detail ? `: ${detail}` : ''}`, EXIT.CONTRACT_OR_DATA_ERROR),
  reopenAuthMissing: () => new OmctxError('OMCTX_REOPEN_SESSION_MISSING', 'no active Desktop reopen session found; enable revision reopen in Omni Desktop', EXIT.AUTH_ERROR),
  reopenAuthRejected: () => new OmctxError('OMCTX_REOPEN_AUTH_REJECTED', 'Desktop reopen session was rejected or expired', EXIT.AUTH_ERROR),
  reopenScopeDenied: () => new OmctxError('OMCTX_REOPEN_SCOPE_INSUFFICIENT', 'control session is not scoped for reopen', EXIT.AUTH_ERROR),
  reopenRejected: (code) => new OmctxError('OMCTX_REOPEN_REJECTED', `reopen was rejected${code ? `: ${code}` : ''}`, EXIT.CONTRACT_OR_DATA_ERROR),
  reopenEvidenceRejected: () => new OmctxError('OMCTX_REOPEN_EVIDENCE_REQUALIFICATION_FAILED', 'current evidence could not be requalified for the revision', EXIT.CONTRACT_OR_DATA_ERROR),
  planNotFound: () => new OmctxError('OMCTX_PLAN_NOT_FOUND', 'the requested authorization plan was not found', EXIT.CONTRACT_OR_DATA_ERROR),
  approvalRejected: (detail) => new OmctxError('OMCTX_APPROVAL_REJECTED', `approval was rejected${detail ? `: ${detail}` : ''}`, EXIT.CONTRACT_OR_DATA_ERROR),
  wrongService: () => new OmctxError('OMCTX_WRONG_SERVICE', 'the reachable service did not prove it is the Omni-Context Brain Server', EXIT.CONTRACT_OR_DATA_ERROR),
  unsupportedControlProtocol: (detail = 'the Brain Server did not advertise a supported control protocol') => new OmctxError('OMCTX_UNSUPPORTED_CONTROL_PROTOCOL', detail, EXIT.CONTRACT_OR_DATA_ERROR),
  remoteApi: () => new OmctxError('OMCTX_REMOTE_API_NOT_SUPPORTED_IN_ALPHA', 'the Alpha CLI only talks to loopback (127.0.0.1 / localhost / ::1)', EXIT.USAGE_ERROR),
  invalidDecisionId: (id) => new OmctxError('OMCTX_INVALID_DECISION_ID', `'${id}' is not a valid decision id`, EXIT.USAGE_ERROR),
  decisionNotFound: (id) => new OmctxError('OMCTX_DECISION_NOT_FOUND', `decision '${id}' was not found`, EXIT.CONTRACT_OR_DATA_ERROR),
  controlSurfaceLocked: (command) => new OmctxError('OMCTX_CONTROL_SURFACE_LOCKED', `'${command}' is a TARGET command. The public mutation gateway has not passed the CLI Control Surface Security Gate.`, EXIT.FEATURE_LOCKED),
  featureNotAvailable: (command) => new OmctxError('FEATURE_NOT_AVAILABLE', `'${command}' is a FUTURE command and is not implemented in this Alpha.`, EXIT.FEATURE_LOCKED),
  toolNotAllowed: (toolName) => new OmctxError('CLI_READ_TOOL_NOT_ALLOWED', `tool '${toolName}' is not on the omctx read-only allowlist; the request was not sent`, EXIT.FEATURE_LOCKED),
  unexpectedResponse: (detail) => new OmctxError('OMCTX_UNEXPECTED_RESPONSE', `unexpected Brain Server response: ${detail}`, EXIT.CONTRACT_OR_DATA_ERROR),
  usage: (message) => new OmctxError('USAGE_ERROR', message, EXIT.USAGE_ERROR),
};
