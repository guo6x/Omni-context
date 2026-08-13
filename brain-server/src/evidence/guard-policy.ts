/**
 * Goal24 Checkpoint 6 (Lane B) - deterministic guard policy.
 *
 * Pure decision helpers. No LLM, no time, no IO, no registry. The action
 * selection is a fixed precedence:
 *
 *   1. coverage regression        -> block (fail closed, checked every round)
 *   2. assessment satisfied       -> proceed (optional evidence can never gate)
 *   3. budget remains + retryable -> retrieve_more (unsatisfied mandatory only)
 *   4. exhausted / no path: hard gap -> block > user_context -> clarify >
 *      temporary -> defer (safety-first, deterministic)
 */

import type { EvidenceRequirement } from '../capabilities/contracts.js';
import type {
  CoverageAssessment,
  CoverageAssessmentEntry,
  EvidenceCoverageSnapshot,
  EvidenceStatus,
} from '../execution/contracts.js';
import type {
  GuardAction,
  GuardReasonCode,
  ProviderOutcome,
} from './guard-types.js';

export const MAX_RETRIEVAL_ROUNDS = 10;

/** How a failing class behaves at the final (exhausted) stage. */
export type ClassFinalKind = 'hard_gap' | 'user_context' | 'temporary';

export interface ClassDecision {
  class_id: string;
  /** True while a further retrieval attempt is structurally possible. */
  can_retry_now: boolean;
  final_kind: ClassFinalKind;
  reason_codes: GuardReasonCode[];
}

export interface ControlChoice {
  action: GuardAction;
  requested_classes: string[];
  reason_codes: GuardReasonCode[];
}

const RETRY_FLAGS = (outcome: ProviderOutcome): boolean =>
  outcome.retryable === true || outcome.alternate_provider_available === true;

/**
 * Classify one unsatisfied mandatory class from structured provider outcome
 * metadata only. When no outcome metadata exists the guard never fantasizes
 * a provider: an unattempted class is retrievable once; after an attempt
 * without a structured signal it becomes a hard gap (fail closed).
 */
export function classifyClassControl(
  classId: string,
  outcomes: readonly ProviderOutcome[],
  attempted: boolean,
): ClassDecision {
  const has = (kind: ProviderOutcome['kind']): boolean => outcomes.some((outcome) => outcome.kind === kind);

  if (has('permanent_unavailable')) {
    return { class_id: classId, can_retry_now: false, final_kind: 'hard_gap', reason_codes: ['PROVIDER_PERMANENT_UNAVAILABLE'] };
  }
  if (has('collection_limit_exceeded')) {
    return { class_id: classId, can_retry_now: false, final_kind: 'hard_gap', reason_codes: ['COLLECTION_LIMIT_EXCEEDED'] };
  }
  if (has('provider_error')) {
    const retryable = outcomes.some(RETRY_FLAGS);
    return {
      class_id: classId,
      can_retry_now: retryable,
      final_kind: 'hard_gap',
      reason_codes: retryable ? ['PROVIDER_ERROR', 'RETRIEVAL_AVAILABLE'] : ['PROVIDER_ERROR'],
    };
  }
  if (has('user_context_required')) {
    return { class_id: classId, can_retry_now: false, final_kind: 'user_context', reason_codes: ['USER_CONTEXT_REQUIRED'] };
  }
  if (has('temporary_unavailable')) {
    const retryable = outcomes.some(RETRY_FLAGS);
    return {
      class_id: classId,
      can_retry_now: retryable,
      final_kind: 'temporary',
      reason_codes: retryable
        ? ['PROVIDER_TEMPORARY_UNAVAILABLE', 'RETRIEVAL_AVAILABLE']
        : ['PROVIDER_TEMPORARY_UNAVAILABLE'],
    };
  }
  if (has('collected') || has('not_found')) {
    const retryable = outcomes.some(RETRY_FLAGS);
    return {
      class_id: classId,
      can_retry_now: retryable,
      final_kind: 'hard_gap',
      reason_codes: retryable ? ['RETRIEVAL_AVAILABLE'] : ['RETRIEVAL_EXHAUSTED'],
    };
  }
  if (!attempted) {
    return { class_id: classId, can_retry_now: true, final_kind: 'hard_gap', reason_codes: ['RETRIEVAL_AVAILABLE'] };
  }
  return { class_id: classId, can_retry_now: false, final_kind: 'hard_gap', reason_codes: ['RETRIEVAL_EXHAUSTED'] };
}

function statusReasonCode(status: CoverageAssessmentEntry['status']): GuardReasonCode | null {
  switch (status) {
    case 'not_checked':
    case 'missing':
      return 'EVIDENCE_MISSING';
    case 'stale':
      return 'EVIDENCE_STALE';
    case 'unverified':
      return 'EVIDENCE_UNVERIFIED';
    case 'conflicted':
      return 'EVIDENCE_CONFLICT';
    case 'present':
      // present but unsatisfied can only mean verification below requirement
      return 'EVIDENCE_UNVERIFIED';
  }
}


function uniqueCodes(codes: readonly GuardReasonCode[]): GuardReasonCode[] {
  return [...new Set<GuardReasonCode>(codes)];
}
function unsatisfiedStatusCodes(assessment: CoverageAssessment): GuardReasonCode[] {
  const codes: GuardReasonCode[] = [];
  for (const entry of assessment.entries) {
    if (entry.satisfied) continue;
    const code = statusReasonCode(entry.status);
    if (code) codes.push(code);
  }
  return codes;
}

/**
 * Deterministic action choice.
 *
 * - satisfied          -> proceed
 * - budget + retryable -> retrieve_more (unsatisfied mandatory classes only)
 * - exhausted stage    -> hard gap (block) > user_context (clarify) >
 *                         temporary (defer)
 */
export function chooseControlAction(
  assessment: CoverageAssessment,
  decisions: readonly ClassDecision[],
  roundsUsed: number,
  maxRounds: number,
): ControlChoice {
  if (assessment.mandatory_satisfied) {
    return { action: 'proceed', requested_classes: [], reason_codes: ['EVIDENCE_SATISFIED'] };
  }

  const retryable: ClassDecision[] = decisions.filter((decision) => decision.can_retry_now);
  if (roundsUsed < maxRounds && retryable.length > 0) {
    return {
      action: 'retrieve_more',
      requested_classes: retryable.map((decision) => decision.class_id).sort(),
      reason_codes: uniqueCodes(['RETRIEVAL_AVAILABLE', ...unsatisfiedStatusCodes(assessment)]),
    };
  }

  const statusCodes: GuardReasonCode[] = unsatisfiedStatusCodes(assessment);
  const hardGap = decisions.some((decision) => decision.final_kind === 'hard_gap');
  if (hardGap) {
    const codes = new Set<GuardReasonCode>([
      'RETRIEVAL_EXHAUSTED',
      ...decisions.filter((decision) => decision.final_kind === 'hard_gap').flatMap((decision) => decision.reason_codes),
      ...statusCodes,
    ]);
    return { action: 'block', requested_classes: [], reason_codes: [...codes] };
  }
  const userContext = decisions.some((decision) => decision.final_kind === 'user_context');
  if (userContext) {
    return {
      action: 'clarify',
      requested_classes: [],
      reason_codes: uniqueCodes(['USER_CONTEXT_REQUIRED', ...statusCodes]),
    };
  }
  const temporary = decisions.some((decision) => decision.final_kind === 'temporary');
  if (temporary) {
    return {
      action: 'defer',
      requested_classes: [],
      reason_codes: uniqueCodes(['PROVIDER_TEMPORARY_UNAVAILABLE', ...statusCodes]),
    };
  }
  return { action: 'block', requested_classes: [], reason_codes: uniqueCodes(['RETRIEVAL_EXHAUSTED', ...statusCodes]) };
}

/**
 * Coverage must not shrink silently. A mandatory class that was satisfied in
 * the previous assessment is allowed to move only to an explicit stale /
 * conflicted / unverified state (every entry carries checked_at per the
 * coverage contract). Deletion, status=missing, or a silent verification
 * downgrade while still `present` is a regression.
 */
export function detectCoverageRegression(
  previousCoverage: EvidenceCoverageSnapshot,
  nextCoverage: EvidenceCoverageSnapshot,
  previousAssessment: CoverageAssessment,
): string[] {
  const previousByClass = new Map(previousCoverage.entries.map((entry) => [entry.evidence_class, entry]));
  const nextByClass = new Map(nextCoverage.entries.map((entry) => [entry.evidence_class, entry]));

  const regressed: string[] = [];
  for (const assessed of previousAssessment.entries) {
    if (!assessed.satisfied) continue;
    const previousEntry = previousByClass.get(assessed.class_id);
    if (!previousEntry) continue;

    const nextEntry = nextByClass.get(assessed.class_id);
    if (!nextEntry) {
      regressed.push(assessed.class_id);
      continue;
    }
    if (nextEntry.status === 'missing') {
      regressed.push(assessed.class_id);
      continue;
    }
    if (nextEntry.status === 'present') {
      const VERIFICATION_RANK: Record<string, number> = { none: 0, asserted: 1, verified: 2 };
      if (VERIFICATION_RANK[nextEntry.verification_level] < VERIFICATION_RANK[previousEntry.verification_level]) {
        regressed.push(assessed.class_id);
      }
      continue;
    }
    // stale / conflicted / unverified: explicit degradation with checked_at basis
  }
  return regressed;
}

/**
 * Decision Kernel boundary helper: only `action === 'proceed'` means the
 * evidence gate cleared. It does not mean approved, executed, or ready to
 * spawn any process.
 */
export function evidenceGateCleared(result: { action: GuardAction }): boolean {
  return result.action === 'proceed';
}

export type { EvidenceRequirement, EvidenceStatus };