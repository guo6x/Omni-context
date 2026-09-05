export type RevisionErrorCode =
  | 'REVISION_INPUT_INVALID'
  | 'REVISION_DECISION_NOT_FOUND'
  | 'REVISION_OUTCOME_NOT_BOUND'
  | 'REVISION_NOT_ELIGIBLE'
  | 'REVISION_REASON_REQUIRED'
  | 'REVISION_AUTHORITY_REQUIRED'
  | 'REVISION_SCOPE_INSUFFICIENT'
  | 'REVISION_RUNTIME_UNAVAILABLE'
  | 'REVISION_ACTIVE_EXISTS'
  | 'REVISION_FORK_BLOCKED'
  | 'REVISION_CYCLE_BLOCKED'
  | 'REVISION_INDEX_INVALID'
  | 'REVISION_CONTEXT_INVALID'
  | 'REVISION_EVIDENCE_REQUALIFICATION_FAILED'
  | 'REVISION_PERSISTENCE_FAILURE';

/** Stable, secret-free error vocabulary for the human reopen control plane. */
export class RevisionError extends Error {
  constructor(public readonly code: RevisionErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'RevisionError';
  }
}
