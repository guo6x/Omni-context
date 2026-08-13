/**
 * CP6 integration - evidence identity encoding + claim digest hardening.
 *
 * Covers the adversarial identity requirements:
 * - evidence ids are unambiguous (length-prefixed tuple, no NUL delimiter):
 *   ('ab','c') and ('a','bc') can never alias;
 * - identity components reject NUL / control characters fail-closed;
 * - claim digests reject every non-JSON-safe value (NaN, Infinity,
 *   undefined, BigInt, class instance, cyclic object) and are stable under
 *   object key reordering while preserving array order;
 * - diagnostic references stay deterministic for schema-invalid candidates
 *   containing control characters.
 */

import { describe, expect, it } from 'vitest';
import {
  buildEvidenceId,
  canonicalJson,
  claimDigest,
  diagnosticEvidenceReference,
  EvidenceError,
  encodeEvidenceIdTuple,
} from '../src/evidence/index.js';
import { candidate } from './helpers/fake-evidence-providers.js';
import { buildEvidenceCoverage } from '../src/evidence/coverage-builder.js';
import { requirement } from './helpers/cp6-evidence-test-rig.js';

const base = {
  provider_id: 'fake-provider',
  evidence_class: 'pull_request.state',
  subject_key: 'octocat/hello-world#42',
  source_item_id: 'item-42',
  claim_digest: 'a'.repeat(64),
};

describe('evidence id tuple encoding', () => {
  it('is unambiguous: (ab, c) and (a, bc) can never alias', () => {
    const left = buildEvidenceId({ ...base, provider_id: 'ab', source_item_id: 'c' });
    const right = buildEvidenceId({ ...base, provider_id: 'a', source_item_id: 'bc' });
    expect(left).not.toBe(right);
  });

  it('accepts delimiter-like content without ambiguity', () => {
    const withColon = buildEvidenceId({ ...base, subject_key: 'a:b|c#d' });
    expect(withColon).toMatch(/^[0-9a-f]{64}$/);
    const same = buildEvidenceId({ ...base, subject_key: 'a:b|c#d' });
    expect(withColon).toBe(same);
    const different = buildEvidenceId({ ...base, subject_key: 'a:b|c#e' });
    expect(withColon).not.toBe(different);
  });

  it('rejects NUL and control characters in every tuple component', () => {
    const fields = ['provider_id', 'evidence_class', 'subject_key', 'source_item_id', 'claim_digest'] as const;
    for (const field of fields) {
      for (const bad of ['\u0000', '\n', '\u001f', '\u007f']) {
        expect(() => buildEvidenceId({ ...base, [field]: `x${bad}y` }), `${field} with ${JSON.stringify(bad)}`).toThrowError(
          EvidenceError,
        );
      }
    }
  });

  it('rejects empty and oversized components', () => {
    expect(() => buildEvidenceId({ ...base, provider_id: '' })).toThrowError(/EVIDENCE_INPUT_INVALID/);
    expect(() => buildEvidenceId({ ...base, subject_key: 'x'.repeat(10_001) })).toThrowError(/EVIDENCE_INPUT_INVALID/);
  });

  it('is deterministic and binds the claim digest', () => {
    const first = buildEvidenceId(base);
    const second = buildEvidenceId(base);
    expect(first).toBe(second);
    expect(buildEvidenceId({ ...base, claim_digest: 'b'.repeat(64) })).not.toBe(first);
  });

  it('length-prefix encoding is stable byte-wise', () => {
    const encoded = encodeEvidenceIdTuple(['a', 'bc']);
    expect(encoded.toString('hex')).toBe('0000000161000000026263');
  });
});

describe('claim digest hardening', () => {
  it('rejects NaN, Infinity, undefined, BigInt, class instances and cycles', () => {
    class Box { value = 1; }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const badValues: Array<[string, unknown]> = [
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['undefined', undefined],
      ['BigInt', 10n],
      ['class instance', new Box()],
      ['function', () => 1],
      ['cycle', cyclic],
    ];
    for (const [label, value] of badValues) {
      expect(() => claimDigest(value), label).toThrowError(/EVIDENCE_CLAIM_INVALID/);
      expect(() => canonicalJson(value), label).toThrowError(EvidenceError);
    }
  });

  it('is stable under object key reordering and preserves array order', () => {
    const a = claimDigest({ z: 1, a: [1, 2, 3] });
    const b = claimDigest({ a: [1, 2, 3], z: 1 });
    expect(a).toBe(b);
    const reorderedArray = claimDigest({ a: [3, 2, 1] });
    expect(a).not.toBe(reorderedArray);
  });
});

describe('identity validation at qualification time', () => {
  it('a candidate with control characters in identity fields is rejected, never a build crash', () => {
    const batch = {
      provider: {
        provider_id: 'fake-provider',
        version: '1.0.0',
        supported_classes: ['pull_request.state'],
        priority: 10,
        max_verification_level: 'verified' as const,
      },
      request: { evidence_class: 'pull_request.state', subject_key: 'octocat/hello-world#42' },
      result: {
        outcome: 'collected' as const,
        diagnostics: [],
        candidates: [
          candidate({
            source_item_id: 'bad\u0000item',
            observed_at: '2026-08-13T10:00:00.000Z',
          }),
        ],
      },
    };
    const build = buildEvidenceCoverage([requirement('pull_request.state')], [batch], '2026-08-14T00:00:00.000Z');
    expect(build.snapshot.entries[0].status).toBe('unverified');
    expect(build.snapshot.entries[0].note).toContain('invalid_identity_component');
  });

  it('schema-invalid candidates with control characters get a deterministic diagnostic reference', () => {
    const first = diagnosticEvidenceReference('fake-provider', 'pull_request.state', 'octocat/hello-world#42', {
      evidence_class: 'pull_request.state',
      subject_key: 'bad\u0000subject',
      claim_key: 'bad\u001fkey',
      source_item_id: 'bad\u007fitem',
    });
    const second = diagnosticEvidenceReference('fake-provider', 'pull_request.state', 'octocat/hello-world#42', {
      evidence_class: 'pull_request.state',
      subject_key: 'bad\u0000subject',
      claim_key: 'bad\u001fkey',
      source_item_id: 'bad\u007fitem',
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^ref:[0-9a-f]{64}$/);
  });
});
