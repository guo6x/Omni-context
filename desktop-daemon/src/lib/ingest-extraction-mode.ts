export type IngestExtractionMode = 'configured' | 'local' | 'unknown';

/** Brain wire receipt -> explicit Desktop wording. Missing/unknown never implies local. */
export function normalizeIngestExtractionMode(value: unknown): IngestExtractionMode {
  if (value === 'local' || value === 'local_only') return 'local';
  if (value === 'configured' || value === 'default') return 'configured';
  return 'unknown';
}

/** Normalize a persisted job before recovery callbacks or UI summaries see it. */
export function normalizeIngestJobSnapshot<T extends { extractionMode?: unknown }>(job: T): Omit<T, 'extractionMode'> & { extractionMode: IngestExtractionMode } {
  return { ...job, extractionMode: normalizeIngestExtractionMode(job.extractionMode) };
}

/** Keep a user's pre-submit choice separate from a restored receipt. */
export function ingestExtractionModeNotice(
  mode: IngestExtractionMode | undefined,
  selectedLocal = false,
): 'local' | 'unknown' | null {
  if (mode === undefined) return selectedLocal ? 'local' : null;
  if (mode === 'local') return 'local';
  if (mode === 'unknown') return 'unknown';
  return null;
}
