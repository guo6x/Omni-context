import {
  clearPersistedImportAttempt,
  clearPersistedImportJob,
  getUnresolvedImportRecoveries,
  type StoredImportRecovery,
  type ImportJobOwner,
} from './import-job-recovery';

const IMPORT_SUBMISSION_TIMEOUT_MS = 30_000;

export type ImportSubmissionOwner = 'onboarding' | 'library' | 'file-drop';

export interface ImportContentReservation {
  owner: ImportSubmissionOwner;
  phase: 'submitting' | 'running' | 'uncertain';
  jobId?: string;
}

export type ImportReservationResult =
  | { reserved: true }
  | { reserved: false; reason: 'fingerprint-unavailable' }
  | { reserved: false; reason: 'duplicate'; existing: ImportContentReservation }
  | { reserved: false; reason: 'recovery-required'; recovery: StoredImportRecovery };

const activeImportContent = new Map<string, ImportContentReservation>();

/**
 * A short-lived, renderer-local fingerprint lets the import surfaces share one
 * duplicate guard without retaining the source bytes, filename, path, or key
 * in persistent storage. It is intentionally never sent to the server.
 */
export async function fingerprintImportContent(content: ArrayBuffer): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', content);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    // Duplicate prevention must not turn a supported file into an import error
    // on older WebViews without Web Crypto.
    return null;
  }
}

export function reserveImportContent(
  fingerprint: string | null,
  owner: ImportSubmissionOwner,
): ImportReservationResult {
  // A missing digest means we cannot prove that a later selection is new.
  // Stop before any write rather than silently weakening duplicate protection.
  if (!fingerprint) return { reserved: false, reason: 'fingerprint-unavailable' };
  if (fingerprint) {
    const existing = activeImportContent.get(fingerprint);
    if (existing) return { reserved: false, reason: 'duplicate', existing: { ...existing } };
  }
  // After a renderer restart the original content fingerprint is intentionally
  // unavailable. Fail closed until the user checks the library or recovers the
  // saved task, rather than silently uploading the same file again.
  const recovery = getUnresolvedImportRecoveries()[0];
  if (recovery) return { reserved: false, reason: 'recovery-required', recovery };
  if (fingerprint) activeImportContent.set(fingerprint, { owner, phase: 'submitting' });
  return { reserved: true };
}

export function updateImportContentReservation(
  fingerprint: string | null,
  owner: ImportSubmissionOwner,
  update: Partial<Pick<ImportContentReservation, 'phase' | 'jobId'>>,
): void {
  if (!fingerprint) return;
  const existing = activeImportContent.get(fingerprint);
  if (!existing || existing.owner !== owner) return;
  activeImportContent.set(fingerprint, { ...existing, ...update });
}

export function releaseImportContentReservation(
  fingerprint: string | null,
  owner?: ImportSubmissionOwner,
): void {
  if (!fingerprint) return;
  const existing = activeImportContent.get(fingerprint);
  if (!existing || (owner && existing.owner !== owner)) return;
  activeImportContent.delete(fingerprint);
}

export type ImportTerminalOutcome = 'success' | 'partial' | 'failed' | 'cancelled';

/**
 * Release recovery state only after a complete success. A non-success terminal
 * job can have committed writes, so keep its opaque recovery ID and the
 * renderer-local content reservation until the user explicitly reviews the
 * library and acknowledges a fresh selection.
 */
export function settleImportOutcome(
  outcome: ImportTerminalOutcome,
  owner: ImportJobOwner,
  fingerprint: string | null,
  jobId?: string | null,
  attemptId?: string | null,
): boolean {
  if (outcome === 'success') {
    if (jobId) clearPersistedImportJob(owner, jobId);
    if (attemptId) clearPersistedImportAttempt(owner, attemptId);
    releaseImportContentReservation(fingerprint, owner);
    return false;
  }

  updateImportContentReservation(fingerprint, owner, { phase: 'uncertain', jobId: jobId ?? undefined });
  return true;
}

/** Clear the fail-closed guard only in response to an explicit user review. */
export function acknowledgeImportRecovery(
  owner: ImportJobOwner,
  fingerprint: string | null,
  jobId?: string | null,
  attemptId?: string | null,
): void {
  if (jobId) clearPersistedImportJob(owner, jobId);
  if (attemptId) clearPersistedImportAttempt(owner, attemptId);
  releaseImportContentReservation(fingerprint, owner);
}

export function getActiveImportContentReservation(
  fingerprint: string | null,
): ImportContentReservation | null {
  if (!fingerprint) return null;
  const existing = activeImportContent.get(fingerprint);
  return existing ? { ...existing } : null;
}

/**
 * One deadline for file reading, encoding, credentials, HTTP, and response body.
 * The native/file operations may ignore cancellation; their late results must
 * never resume the caller's submission workflow. This helper never retries.
 */
export function createImportSubmission(
  controller: AbortController,
  timeoutMs = IMPORT_SUBMISSION_TIMEOUT_MS,
) {
  const deadline = Date.now() + Math.max(1, timeoutMs);
  const { signal } = controller;
  let timedOut = false;
  const expire = () => {
    timedOut = true;
    controller.abort();
  };
  const timer = setTimeout(expire, Math.max(1, timeoutMs));
  const abortReason = () => signal.reason !== undefined
    ? signal.reason
    : new DOMException('Stopped waiting for import submission', 'AbortError');

  function assertActive(): void {
    // Encoding/JSON serialization can block the event loop past the timer.
    if (Date.now() >= deadline) expire();
    if (signal.aborted) throw abortReason();
  }

  function prepare<T>(operation: () => T): T {
    assertActive();
    const result = operation();
    assertActive();
    return result;
  }

  async function wait<T>(operation: () => Promise<T>): Promise<T> {
    assertActive();
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort);
        reject(abortReason());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        operation().then(
          (value) => {
            signal.removeEventListener('abort', onAbort);
            try { assertActive(); resolve(value); }
            catch (error) { reject(error); }
          },
          (error: unknown) => {
            signal.removeEventListener('abort', onAbort);
            reject(error);
          },
        );
      } catch (error) {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
      if (signal.aborted) onAbort();
    });
  }

  return {
    get timedOut() { return timedOut; },
    prepare,
    wait,
    dispose: () => clearTimeout(timer),
  };
}
