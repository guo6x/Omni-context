export type ImportJobOwner = 'onboarding' | 'library' | 'file-drop';

export interface StoredImportJob {
  kind: 'job';
  owner: ImportJobOwner;
  jobId: string;
  savedAt: number;
}

export interface StoredUncertainImport {
  kind: 'uncertain';
  owner: ImportJobOwner;
  attemptId: string;
  savedAt: number;
}

export type StoredImportRecovery = StoredImportJob | StoredUncertainImport;

const STORAGE_KEY = 'omni-context.pending-import-jobs.v1';
const MAX_STORED_JOBS = 1_000;
const OWNERS = new Set<ImportJobOwner>(['onboarding', 'library', 'file-drop']);

// This set distinguishes records created by the current renderer from records
// restored after a restart. Only restored records block a fresh upload globally.
const currentSessionRecords = new Set<string>();

function isOwner(value: unknown): value is ImportJobOwner {
  return typeof value === 'string' && OWNERS.has(value as ImportJobOwner);
}

function recordKey(record: StoredImportRecovery): string {
  return record.kind === 'job'
    ? `job:${record.owner}:${record.jobId}`
    : `attempt:${record.owner}:${record.attemptId}`;
}

function normalizeStoredRecord(value: unknown): StoredImportRecovery | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { kind?: unknown; owner?: unknown; savedAt?: unknown; jobId?: unknown; attemptId?: unknown };
  if (!isOwner(candidate.owner) || typeof candidate.savedAt !== 'number' || !Number.isFinite(candidate.savedAt)) return null;

  // Accept the initial v1 job-only shape so an interrupted rollout remains recoverable.
  if ((candidate.kind === 'job' || candidate.kind === undefined)
    && typeof candidate.jobId === 'string' && candidate.jobId.length > 0 && candidate.jobId.length <= 128) {
    return { kind: 'job', owner: candidate.owner, jobId: candidate.jobId, savedAt: candidate.savedAt };
  }
  if (candidate.kind === 'uncertain' && typeof candidate.attemptId === 'string'
    && candidate.attemptId.length > 0 && candidate.attemptId.length <= 128) {
    return { kind: 'uncertain', owner: candidate.owner, attemptId: candidate.attemptId, savedAt: candidate.savedAt };
  }
  return null;
}

/**
 * Persist only opaque task/attempt IDs needed to recover safely. Never store
 * file bytes, names, paths, provider data, content fingerprints, or credentials.
 */
export function getPendingImportJobs(): StoredImportRecovery[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeStoredRecord).filter((record): record is StoredImportRecovery => record !== null)
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export function getUnresolvedImportRecoveries(): StoredImportRecovery[] {
  return getPendingImportJobs().filter(record => !currentSessionRecords.has(recordKey(record)));
}

export function createImportRecoveryAttemptId(): string {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* fall through for older WebViews */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function saveRecords(records: StoredImportRecovery[]): boolean {
  if (typeof window === 'undefined') return false;
  if (records.length > MAX_STORED_JOBS) return false;
  try {
    if (records.length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    else window.localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Record that a write request is about to start, before its outcome can become uncertain. */
export function persistUncertainImport(owner: ImportJobOwner, attemptId: string): boolean {
  if (!attemptId || attemptId.length > 128) return false;
  const record: StoredUncertainImport = { kind: 'uncertain', owner, attemptId, savedAt: Date.now() };
  const records = getPendingImportJobs().filter(existing => recordKey(existing) !== recordKey(record));
  records.unshift(record);
  if (!saveRecords(records)) return false;
  currentSessionRecords.add(recordKey(record));
  return true;
}

/** Persist the acknowledged job ID and atomically replace its pre-submit uncertainty marker. */
export function persistImportJob(owner: ImportJobOwner, jobId: string, attemptId?: string): boolean {
  if (typeof window === 'undefined' || !jobId || jobId.length > 128) return false;
  const record: StoredImportJob = { kind: 'job', owner, jobId, savedAt: Date.now() };
  const attemptKey = attemptId ? `attempt:${owner}:${attemptId}` : null;
  const records = getPendingImportJobs().filter(existing => recordKey(existing) !== recordKey(record)
    && (!attemptKey || recordKey(existing) !== attemptKey));
  records.unshift(record);
  if (!saveRecords(records)) return false;
  if (attemptKey) currentSessionRecords.delete(attemptKey);
  currentSessionRecords.add(recordKey(record));
  return true;
}

function clearRecord(match: (record: StoredImportRecovery) => boolean): void {
  const records = getPendingImportJobs();
  const removed = records.filter(match);
  const remaining = records.filter(record => !match(record));
  if (saveRecords(remaining)) removed.forEach(record => currentSessionRecords.delete(recordKey(record)));
}

export function clearPersistedImportJob(owner: ImportJobOwner, jobId: string): void {
  clearRecord(record => record.kind === 'job' && record.owner === owner && record.jobId === jobId);
}

export function clearPersistedImportAttempt(owner: ImportJobOwner, attemptId: string): void {
  clearRecord(record => record.kind === 'uncertain' && record.owner === owner && record.attemptId === attemptId);
}
