/**
 * Deterministic fake EvidenceProviderV1 implementations for CP6 tests.
 * Pure in-memory fixtures: no process execution, no network, no filesystem.
 */

import type {
  EvidenceCandidate,
  EvidenceCollectRequest,
  EvidenceProviderResult,
  EvidenceProviderV1,
  EvidenceProviderV1Metadata,
} from '../../src/evidence/index.js';

export const TEST_CLASS_STATE = 'pull_request.state';
export const TEST_CLASS_CHECKS = 'required_checks.aggregate_status';
export const TEST_SUBJECT = 'octocat/hello-world#42';

export function candidate(overrides: Partial<EvidenceCandidate> = {}): EvidenceCandidate {
  return {
    evidence_class: TEST_CLASS_STATE,
    subject_key: TEST_SUBJECT,
    claim_key: 'pull_request.state',
    claim_value: 'open',
    source_item_id: 'item-42',
    source_reference: 'repo:octocat/hello-world pr:42',
    observed_at: '2026-08-13T10:00:00.000Z',
    verification_level: 'asserted',
    ...overrides,
  };
}

export function metadata(overrides: Partial<EvidenceProviderV1Metadata> = {}): EvidenceProviderV1Metadata {
  return {
    provider_id: 'fake-provider',
    version: '1.0.0',
    supported_classes: [TEST_CLASS_STATE, TEST_CLASS_CHECKS],
    priority: 100,
    max_verification_level: 'verified',
    ...overrides,
  };
}

export interface FakeProviderOptions {
  metadata?: Partial<EvidenceProviderV1Metadata>;
  /** Returned result for every collect call. */
  result?: EvidenceProviderResult;
  /** Result factory for request-aware providers. */
  collect?: (request: EvidenceCollectRequest) => EvidenceProviderResult | Promise<EvidenceProviderResult>;
  /** When set, collect rejects with this error. */
  throwError?: Error;
  /** When set, collect respects the signal and rejects with an AbortError. */
  respectAbort?: boolean;
}

/** Deterministic fake provider: same input always produces the same output. */
export function fakeProvider(options: FakeProviderOptions = {}): EvidenceProviderV1 {
  const providerMetadata = metadata(options.metadata);
  return {
    metadata: providerMetadata,
    async collect(request) {
      if (options.throwError) {
        throw options.throwError;
      }
      if (options.respectAbort && request.signal?.aborted) {
        throw new DOMException('aborted', 'AbortError');
      }
      if (options.collect) {
        return options.collect(request);
      }
      return (
        options.result ?? {
          outcome: 'collected',
          candidates: [],
          diagnostics: [],
        }
      );
    },
  };
}

export function collectedResult(candidates: EvidenceCandidate[]): EvidenceProviderResult {
  return { outcome: 'collected', candidates, diagnostics: [] };
}