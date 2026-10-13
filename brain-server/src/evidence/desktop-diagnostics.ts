import type { GuardRunStore, QualifiedEvidenceStore } from './stores.js';

const MAX_DESKTOP_PROVENANCE_ITEMS = 20;
const MAX_DESKTOP_PROVIDER_OUTCOMES = 50;
const MAX_DESKTOP_CLARIFICATION_NEEDS = 50;
const MAX_DESKTOP_SOURCE_REFERENCE_CHARS = 500;

export type DesktopGuardDiagnosticsProjection =
  | {
      projection_version: 1;
      source: 'live_guard_run';
      availability: 'NOT_AVAILABLE';
      availability_reason: 'GUARD_RUN_RESTART_INVALIDATED_OR_EVICTED';
      guard_run_id: string;
    }
  | {
      projection_version: 1;
      source: 'live_guard_run';
      availability: 'AVAILABLE';
      availability_reason: null;
      guard_run_id: string;
      final_action: string;
      reason_codes: string[];
      rounds_used: number;
      started_at: string;
      finished_at: string;
      aborted: boolean;
      provider_outcomes: Array<{
        evidence_class: string;
        kind: string;
        retryable: boolean;
        alternate_provider_available: boolean;
      }>;
      provider_outcomes_truncated: boolean;
      clarification_needs: Array<{
        evidence_class: string;
        clarification_key: string;
      }>;
      clarification_needs_truncated: boolean;
      qualified_evidence_total: number;
      qualified_evidence_returned: number;
      qualified_evidence_truncated: boolean;
      missing_lineage_count: number;
      qualified_evidence: Array<{
        evidence_id: string;
        evidence_class: string;
        provider_id: string;
        provider_version: string;
        source_item_id: string;
        source_reference: string;
        source_reference_truncated: boolean;
        observed_at: string;
        verification_level: string;
        qualified_at: string;
      }>;
    };

export type DesktopEvidenceDiagnosticsProjector = (
  guardRunId: string,
) => DesktopGuardDiagnosticsProjection;

function boundedSourceReference(value: string): { value: string; truncated: boolean } {
  if (value.length <= MAX_DESKTOP_SOURCE_REFERENCE_CHARS) {
    return { value, truncated: false };
  }
  return {
    value: value.slice(0, MAX_DESKTOP_SOURCE_REFERENCE_CHARS),
    truncated: true,
  };
}

/**
 * Creates a narrow read-only projection over the process-local CP6 ledgers.
 *
 * The stores remain private to the production composition root. The returned
 * closure exposes only bounded diagnostics needed by the local Desktop human
 * control surface. It is deliberately restart-sensitive: a missing Guard run
 * is reported as NOT_AVAILABLE and is never reconstructed from plan state.
 */
export function createDesktopEvidenceDiagnosticsProjector(
  guardRunStore: GuardRunStore,
  qualifiedEvidenceStore: QualifiedEvidenceStore,
): DesktopEvidenceDiagnosticsProjector {
  return (guardRunId: string): DesktopGuardDiagnosticsProjection => {
    const run = guardRunStore.get(guardRunId);
    if (!run) {
      return {
        projection_version: 1,
        source: 'live_guard_run',
        availability: 'NOT_AVAILABLE',
        availability_reason: 'GUARD_RUN_RESTART_INVALIDATED_OR_EVICTED',
        guard_run_id: guardRunId,
      };
    }

    const ids = run.qualified_evidence_ids.slice(0, MAX_DESKTOP_PROVENANCE_ITEMS);
    const qualifiedEvidence = ids.flatMap((evidenceId) => {
      const record = qualifiedEvidenceStore.get(evidenceId);
      if (!record) return [];
      const source = boundedSourceReference(record.source_reference);
      return [{
        evidence_id: record.evidence_id,
        evidence_class: record.evidence_class,
        provider_id: record.provider_id,
        provider_version: record.provider_version,
        source_item_id: record.source_item_id,
        source_reference: source.value,
        source_reference_truncated: source.truncated,
        observed_at: record.observed_at,
        verification_level: record.verification_level,
        qualified_at: record.qualified_at,
      }];
    });

    return {
      projection_version: 1,
      source: 'live_guard_run',
      availability: 'AVAILABLE',
      availability_reason: null,
      guard_run_id: run.guard_run_id,
      final_action: run.final_action,
      reason_codes: [...run.reason_codes],
      rounds_used: run.rounds_used,
      started_at: run.started_at,
      finished_at: run.finished_at,
      aborted: run.aborted,
      provider_outcomes: run.provider_outcomes
        .slice(0, MAX_DESKTOP_PROVIDER_OUTCOMES)
        .map((outcome) => ({
          evidence_class: outcome.evidence_class,
          kind: outcome.kind,
          retryable: outcome.retryable,
          alternate_provider_available: outcome.alternate_provider_available,
        })),
      provider_outcomes_truncated: run.provider_outcomes.length > MAX_DESKTOP_PROVIDER_OUTCOMES,
      clarification_needs: run.clarification_needs
        .slice(0, MAX_DESKTOP_CLARIFICATION_NEEDS)
        .map((need) => ({
          evidence_class: need.evidence_class,
          clarification_key: need.clarification_key,
        })),
      clarification_needs_truncated: run.clarification_needs.length > MAX_DESKTOP_CLARIFICATION_NEEDS,
      qualified_evidence_total: run.qualified_evidence_ids.length,
      qualified_evidence_returned: qualifiedEvidence.length,
      qualified_evidence_truncated: run.qualified_evidence_ids.length > MAX_DESKTOP_PROVENANCE_ITEMS,
      missing_lineage_count: ids.length - qualifiedEvidence.length,
      qualified_evidence: qualifiedEvidence,
    };
  };
}
