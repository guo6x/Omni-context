/**
 * Goal24 Checkpoint 6 (Lane B) - Evidence Surface Guard control runtime.
 *
 * Deterministic control loop: after evidence coverage exists, the guard
 * decides PROCEED / RETRIEVE_MORE / CLARIFY / DEFER / BLOCK. It never calls
 * an LLM, never executes a process, never talks to the Tauri Broker, and
 * never generates approval artifacts.
 *
 * PROCEED only means "evidence gate cleared". Approval remains a Checkpoint
 * 7 concern even after the gate clears.
 */

import { assessEvidenceCoverage, EvidenceCoverageSnapshotSchema } from '../execution/contracts.js';
import type { EvidenceCoverageSnapshot } from '../execution/contracts.js';
import {
  classifyClassControl,
  chooseControlAction,
  detectCoverageRegression,
  evidenceGateCleared,
  type ClassDecision,
} from './guard-policy.js';
import {
  EvidenceGuardRequestSchema,
  ProviderOutcomeSchema,
  type ClarificationNeed,
  type CollectCoverage,
  type EvidenceGuardResult,
  type EvidenceGuardRequest,
  type EvidenceGuardRequestWithSignal,
  type GuardReasonCode,
  type GuardTraceRound,
  type ProviderOutcome,
} from './guard-types.js';

const EMPTY_COVERAGE: EvidenceCoverageSnapshot = { entries: [] };

function latestCheckedAt(coverage: EvidenceCoverageSnapshot): string | null {
  const times = (coverage.entries ?? []).map((entry) => entry.checked_at).sort();
  return times.length > 0 ? times[times.length - 1] : null;
}

function assessmentSummary(assessment: ReturnType<typeof assessEvidenceCoverage>) {
  return {
    mandatory_satisfied: assessment.mandatory_satisfied,
    missing_mandatory: [...assessment.missing_mandatory],
    blocking_reasons: [...assessment.blocking_reasons],
  };
}

function makeTraceRound(
  round: number,
  coverage: EvidenceCoverageSnapshot,
  assessment: ReturnType<typeof assessEvidenceCoverage>,
  action: EvidenceGuardResult['action'],
  reasonCodes: GuardReasonCode[],
  requestedClasses: string[],
): GuardTraceRound {
  return {
    round,
    checked_at: latestCheckedAt(coverage),
    requested_classes: [...requestedClasses],
    assessment_summary: assessmentSummary(assessment),
    chosen_action: action,
    reason_codes: [...new Set(reasonCodes)],
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function failClosed(
  action: 'block',
  reasonCodes: GuardReasonCode[],
  assessment: ReturnType<typeof assessEvidenceCoverage>,
  coverage: EvidenceCoverageSnapshot,
  roundsUsed: number,
  requestedAll: string[],
  outcomesAll: ProviderOutcome[],
  warningsAll: string[],
  nonBlockingAll: string[],
  trace: GuardTraceRound[],
  correlationId: string | null,
  aborted: boolean,
): EvidenceGuardResult {
  return {
    action,
    rounds_used: roundsUsed,
    final_coverage: coverage,
    final_assessment: assessment,
    requested_classes: [...new Set(requestedAll)].sort(),
    remaining_mandatory: [...assessment.missing_mandatory].sort(),
    reason_codes: [...new Set(reasonCodes)],
    provider_outcomes: outcomesAll,
    warnings: [...new Set(warningsAll)],
    non_blocking_findings: [...new Set(nonBlockingAll)],
    clarification_needs: [],
    trace,
    aborted,
    correlation_id: correlationId,
  };
}

/**
 * Run the deterministic evidence guard.
 *
 * `collectCoverage` is the only injected retrieval seam (Lane A provider
 * runtime will be adapted behind it at integration time). The callback must
 * honor the AbortSignal; a non-cooperative callback cannot be preempted.
 */
export async function runEvidenceGuard(
  request: EvidenceGuardRequestWithSignal,
  collectCoverage: CollectCoverage,
): Promise<EvidenceGuardResult> {
  if (typeof collectCoverage !== 'function') {
    throw new TypeError('collectCoverage must be a function');
  }

  const { signal: externalSignal, ...requestFields } = request;
  const parsed = EvidenceGuardRequestSchema.safeParse(requestFields);
  if (!parsed.success) {
    throw new TypeError(`invalid EvidenceGuardRequest: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
  }
  const validated: EvidenceGuardRequest = parsed.data;
  const requirements = validated.requirements;
  const maxRounds = validated.max_retrieval_rounds;

  let coverage = validated.initial_coverage ?? EMPTY_COVERAGE;
  const initialCheck = EvidenceCoverageSnapshotSchema.safeParse(coverage);
  if (!initialCheck.success) {
    throw new TypeError('initial_coverage is not a valid EvidenceCoverageSnapshot');
  }

  const trace: GuardTraceRound[] = [];
  const requestedAll: string[] = [];
  const outcomesAll: ProviderOutcome[] = [];
  const warningsAll: string[] = [];
  const nonBlockingAll: string[] = [];
  const latestOutcomesByClass = new Map<string, ProviderOutcome[]>();
  const attempted = new Set<string>();
  let roundsUsed = 0;
  let aborted = false;

  const finalize = (
    action: EvidenceGuardResult['action'],
    reasonCodes: GuardReasonCode[],
    assessment: ReturnType<typeof assessEvidenceCoverage>,
    finalCoverage: EvidenceGuardResult['final_coverage'],
    clarificationNeeds: ClarificationNeed[] = [],
  ): EvidenceGuardResult => ({
    action,
    rounds_used: roundsUsed,
    final_coverage: finalCoverage,
    final_assessment: assessment,
    requested_classes: [...new Set(requestedAll)].sort(),
    remaining_mandatory: [...assessment.missing_mandatory].sort(),
    reason_codes: [...new Set(reasonCodes)],
    provider_outcomes: outcomesAll,
    warnings: [...new Set([...warningsAll, ...assessment.warnings])],
    non_blocking_findings: [...new Set([...nonBlockingAll, ...assessment.non_blocking_findings])],
    clarification_needs: clarificationNeeds,
    trace,
    aborted,
    correlation_id: validated.correlation_id ?? null,
  });

  const decisionsFor = (assessment: ReturnType<typeof assessEvidenceCoverage>): ClassDecision[] => {
    const byClass = new Map(assessment.entries.map((entry) => [entry.class_id, entry]));
    return requirements
      .filter((requirement) => {
        const entry = byClass.get(requirement.class_id);
        return requirement.mandatory && entry !== undefined && !entry.satisfied;
      })
      .map((requirement) =>
        classifyClassControl(
          requirement.class_id,
          latestOutcomesByClass.get(requirement.class_id) ?? [],
          attempted.has(requirement.class_id),
        ),
      );
  };

  const clarificationNeedsFor = (decisions: ClassDecision[]): ClarificationNeed[] => {
    const needs: ClarificationNeed[] = [];
    for (const decision of decisions) {
      if (decision.final_kind !== 'user_context') continue;
      const outcome = (latestOutcomesByClass.get(decision.class_id) ?? []).find(
        (candidate) => candidate.kind === 'user_context_required',
      );
      needs.push({ evidence_class: decision.class_id, clarification_key: outcome?.clarification_key ?? decision.class_id });
    }
    return needs;
  };

  let assessment = assessEvidenceCoverage(requirements, coverage);
  for (const finding of assessment.non_blocking_findings) nonBlockingAll.push(finding);
  for (const warning of assessment.warnings) warningsAll.push(warning);

  if (assessment.mandatory_satisfied) {
    trace.push(makeTraceRound(0, coverage, assessment, 'proceed', ['EVIDENCE_SATISFIED'], []));
    return finalize('proceed', ['EVIDENCE_SATISFIED'], assessment, coverage);
  }

  while (roundsUsed < maxRounds) {
    const decisions = decisionsFor(assessment);
    const control = chooseControlAction(assessment, decisions, roundsUsed, maxRounds);
    trace.push(
      makeTraceRound(roundsUsed, coverage, assessment, control.action, control.reason_codes, control.requested_classes),
    );
    if (control.action !== 'retrieve_more') {
      const needs = control.action === 'clarify' ? clarificationNeedsFor(decisions) : [];
      return finalize(control.action, control.reason_codes, assessment, coverage, needs);
    }

    const requestedClasses = control.requested_classes;
    for (const classId of requestedClasses) {
      attempted.add(classId);
      requestedAll.push(classId);
    }

    const round = roundsUsed + 1;
    const timeoutSignal = AbortSignal.timeout(validated.per_round_timeout_ms);
    const roundSignal = externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal;

    let outcome: ReturnType<CollectCoverage>;
    try {
      outcome = await collectCoverage({
        requirements,
        previousCoverage: coverage,
        requestedClasses,
        round,
        signal: roundSignal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        if (externalSignal?.aborted) {
          aborted = true;
          return finalize('defer', ['GUARD_ABORTED'], assessment, coverage);
        }
        if (timeoutSignal.aborted) {
          const synthetic: ProviderOutcome[] = requestedClasses.map((classId) => ({
            evidence_class: classId,
            kind: 'temporary_unavailable',
            retryable: true,
            note: 'per-round collection timeout',
          }));
          for (const item of synthetic) outcomesAll.push(item);
          recordRoundOutcomes(synthetic, latestOutcomesByClass);
          roundsUsed += 1;
          continue;
        }
        aborted = true;
        return finalize('defer', ['GUARD_ABORTED'], assessment, coverage);
      }
      return failClosed(
        'block',
        ['PROVIDER_ERROR'],
        assessment,
        coverage,
        roundsUsed,
        requestedAll,
        outcomesAll,
        warningsAll,
        nonBlockingAll,
        trace,
        validated.correlation_id ?? null,
        aborted,
      );
    }

    const coverageCheck = EvidenceCoverageSnapshotSchema.safeParse(outcome.coverage);
    if (!coverageCheck.success) {
      return failClosed(
        'block',
        ['PROVIDER_ERROR'],
        assessment,
        coverage,
        roundsUsed,
        requestedAll,
        outcomesAll,
        warningsAll,
        nonBlockingAll,
        trace,
        validated.correlation_id ?? null,
        aborted,
      );
    }
    for (const item of outcome.outcomes) {
      const outcomeCheck = ProviderOutcomeSchema.safeParse(item);
      if (!outcomeCheck.success) {
        return failClosed(
          'block',
          ['PROVIDER_ERROR'],
          assessment,
          coverage,
          roundsUsed,
          requestedAll,
          outcomesAll,
          warningsAll,
          nonBlockingAll,
          trace,
          validated.correlation_id ?? null,
          aborted,
        );
      }
    }

    const regressed = detectCoverageRegression(coverage, coverageCheck.data, assessment);
    if (regressed.length > 0) {
      return finalize('block', ['COVERAGE_REGRESSION'], assessment, coverage);
    }

    coverage = coverageCheck.data;
    for (const item of outcome.outcomes) outcomesAll.push(item);
    recordRoundOutcomes(outcome.outcomes, latestOutcomesByClass);
    roundsUsed += 1;

    assessment = assessEvidenceCoverage(requirements, coverage);
    for (const finding of assessment.non_blocking_findings) nonBlockingAll.push(finding);
    for (const warning of assessment.warnings) warningsAll.push(warning);

    if (assessment.mandatory_satisfied) {
      trace.push(makeTraceRound(roundsUsed, coverage, assessment, 'proceed', ['EVIDENCE_SATISFIED'], []));
      return finalize('proceed', ['EVIDENCE_SATISFIED'], assessment, coverage);
    }
  }

  const finalDecisions = decisionsFor(assessment);
  const finalControl = chooseControlAction(assessment, finalDecisions, roundsUsed, maxRounds);
  trace.push(
    makeTraceRound(roundsUsed, coverage, assessment, finalControl.action, finalControl.reason_codes, []),
  );
  const needs = finalControl.action === 'clarify' ? clarificationNeedsFor(finalDecisions) : [];
  return finalize(finalControl.action, finalControl.reason_codes, assessment, coverage, needs);
}

function recordRoundOutcomes(
  outcomes: ProviderOutcome[],
  latestOutcomesByClass: Map<string, ProviderOutcome[]>,
): void {
  const byClass = new Map<string, ProviderOutcome[]>();
  for (const outcome of outcomes) {
    const list = byClass.get(outcome.evidence_class) ?? [];
    list.push(outcome);
    byClass.set(outcome.evidence_class, list);
  }
  for (const [classId, list] of byClass) {
    latestOutcomesByClass.set(classId, list);
  }
}

export { evidenceGateCleared };