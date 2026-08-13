/**
 * Goal24 Checkpoint 6 (Lane A) - Evidence Core tests.
 *
 * Covers the strict candidate model, core-generated claim digests and
 * evidence IDs, the EvidenceProviderV1 contract, normalized provider
 * collection (PROVIDER_ERROR / abort semantics, no secret leakage) and the
 * internal provider registry ordering / duplicate rules.
 */

import { describe, expect, it } from 'vitest';
import {
  buildEvidenceId,
  claimDigest,
  EvidenceCandidateSchema,
  EvidenceError,
  EvidenceProviderRegistry,
  collectFromProvider,
  EvidenceProviderResultSchema,
  EvidenceProviderV1MetadataSchema,
  QUALIFICATION_ISSUE_CODES,
} from '../src/evidence/index.js';
import {
  candidate,
  collectedResult,
  fakeProvider,
  metadata,
  TEST_CLASS_STATE,
  TEST_SUBJECT,
} from './helpers/fake-evidence-providers.js';

describe('EvidenceCandidateSchema - strict model', () => {
  it('accepts a structurally valid candidate', () => {
    const result = EvidenceCandidateSchema.safeParse(candidate());
    expect(result.success).toBe(true);
  });

  it('rejects unknown fields including shell/command/argv/executable/evidence_id/claim_digest', () => {
    for (const extra of [
      { shell: 'bash -c whoami' },
      { command: 'calc.exe' },
      { argv: ['x'] },
      { executable: 'powershell.exe' },
      { evidence_id: '00'.repeat(32) },
      { claim_digest: '00'.repeat(32) },
    ]) {
      const result = EvidenceCandidateSchema.safeParse({ ...candidate(), ...extra });
      expect(result.success, JSON.stringify(extra)).toBe(false);
    }
  });

  it('allows words like shell/command inside text values (no executable semantics)', () => {
    const result = EvidenceCandidateSchema.safeParse(
      candidate({ note: 'the shell command failed on Windows', claim_value: { text: 'run the command manually' } }),
    );
    expect(result.success).toBe(true);
  });

  it('enforces length bounds on identity fields', () => {
    expect(EvidenceCandidateSchema.safeParse(candidate({ subject_key: 'x'.repeat(201) })).success).toBe(false);
    expect(EvidenceCandidateSchema.safeParse(candidate({ claim_key: 'x'.repeat(201) })).success).toBe(false);
    expect(EvidenceCandidateSchema.safeParse(candidate({ source_item_id: 'x'.repeat(301) })).success).toBe(false);
    expect(EvidenceCandidateSchema.safeParse(candidate({ source_reference: 'x'.repeat(1001) })).success).toBe(false);
  });

  it('rejects non-JSON-safe claim values', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const claimValue of [cyclic, Number.NaN, Number.POSITIVE_INFINITY, () => 1, 10n, undefined, new Date(0)]) {
      const result = EvidenceCandidateSchema.safeParse(candidate({ claim_value: claimValue as never }));
      expect(result.success).toBe(false);
    }
  });

  it('rejects an invalid observed_at timestamp', () => {
    expect(EvidenceCandidateSchema.safeParse(candidate({ observed_at: 'not-a-time' })).success).toBe(false);
    expect(EvidenceCandidateSchema.safeParse(candidate({ observed_at: '2026-08-13T10:00:00' })).success).toBe(false);
  });
});

describe('claim digest - canonical JSON + SHA-256', () => {
  it('is deterministic lowercase SHA-256 hex', () => {
    const digest = claimDigest({ b: 2, a: [1, 'x', null, true] });
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(claimDigest({ b: 2, a: [1, 'x', null, true] })).toBe(digest);
  });

  it('is unchanged by object key reordering', () => {
    const first = claimDigest({ z: 1, a: { y: 2, x: 3 }, b: 'value' });
    const second = claimDigest({ b: 'value', a: { x: 3, y: 2 }, z: 1 });
    expect(second).toBe(first);
  });

  it('preserves array order as semantic', () => {
    expect(claimDigest([1, 2, 3])).not.toBe(claimDigest([3, 2, 1]));
  });

  it('distinguishes JSON types and keeps numbers canonical', () => {
    expect(claimDigest(1)).toBe(claimDigest(1.0));
    expect(claimDigest(1)).not.toBe(claimDigest('1'));
    expect(claimDigest(null)).not.toBe(claimDigest('null'));
    expect(claimDigest(true)).not.toBe(claimDigest(1));
  });

  it('rejects non-JSON-safe values with EVIDENCE_CLAIM_INVALID', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [cyclic, Number.NaN, 10n]) {
      expect(() => claimDigest(value)).toThrowError(EvidenceError);
      try {
        claimDigest(value);
      } catch (error) {
        expect((error as EvidenceError).code).toBe('EVIDENCE_CLAIM_INVALID');
      }
    }
  });
});

describe('evidence id - core generated', () => {
  it('is deterministic and lowercase SHA-256 hex', () => {
    const id = buildEvidenceId({
      provider_id: 'fake-a',
      evidence_class: TEST_CLASS_STATE,
      subject_key: TEST_SUBJECT,
      source_item_id: 'item-42',
      claim_digest: claimDigest('open'),
    });
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(
      buildEvidenceId({
        provider_id: 'fake-a',
        evidence_class: TEST_CLASS_STATE,
        subject_key: TEST_SUBJECT,
        source_item_id: 'item-42',
        claim_digest: claimDigest('open'),
      }),
    ).toBe(id);
  });

  it('never collides across providers sharing the same source_item_id', () => {
    const digest = claimDigest('open');
    const idA = buildEvidenceId({ provider_id: 'fake-a', evidence_class: TEST_CLASS_STATE, subject_key: TEST_SUBJECT, source_item_id: 'item-42', claim_digest: digest });
    const idB = buildEvidenceId({ provider_id: 'fake-b', evidence_class: TEST_CLASS_STATE, subject_key: TEST_SUBJECT, source_item_id: 'item-42', claim_digest: digest });
    expect(idA).not.toBe(idB);
  });

  it('binds the claim digest', () => {
    const idOpen = buildEvidenceId({ provider_id: 'fake-a', evidence_class: TEST_CLASS_STATE, subject_key: TEST_SUBJECT, source_item_id: 'item-42', claim_digest: claimDigest('open') });
    const idClosed = buildEvidenceId({ provider_id: 'fake-a', evidence_class: TEST_CLASS_STATE, subject_key: TEST_SUBJECT, source_item_id: 'item-42', claim_digest: claimDigest('closed') });
    expect(idOpen).not.toBe(idClosed);
  });
});

describe('provider contract schemas', () => {
  it('validates provider metadata and result shapes strictly', () => {
    expect(EvidenceProviderV1MetadataSchema.safeParse(metadata()).success).toBe(true);
    expect(EvidenceProviderResultSchema.safeParse(collectedResult([candidate()])).success).toBe(true);
  });

  it('rejects metadata with duplicate supported classes or unknown keys', () => {
    expect(
      EvidenceProviderV1MetadataSchema.safeParse(metadata({ supported_classes: [TEST_CLASS_STATE, TEST_CLASS_STATE] }))
        .success,
    ).toBe(false);
    expect(EvidenceProviderV1MetadataSchema.safeParse({ ...metadata(), shell: 'x' }).success).toBe(false);
  });

  it('rejects result shapes with unknown keys', () => {
    expect(EvidenceProviderResultSchema.safeParse({ ...collectedResult([]), verified: true }).success).toBe(false);
  });

  it('exposes structured qualification issue codes', () => {
    expect(QUALIFICATION_ISSUE_CODES).toEqual(
      expect.arrayContaining(['class_mismatch', 'verification_escalation', 'future_observed_at', 'stale']),
    );
  });
});

describe('EvidenceProviderRegistry - internal, deterministic', () => {
  it('registers, gets and lists providers', () => {
    const registry = new EvidenceProviderRegistry();
    const provider = fakeProvider({ metadata: { provider_id: 'fake-a' } });
    registry.register(provider);
    expect(registry.get('fake-a')).toBe(provider);
    expect(registry.list()).toEqual([provider]);
  });

  it('rejects duplicate provider ids (including different versions)', () => {
    const registry = new EvidenceProviderRegistry();
    registry.register(fakeProvider({ metadata: { provider_id: 'fake-a', version: '1.0.0' } }));
    expect(() =>
      registry.register(fakeProvider({ metadata: { provider_id: 'fake-a', version: '2.0.0' } })),
    ).toThrowError(EvidenceError);
    try {
      registry.register(fakeProvider({ metadata: { provider_id: 'fake-a', version: '2.0.0' } }));
    } catch (error) {
      expect((error as EvidenceError).code).toBe('EVIDENCE_PROVIDER_DUPLICATE');
    }
  });

  it('rejects invalid provider metadata at registration', () => {
    const registry = new EvidenceProviderRegistry();
    expect(() =>
      registry.register(fakeProvider({ metadata: { provider_id: 'BadProvider' } })),
    ).toThrowError(EvidenceError);
  });

  it('orders providersForClass by priority desc with provider_id asc tie-break', () => {
    const registry = new EvidenceProviderRegistry();
    registry.register(fakeProvider({ metadata: { provider_id: 'z-low', priority: 10 } }));
    registry.register(fakeProvider({ metadata: { provider_id: 'a-high', priority: 100 } }));
    registry.register(fakeProvider({ metadata: { provider_id: 'b-high', priority: 100 } }));
    registry.register(fakeProvider({ metadata: { provider_id: 'other-class', priority: 999, supported_classes: ['other.class.id'] } }));
    const ids = registry.providersForClass(TEST_CLASS_STATE).map((provider) => provider.metadata.provider_id);
    expect(ids).toEqual(['a-high', 'b-high', 'z-low']);
  });

  it('rejects invalid class ids in providersForClass', () => {
    const registry = new EvidenceProviderRegistry();
    registry.register(fakeProvider());
    expect(() => registry.providersForClass('not-a-class')).toThrowError(EvidenceError);
  });
});

describe('collectFromProvider - normalized collection', () => {
  it('passes through a valid collected result', async () => {
    const provider = fakeProvider({ result: collectedResult([candidate()]) });
    const result = await collectFromProvider(provider, { evidence_class: TEST_CLASS_STATE, subject_key: TEST_SUBJECT });
    expect(result.outcome).toBe('collected');
    expect(result.candidates).toHaveLength(1);
  });

  it('normalizes provider exceptions to PROVIDER_ERROR without leaking text', async () => {
    const provider = fakeProvider({ throwError: new Error('secret-token=abc123 internal stack detail') });
    const result = await collectFromProvider(provider, { evidence_class: TEST_CLASS_STATE, subject_key: TEST_SUBJECT });
    expect(result.outcome).toBe('temporary_unavailable');
    expect(result.candidates).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('EVIDENCE_PROVIDER_ERROR');
    expect(JSON.stringify(result.diagnostics)).not.toContain('secret-token');
  });

  it('normalizes structurally invalid provider results', async () => {
    const provider = fakeProvider({
      collect: () => ({ outcome: 'collected', candidates: [], diagnostics: [], extra: true }) as never,
    });
    const result = await collectFromProvider(provider, { evidence_class: TEST_CLASS_STATE, subject_key: TEST_SUBJECT });
    expect(result.outcome).toBe('temporary_unavailable');
    expect(result.diagnostics[0].code).toBe('EVIDENCE_PROVIDER_ERROR');
  });

  it('throws EVIDENCE_COLLECTION_ABORTED for an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = fakeProvider();
    await expect(
      collectFromProvider(provider, { evidence_class: TEST_CLASS_STATE, subject_key: TEST_SUBJECT, signal: controller.signal }),
    ).rejects.toThrowError(EvidenceError);
    try {
      await collectFromProvider(provider, { evidence_class: TEST_CLASS_STATE, subject_key: TEST_SUBJECT, signal: controller.signal });
    } catch (error) {
      expect((error as EvidenceError).code).toBe('EVIDENCE_COLLECTION_ABORTED');
    }
  });

  it('throws EVIDENCE_COLLECTION_ABORTED when the provider rejects with AbortError', async () => {
    const controller = new AbortController();
    const provider = fakeProvider({
      collect: (request) => {
        if (request.signal?.aborted) {
          const error = new Error('aborted');
          error.name = 'AbortError';
          throw error;
        }
        return collectedResult([]);
      },
    });
    const promise = collectFromProvider(provider, { evidence_class: TEST_CLASS_STATE, subject_key: TEST_SUBJECT, signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrowError(EvidenceError);
  });

  it('throws EVIDENCE_COLLECTION_ABORTED when the signal aborts after the provider returned', async () => {
    const controller = new AbortController();
    const provider = fakeProvider({
      collect: async () => {
        controller.abort();
        return collectedResult([]);
      },
    });
    await expect(
      collectFromProvider(provider, { evidence_class: TEST_CLASS_STATE, subject_key: TEST_SUBJECT, signal: controller.signal }),
    ).rejects.toThrowError(EvidenceError);
  });
});