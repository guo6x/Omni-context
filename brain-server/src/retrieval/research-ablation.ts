import type { FusedRetrievalCandidate, FusionList } from './fusion.js';
import {
  detectEvidenceIntent,
  groupFusedEvidence,
  isolateRawEventChannels,
  selectEvidenceSet,
  type EvidenceGroup,
  type EvidenceSelectionResult,
  type RawEventChannelAudit,
} from './evidence-selector.js';

export const RESEARCH_ABLATION_ENV = 'OMNI_RESEARCH_ABLATION_MODE';
export const ABLATION_ENV = 'OMNI_ABLATION';

export const RESEARCH_ABLATIONS = [
  'none',
  'selector_off',
  'grouping_off',
  'source_aware_fusion_off',
] as const;

export type ResearchAblation = typeof RESEARCH_ABLATIONS[number];

export interface ResearchAblationConfig {
  researchMode: boolean;
  ablation: ResearchAblation;
}

type Environment = Partial<Record<typeof RESEARCH_ABLATION_ENV | typeof ABLATION_ENV, string | undefined>>;

/** Fail closed whenever an ablation is requested outside explicit research mode. */
export function loadResearchAblationConfig(env: Environment = process.env): ResearchAblationConfig {
  const researchMode = env[RESEARCH_ABLATION_ENV] === '1';
  const requested = String(env[ABLATION_ENV] || '').trim();
  if (!researchMode && requested) {
    throw new Error(`${ABLATION_ENV} requires ${RESEARCH_ABLATION_ENV}=1`);
  }
  const ablation = (requested || 'none') as ResearchAblation;
  if (!RESEARCH_ABLATIONS.includes(ablation)) {
    throw new Error(`Unsupported ${ABLATION_ENV}: ${requested}`);
  }
  return { researchMode, ablation };
}

export function applySourceAwareFusionAblation<T>(
  lists: FusionList<T>[],
  config: ResearchAblationConfig,
): { lists: FusionList<T>[]; audit: RawEventChannelAudit[] } {
  if (config.ablation === 'source_aware_fusion_off') {
    return {
      lists: lists.map((list) => ({ ...list, items: [...list.items] })),
      audit: [],
    };
  }
  return isolateRawEventChannels(lists);
}

function singletonEvidenceGroups<T>(
  candidates: Array<FusedRetrievalCandidate<T>>,
  rrfK: number,
): Array<EvidenceGroup<T>> {
  return candidates.map((candidate) => {
    const [group] = groupFusedEvidence([candidate], { rrfK });
    return {
      ...group,
      groupId: `standalone:${candidate.kind}:${candidate.id}`,
      rrfRank: candidate.fusedRank,
    };
  });
}

export function buildEvidenceGroupsForAblation<T>(
  candidates: Array<FusedRetrievalCandidate<T>>,
  config: { rrfK: number },
  ablation: ResearchAblationConfig,
): Array<EvidenceGroup<T>> {
  if (ablation.ablation === 'grouping_off') {
    return singletonEvidenceGroups(candidates, config.rrfK);
  }
  return groupFusedEvidence(candidates, config);
}

export function selectEvidenceForAblation<T>(
  input: {
    query: string;
    rankedGroups: Array<EvidenceGroup<T>>;
    limit: number;
    temporalMode?: string;
    includeInvalidated?: boolean;
  },
  ablation: ResearchAblationConfig,
): EvidenceSelectionResult<T> {
  if (ablation.ablation !== 'selector_off') return selectEvidenceSet(input);

  const limit = Math.max(0, Math.floor(input.limit));
  const selected = input.rankedGroups.slice(0, limit);
  const finalRanks = new Map(selected.map((group, index) => [group.groupId, index + 1]));
  return {
    selected,
    intent: detectEvidenceIntent(input.query),
    trace: input.rankedGroups.map((group, index) => ({
      groupId: group.groupId,
      selected: finalRanks.has(group.groupId),
      finalRank: finalRanks.get(group.groupId) || null,
      reason: finalRanks.has(group.groupId)
        ? 'ablation_selector_off_rank_only'
        : 'outside_fixed_budget',
      rrfRank: group.rrfRank,
      rerankerRank: group.rerankerRank ?? index + 1,
    })),
  };
}

export function researchAblationTraceStage(config: ResearchAblationConfig): Array<{
  id: string;
  rank: number;
  evidence_kind: string;
}> {
  return [{
    id: `ablation:${config.ablation}`,
    rank: 1,
    evidence_kind: config.researchMode ? 'research' : 'production_default',
  }];
}
