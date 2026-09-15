import http from 'http';
import { describe, expect, it } from 'vitest';
import type { RequestContext } from '../src/api/routes.js';
import { handleAgentRoutes } from '../src/api/handlers/agent.js';
import type { EvidenceCoverageSnapshot } from '../src/execution/contracts.js';
import { projectDesktopEvidenceDiagnostics } from '../src/agent/pilot.js';
import { createDesktopEvidenceDiagnosticsProjector } from '../src/evidence/desktop-diagnostics.js';
import {
  buildTestRig,
  validProvider,
  CLASS_A,
  CLASS_B,
  TEST_CAPABILITY_ID,
  TEST_SUBJECT_INPUTS,
} from './helpers/cp6-evidence-test-rig.js';

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

  it('projects live Guard reason/provenance only while the process-local ledger still exists', async () => {
    const rig = buildTestRig();
    rig.providers.register(validProvider(CLASS_A, 'alpha-ok'));
    rig.providers.register(validProvider(CLASS_B, 'beta-ok'));

    const evaluation = await rig.runtime.evaluateForCapability({
      capability_id: TEST_CAPABILITY_ID,
      capability_version: '1.0.0',
      normalized_inputs: TEST_SUBJECT_INPUTS,
    });
    const projector = createDesktopEvidenceDiagnosticsProjector(
      rig.guardRunStore,
      rig.qualifiedStore,
    );

    const live = projector(evaluation.guard_run_id);
    expect(live).toMatchObject({
      projection_version: 1,
      source: 'live_guard_run',
      availability: 'AVAILABLE',
      guard_run_id: evaluation.guard_run_id,
      final_action: 'proceed',
      aborted: false,
      qualified_evidence_total: 2,
      qualified_evidence_returned: 2,
      qualified_evidence_truncated: false,
      missing_lineage_count: 0,
    });
    if (live.availability !== 'AVAILABLE') throw new Error('expected live Guard diagnostics');
    expect(live.qualified_evidence).toHaveLength(2);
    expect(live.qualified_evidence.every((item) => item.source_reference.length > 0)).toBe(true);
    expect(live.qualified_evidence.every((item) => item.provider_id.length > 0)).toBe(true);
    expect(JSON.stringify(live)).not.toContain('claim_digest');
    expect(JSON.stringify(live)).not.toContain('token_reference');
    expect(JSON.stringify(live)).not.toContain('approval_reference');
    expect(JSON.stringify(live)).not.toContain('receipt_digest');

    expect(projector('guard-run-after-restart')).toEqual({
      projection_version: 1,
      source: 'live_guard_run',
      availability: 'NOT_AVAILABLE',
      availability_reason: 'GUARD_RUN_RESTART_INVALIDATED_OR_EVICTED',
      guard_run_id: 'guard-run-after-restart',
    });
  });

  it('rejects paired device principals before materializing the Desktop control projection', async () => {
    const route = handleAgentRoutes.find((candidate) => candidate.path === '/api/control/plans');
    expect(route).toBeDefined();

    let responseBody = '';
    const response = {
      statusCode: 0,
      end(payload?: string) { responseBody = payload ?? ''; },
    } as unknown as http.ServerResponse;

    const context = {
      auth: {
        kind: 'device',
        deviceId: 'mobile-fixture',
        scopes: new Set(['memory:read', 'decision:read']),
      },
    } as unknown as RequestContext;

    const handler = route!.handler as (
      req: http.IncomingMessage,
      res: http.ServerResponse,
      ctx: RequestContext,
      params: Record<string, string>,
    ) => Promise<void>;

    await handler({} as http.IncomingMessage, response, context, {});

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(responseBody)).toEqual({ error: 'CONTROL_SCOPE_INSUFFICIENT' });
  });
});
