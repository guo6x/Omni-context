import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { Database } from '../db/sqlite.js';
import { Relationship, SINGLE_VALUED_REL_TYPES } from '../shared-types.js';
import { GraphRAGExtractor } from './extractor.js';
import { createAuditedAiFetch } from '../security/audited-ai-fetch.js';

const conflictLlmFetch = createAuditedAiFetch({ purpose: 'graphrag.conflict-resolution', kind: 'llm' });
const AUTO_APPLY_CONFIDENCE = 0.8;

const ConflictResponseSchema = z.object({
  resolutions: z.array(z.object({
    oldRelationshipId: z.string().uuid().or(z.string().regex(/^[a-zA-Z0-9_.:-]{1,200}$/)),
    status: z.enum(['superseded', 'conflict', 'independent']),
    confidence: z.number().min(0).max(1),
    reason: z.string().trim().min(1).max(2_000),
  }).strict()).max(100),
}).strict();

export type ConflictResolutionResponse = z.infer<typeof ConflictResponseSchema>;

export function parseConflictResolution(content: string, allowedRelationshipIds: Set<string>): ConflictResolutionResponse {
  const match = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const parsed = ConflictResponseSchema.parse(JSON.parse((match ? match[1] : content).trim()));
  if (parsed.resolutions.some((resolution) => !allowedRelationshipIds.has(resolution.oldRelationshipId))) {
    throw new Error('conflict response referenced an unknown relationship');
  }
  return parsed;
}

interface EntityLabel {
  id: string;
  name: string;
}

interface PlannedResolution {
  old: Relationship;
  status: 'superseded' | 'conflict' | 'independent' | 'review';
  confidence: number;
  reason: string;
  modelOutput?: string;
}

function relationshipEvidence(
  source: EntityLabel | undefined,
  target: EntityLabel | undefined,
  relationship: Relationship,
): Record<string, unknown> {
  return {
    source: source || { id: relationship.source_id, name: 'unknown' },
    target: target || { id: relationship.target_id, name: 'unknown' },
    fact: {
      relationship_id: relationship.id,
      predicate: relationship.type,
      text: relationship.description || '',
      confidence: relationship.weight,
      valid_from: relationship.valid_from,
      valid_until: relationship.valid_until,
      event_time: relationship.event_time,
      provenance: relationship.provenance,
    },
  };
}

async function planSemanticResolutions(
  newRelationship: Relationship,
  existing: Relationship[],
  source: EntityLabel | undefined,
  target: EntityLabel | undefined,
  extractor: GraphRAGExtractor,
): Promise<PlannedResolution[]> {
  if (existing.length === 0) return [];
  const llmConfig = extractor.getLlmConfig();
  if (!llmConfig.apiUrl) {
    return existing.map((old) => ({
      old,
      status: 'review',
      confidence: 0,
      reason: 'conflict model unavailable; human review required',
    }));
  }
  const prompt = `Classify factual relationships. Use the names, fact text, time, and provenance below.
Do not infer from opaque IDs. Return JSON only.

New fact:
${JSON.stringify(relationshipEvidence(source, target, newRelationship))}

Existing facts:
${JSON.stringify(existing.map((relationship) => relationshipEvidence(source, target, relationship)))}

For every existing relationship return:
{"resolutions":[{"oldRelationshipId":"...","status":"superseded|conflict|independent","confidence":0.0,"reason":"evidence-based explanation"}]}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await conflictLlmFetch(`${llmConfig.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(llmConfig.apiKey ? { Authorization: `Bearer ${llmConfig.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: 'system', content: 'You validate factual conflicts and output strict JSON only.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 4_000,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`CONFLICT_LLM_HTTP_${response.status}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('CONFLICT_LLM_EMPTY_RESPONSE');
    const parsed = parseConflictResolution(content, new Set(existing.map((relationship) => relationship.id)));
    return parsed.resolutions.map((resolution) => ({
      old: existing.find((relationship) => relationship.id === resolution.oldRelationshipId)!,
      status: resolution.status,
      confidence: resolution.confidence,
      reason: resolution.reason,
      modelOutput: content,
    }));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return existing.map((old) => ({
      old,
      status: 'review',
      confidence: 0,
      reason: `conflict model validation failed: ${reason}`,
    }));
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Validates conflict decisions before entering a transaction, then atomically writes
 * the new relationship/assertion, closes approved old facts, and records every action.
 */
export async function resolveConflicts(
  newRelationships: Relationship[],
  db: Database,
  extractor: GraphRAGExtractor,
): Promise<Relationship[]> {
  const saved: Relationship[] = [];
  for (const newRelationship of newRelationships || []) {
    const now = new Date().toISOString();
    const labels = await db.all<EntityLabel>(
      'SELECT id, name FROM entities WHERE id IN (?, ?)',
      [newRelationship.source_id, newRelationship.target_id]
    );
    const labelById = new Map(labels.map((label) => [label.id, label]));
    const singleValued = SINGLE_VALUED_REL_TYPES.includes(newRelationship.type)
      ? await db.all<Relationship>(
        `SELECT * FROM relationships
         WHERE source_id = ? AND type = ? AND target_id != ?
           AND (valid_until IS NULL OR valid_until > ?)`,
        [newRelationship.source_id, newRelationship.type, newRelationship.target_id, now]
      )
      : [];
    const samePair = await db.all<Relationship>(
      `SELECT * FROM relationships
       WHERE source_id = ? AND target_id = ? AND id != ?
         AND type != 'conflicts_with'
         AND (valid_until IS NULL OR valid_until > ?)`,
      [newRelationship.source_id, newRelationship.target_id, newRelationship.id, now]
    );
    const deterministicIds = new Set(singleValued.map((relationship) => relationship.id));
    const plans: PlannedResolution[] = singleValued.map((old) => ({
      old,
      status: 'superseded',
      confidence: 1,
      reason: `new current value for single-valued predicate ${newRelationship.type}`,
    }));
    plans.push(...await planSemanticResolutions(
      newRelationship,
      samePair.filter((relationship) => !deterministicIds.has(relationship.id)),
      labelById.get(newRelationship.source_id),
      labelById.get(newRelationship.target_id),
      extractor,
    ));

    await db.withTransaction(async () => {
      const inserted = await db.addRelationship(newRelationship);
      const newAssertionId = `relationship:${inserted.id}`;
      for (const plan of plans) {
        const shouldInvalidate = plan.status === 'superseded' && plan.confidence >= AUTO_APPLY_CONFIDENCE;
        const auditStatus = shouldInvalidate || plan.status === 'independent' ? 'applied' : 'pending';
        if (shouldInvalidate) {
          await db.invalidateRelationship(
            plan.old.id,
            `superseded by ${inserted.id}: ${plan.reason}`,
            inserted.valid_from,
          );
        }
        await db.run(
          `INSERT INTO assertion_conflict_audit (
             id, new_assertion_id, old_assertion_id, operation, confidence, reason,
             evidence, model_output, status, operator, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            newAssertionId,
            `relationship:${plan.old.id}`,
            plan.status === 'superseded' ? 'supersede' : plan.status,
            plan.confidence,
            plan.reason,
            JSON.stringify({
              new: relationshipEvidence(
                labelById.get(newRelationship.source_id),
                labelById.get(newRelationship.target_id),
                newRelationship,
              ),
              old: relationshipEvidence(
                labelById.get(plan.old.source_id),
                labelById.get(plan.old.target_id),
                plan.old,
              ),
            }),
            plan.modelOutput || null,
            auditStatus,
            shouldInvalidate ? 'system:deterministic_or_high_confidence' : 'system:review_queue',
            now,
          ]
        );
      }
      saved.push(inserted);
    });
  }
  return saved;
}


// P0-6: Time-based single-value relationship supersede rules.
// Only auto-supersede when: same subject+predicate, new fact has clear later valid_from/event_time,
// temporal confidence meets threshold, source is trusted, no ambiguity.
const SINGLE_VALUED_PREDICATES = new Set(['works_at', 'lives_in', 'studies_at', 'married_to']);

interface SupersedeCheck {
  shouldSupersede: boolean;
  reason: string;
  action: 'supersede' | 'retain_both' | 'review';
}

export function checkSingleValueSupersede(
  existing: { source_id: string; type: string; target_id: string; valid_from?: string; valid_until?: string; event_time?: string; temporal_confidence?: number; provenance?: Record<string, unknown> },
  incoming: { source_id: string; type: string; target_id: string; valid_from?: string; valid_until?: string; event_time?: string; temporal_confidence?: number; provenance?: Record<string, unknown> },
): SupersedeCheck {
  // Only apply to single-valued predicates
  if (!SINGLE_VALUED_PREDICATES.has(incoming.type)) {
    return { shouldSupersede: false, reason: 'not_single_valued', action: 'retain_both' };
  }

  // Must be same subject and predicate
  if (existing.source_id !== incoming.source_id || existing.type !== incoming.type) {
    return { shouldSupersede: false, reason: 'different_subject_or_predicate', action: 'retain_both' };
  }

  const existingTime = existing.event_time || existing.valid_from;
  const incomingTime = incoming.event_time || incoming.valid_from;

  // New fact with no time cannot supersede old fact with time
  if (!incomingTime && existingTime) {
    return { shouldSupersede: false, reason: 'incoming_no_time_existing_has_time', action: 'review' };
  }

  // New fact earlier than old fact cannot supersede
  if (existingTime && incomingTime && new Date(incomingTime) <= new Date(existingTime)) {
    return { shouldSupersede: false, reason: 'incoming_not_later', action: 'review' };
  }

  // Check temporal confidence
  const confidence = incoming.temporal_confidence ?? 0.5;
  if (confidence < 0.7) {
    return { shouldSupersede: false, reason: 'low_temporal_confidence', action: 'review' };
  }

  // Check provenance - historical imports don't auto-supersede
  const prov = incoming.provenance as Record<string, unknown> | undefined;
  if (prov && (prov.import_batch_id || prov.source === 'history_import')) {
    return { shouldSupersede: false, reason: 'historical_import', action: 'review' };
  }

  return { shouldSupersede: true, reason: 'newer_fact_same_slot', action: 'supersede' };
}
