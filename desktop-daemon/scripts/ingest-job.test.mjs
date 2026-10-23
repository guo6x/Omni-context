import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ingestExtractionModeNotice,
  normalizeIngestExtractionMode,
  normalizeIngestJobSnapshot,
} from '../src/lib/ingest-extraction-mode.ts';

test('maps Brain extraction receipts to Desktop modes without treating unknown as local', () => {
  assert.equal(normalizeIngestExtractionMode('default'), 'configured');
  assert.equal(normalizeIngestExtractionMode('configured'), 'configured');
  assert.equal(normalizeIngestExtractionMode('local_only'), 'local');
  assert.equal(normalizeIngestExtractionMode('local'), 'local');
  assert.equal(normalizeIngestExtractionMode('unknown'), 'unknown');
  assert.equal(normalizeIngestExtractionMode(null), 'unknown');
  assert.equal(normalizeIngestExtractionMode(undefined), 'unknown');

  assert.equal(ingestExtractionModeNotice('configured'), null);
  assert.equal(ingestExtractionModeNotice('local'), 'local');
  assert.equal(ingestExtractionModeNotice('unknown'), 'unknown');
  assert.equal(ingestExtractionModeNotice(undefined, true), 'local');
  // A user's draft choice cannot override an unknown restored receipt.
  assert.equal(ingestExtractionModeNotice('unknown', true), 'unknown');
  const localReceipt = normalizeIngestJobSnapshot({ jobId: 'legacy-local', extractionMode: 'local_only' });
  assert.equal(localReceipt.extractionMode, 'local');
  const unknownReceipt = normalizeIngestJobSnapshot({ jobId: 'legacy-unknown', extractionMode: 'unknown' });
  assert.equal(unknownReceipt.extractionMode, 'unknown');
  assert.equal(ingestExtractionModeNotice(unknownReceipt.extractionMode, true), 'unknown');
  const missingReceiptMode = normalizeIngestJobSnapshot({ jobId: 'legacy-missing' });
  assert.equal(missingReceiptMode.extractionMode, 'unknown');
});
