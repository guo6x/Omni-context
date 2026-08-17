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
  remoteApi: () => new OmctxError('OMCTX_REMOTE_API_NOT_SUPPORTED_IN_ALPHA', 'the Alpha CLI only talks to loopback (127.0.0.1 / localhost / ::1)', EXIT.USAGE_ERROR),
  invalidDecisionId: (id) => new OmctxError('OMCTX_INVALID_DECISION_ID', `'${id}' is not a valid decision id`, EXIT.USAGE_ERROR),
  decisionNotFound: (id) => new OmctxError('OMCTX_DECISION_NOT_FOUND', `decision '${id}' was not found`, EXIT.CONTRACT_OR_DATA_ERROR),
  controlSurfaceLocked: (command) => new OmctxError('OMCTX_CONTROL_SURFACE_LOCKED', `'${command}' is a TARGET command. The public mutation gateway has not passed the CLI Control Surface Security Gate.`, EXIT.FEATURE_LOCKED),
  featureNotAvailable: (command) => new OmctxError('FEATURE_NOT_AVAILABLE', `'${command}' is a FUTURE command and is not implemented in this Alpha.`, EXIT.FEATURE_LOCKED),
  toolNotAllowed: (toolName) => new OmctxError('CLI_READ_TOOL_NOT_ALLOWED', `tool '${toolName}' is not on the omctx read-only allowlist; the request was not sent`, EXIT.FEATURE_LOCKED),
  unexpectedResponse: (detail) => new OmctxError('OMCTX_UNEXPECTED_RESPONSE', `unexpected Brain Server response: ${detail}`, EXIT.CONTRACT_OR_DATA_ERROR),
  usage: (message) => new OmctxError('USAGE_ERROR', message, EXIT.USAGE_ERROR),
};
