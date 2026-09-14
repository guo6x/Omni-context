import { describe, expect, it } from 'vitest';
import type { EvidenceCoverageSnapshot } from '../src/execution/contracts.js';
import { projectDesktopEvidenceDiagnostics } from '../src/agent/pilot.js';

describe('vNext Desktop evidence diagnostics projection', () => {
  it('projects bounded plan-snapshot facts without inventing Guard reason codes', () => {
    const coverage: EvidenceCoverageSnapshot = {
      entries: [
        {
          evidence_class: 'state.present',
          status: 'present',
          verification_level: 'verified',
          evidence_ids: ['ev-1', 'ev-2', 'ev-3', 'ev-4', 'ev-5', 'ev-6'],
          checked_at: '2026-09-15T00:00:00.000Z',
        },
        {
          evidence_class: 'state.missing',
          status: 'missing',
          verification_level: 'none',
          evidence_ids: [],
          checked_at: '2026-09-15T00:00:00.000Z',
        },
        {
          evidence_class: 'state.stale',
          status: 'stale',
          verification_level: 'verified',
          evidence_ids: ['stale-1'],
          checked_at: '2026-09-15T00:00:00.000Z',
          stale_since: '2026-09-14T00:00:00.000Z',
        },
        {
          evidence_class: 'state.conflict',
          status: 'conflicted',
          verification_level: 'verified',
          evidence_ids: ['winner-1'],
          conflict_evidence_ids: ['conflict-1', 'conflict-2'],
          checked_at: '2026-09-15T00:00:00.000Z',
        },
        {
          evidence_class: 'state.unverified',
          status: 'unverified',
          verification_level: 'asserted',
          evidence_ids: ['asserted-1'],
          checked_at: '2026-09-15T00:00:00.000Z',
        },
      ],
    };

    const projection = projectDesktopEvidenceDiagnostics('guard-run-1', coverage);

    expect(projection).toMatchObject({
      projection_version: 1,
      source: 'authorization_plan_snapshot',
      guard_run_id: 'guard-run-1',
      guard_reason_codes: null,
      guard_reason_codes_status: 'NOT_AVAILABLE_FROM_PLAN_SNAPSHOT',
      missing_classes: ['state.missing'],
      stale_classes: ['state.stale'],
      conflicted_classes: ['state.conflict'],
      unverified_classes: ['state.unverified'],
    });

    const present = projection.entries.find((entry) => entry.evidence_class === 'state.present');
    expect(present?.evidence_ids).toEqual(['ev-1', 'ev-2', 'ev-3', 'ev-4', 'ev-5']);
    expect(present?.evidence_ids_truncated).toBe(true);

    const conflict = projection.entries.find((entry) => entry.evidence_class === 'state.conflict');
    expect(conflict?.conflict_evidence_ids).toEqual(['conflict-1', 'conflict-2']);
    expect(conflict?.conflict_evidence_ids_truncated).toBe(false);

    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain('source_reference');
    expect(serialized).not.toContain('token_reference');
    expect(serialized).not.toContain('approval_reference');
    expect(serialized).not.toContain('receipt_digest');
  });
});
