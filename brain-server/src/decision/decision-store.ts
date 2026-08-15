import { randomUUID } from 'node:crypto';
import type { Database } from '../db/sqlite.js';
import type { Entity } from '../shared-types.js';
import type { z } from 'zod';
import type { RecordDecisionOutcomeSchema, SaveDecisionSchema } from '../mcp-tools.js';

export type SaveDecisionInput = z.infer<typeof SaveDecisionSchema>;
export type DecisionOutcomeInput = z.infer<typeof RecordDecisionOutcomeSchema>;

const LINEAGE_TYPES = new Set(['continues', 'revises', 'supersedes', 'reverses', 'invalidates']);
const EVIDENCE_TYPES = new Set(['decision_referenced', 'supported_by', 'opposed_by']);

export function buildDecisionMetadata(input: SaveDecisionInput): Record<string, unknown> {
  return {
    situation: input.situation,
    decision_question: input.decision_question ?? input.situation,
    goals: input.goals,
    selected_option: input.selected_option ?? input.conclusion,
    conclusion: input.conclusion,
    alternatives: input.alternatives,
    hard_constraints: input.hard_constraints,
    soft_preferences: input.soft_preferences,
    evaluation_criteria: input.evaluation_criteria,
    supporting_evidence_ids: input.supporting_evidence_ids,
    opposing_evidence_ids: input.opposing_evidence_ids,
    principle_ids: input.principle_ids,
    cited_entity_ids: input.cited_entity_ids,
    // Task 9: Per-evidence metadata with source_span, role, is_current.
    evidence: input.evidence,
    assumptions: input.assumptions,
    uncertainties: input.uncertainties,
    expected_outcomes: input.expected_outcomes,
    risks: input.risks,
    confidence: input.confidence,
    revisit_at: input.revisit_at,
    previous_decision_id: input.previous_decision_id,
    supersedes_decision_id: input.supersedes_decision_id,
    lineage_relation: input.lineage_relation,
    model_config_snapshot: input.model_config_snapshot,
    provenance: input.provenance,
    outcomes: [],
  };
}

function compactDecision(entity: Entity, depth = 0): Record<string, unknown> {
  return {
    id: entity.id,
    name: entity.name,
    conclusion: entity.metadata?.conclusion ?? entity.description ?? '',
    situation: entity.metadata?.situation ?? '',
    timestamp: entity.created_at,
    valid_from: entity.valid_from,
    valid_until: entity.valid_until,
    confidence: entity.metadata?.confidence ?? 'medium',
    revisit_at: entity.metadata?.revisit_at,
    outcomes: Array.isArray(entity.metadata?.outcomes) ? entity.metadata.outcomes : [],
    depth,
  };
}

export async function getRecursiveDecisionLineage(db: Database, decisionId: string) {
  const root = await db.getEntity(decisionId);
  if (!root || root.type !== 'decision') return null;

  const chain: Array<Record<string, unknown>> = [];
  const sources: Array<Record<string, unknown>> = [];
  const seenDecisions = new Set([decisionId]);
  const seenSources = new Set<string>();
  const queue: Array<{ entity: Entity; depth: number }> = [{ entity: root, depth: 0 }];

  while (queue.length > 0 && seenDecisions.size <= 100) {
    const current = queue.shift();
    if (!current) break;
    const relationships = await db.getRelationshipsForEntity(current.entity.id, true);
    for (const relationship of relationships) {
      const outgoing = relationship.source_id === current.entity.id;
      const otherId = outgoing ? relationship.target_id : relationship.source_id;
      const other = await db.getEntity(otherId);
      if (!other) continue;

      if (EVIDENCE_TYPES.has(relationship.type) && !seenSources.has(`${current.entity.id}:${other.id}:${relationship.type}`)) {
        seenSources.add(`${current.entity.id}:${other.id}:${relationship.type}`);
        sources.push({
          decision_id: current.entity.id,
          entity_id: other.id,
          entity_name: other.name,
          entity_type: other.type,
          relationship: relationship.type,
          direction: outgoing ? 'outgoing' : 'incoming',
        });
      }
      if (other.type === 'decision' && LINEAGE_TYPES.has(relationship.type) && !seenDecisions.has(other.id)) {
        seenDecisions.add(other.id);
        const nextDepth = current.depth + 1;
        chain.push({
          ...compactDecision(other, nextDepth),
          relationship: relationship.type,
          direction: outgoing ? 'outgoing' : 'incoming',
          linked_from: current.entity.id,
          change_reason: relationship.description ?? null,
          invalidation_reason: relationship.invalidation_reason ?? null,
        });
        queue.push({ entity: other, depth: nextDepth });
      }
    }
  }
  return { current: compactDecision(root), sources, chain, recursive: true };
}

/**
 * CP8 bypass closure CP8A-013: this is a FREE-TEXT DECISION JOURNAL, not an
 * execution outcome authority. The recorded entries are caller/LLM-authored
 * narrative and must NEVER be read as verified outcomes. Every journaled
 * record is stamped with the machine-readable markers
 * `outcome_authority: "journal"` and `verified: false` so a downstream
 * consumer can never silently mistake it for a CP8 verified outcome. The
 * CP8 outcome layer (brain-server/src/outcome/**) has no import of this
 * module and accepts only trusted receipt/observation ids.
 */
export async function recordDecisionOutcome(db: Database, input: DecisionOutcomeInput) {
  const decision = await db.getEntity(input.decision_id);
  if (!decision || decision.type !== 'decision') return null;
  const outcomeId = randomUUID();
  const outcome = {
    outcome_id: outcomeId,
    actual_outcome: input.actual_outcome,
    outcome_timestamp: input.outcome_timestamp,
    outcome_score: input.outcome_score,
    assumption_failures: input.assumption_failures,
    unexpected_factors: input.unexpected_factors,
    lessons_learned: input.lessons_learned,
    confidence_calibration: input.confidence_calibration,
    follow_up_actions: input.follow_up_actions,
    provenance: input.provenance,
    recorded_at: new Date().toISOString(),
    // CP8 closure markers: journal-only, never verified authority.
    outcome_authority: 'journal',
    verified: false,
  };
  const previousOutcomes = Array.isArray(decision.metadata?.outcomes) ? decision.metadata.outcomes : [];
  await db.updateEntity(decision.id, {
    metadata: { ...decision.metadata, outcomes: [...previousOutcomes, outcome] },
  });
  const outcomeEntity = await db.addEntity({
    name: `Decision outcome: ${input.actual_outcome.slice(0, 80)}`,
    type: 'event',
    description: input.actual_outcome,
    tags: ['decision-outcome'],
    event_time: input.outcome_timestamp,
    observed_at: input.outcome_timestamp,
    valid_from: input.outcome_timestamp,
    metadata: outcome,
  });
  await db.addRelationship({
    source_id: outcomeEntity.id,
    target_id: decision.id,
    type: 'outcome_of',
    description: 'Observed result of the decision; does not automatically modify principles',
    weight: 1,
    event_time: input.outcome_timestamp,
    observed_at: input.outcome_timestamp,
    valid_from: input.outcome_timestamp,
    provenance: input.provenance,
  });
  return { decision_id: decision.id, outcome_entity_id: outcomeEntity.id, outcome };
}
