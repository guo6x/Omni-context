import { v4 as uuidv4 } from 'uuid';
import { Database } from '../db/sqlite.js';
import { Entity, Relationship, EntityType } from '../shared-types.js';
import { cosineSimilarity, decodeEmbedding } from '../utils/math.js';

export interface EmbeddingService {
  embed(text: string): Promise<{ embedding: number[] }>;
}

export interface MergeCandidate {
  id: string;
  canonicalId: string;
  candidateEntityId: string;
  candidateName: string;
  candidateType: EntityType;
  similarity?: number;
  reason: string;
}

export interface ResolutionResult {
  entitiesToCreate: Entity[];
  entitiesToUpdate: Array<{
    id: string;
    name: string;
    description?: string;
    tags?: string[];
    embedding?: number[];
    metadata?: Record<string, unknown>;
    created_at?: string;
    access_count?: number;
  }>;
  relationshipsToCreate: Relationship[];
  idMap: Record<string, string>;
  mergeCandidates: MergeCandidate[];
}

const AUTO_SEMANTIC_TYPES = new Set<EntityType>(['tool', 'architecture_pattern']);
const NEVER_AUTO_MERGE_TYPES = new Set<EntityType>(['decision', 'preference', 'goal', 'event', 'task', 'question', 'person', 'project']);
const CONTEXT_GATED_TYPES = new Set<EntityType>(['person', 'project', 'task', 'question']);
const MAX_CANDIDATES = 20;
const KNN_RECALL = 80;
const EMBEDDING_CONCURRENCY = 4;
const REVIEW_SIMILARITY = 0.88;
const AUTO_THRESHOLDS: Partial<Record<EntityType, number>> = {
  tool: 0.95,
  architecture_pattern: 0.96,
};

interface Candidate {
  id: string;
  name: string;
  type: EntityType;
  description: string;
  tags: string[];
  metadata: Record<string, unknown>;
  embedding?: number[];
  created_at: string;
  access_count: number;
  isNew?: boolean;
}

export function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return asRecord(JSON.parse(value)); } catch { return {}; }
  }
  return asRecord(value);
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') {
    try { return parseStringArray(JSON.parse(value)); } catch { return []; }
  }
  return [];
}

function mergeMetadata(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    const current = merged[key];
    if (current === undefined || current === null) {
      merged[key] = value;
    } else if (Array.isArray(current) && Array.isArray(value)) {
      const seen = new Set<string>();
      merged[key] = [...current, ...value].filter((item) => {
        const encoded = JSON.stringify(item);
        if (seen.has(encoded)) return false;
        seen.add(encoded);
        return true;
      });
    } else if (typeof current === 'object' && current && typeof value === 'object' && value && !Array.isArray(value)) {
      merged[key] = mergeMetadata(asRecord(current), asRecord(value));
    } else if (current !== value) {
      const conflicts = asRecord(merged._field_conflicts);
      const values = Array.isArray(conflicts[key]) ? conflicts[key] as unknown[] : [current];
      if (!values.some((item) => JSON.stringify(item) === JSON.stringify(value))) values.push(value);
      merged._field_conflicts = { ...conflicts, [key]: values };
    }
  }
  return merged;
}

function contextIdentity(entity: Pick<Entity, 'metadata' | 'observed_at' | 'event_time' | 'valid_from' | 'valid_until'>): {
  subject?: string;
  document?: string;
  source?: string;
  start?: string;
  end?: string;
} {
  const metadata = asRecord(entity.metadata);
  const provenance = asRecord(metadata.provenance);
  const chunks = Array.isArray(metadata.extraction_chunks) ? metadata.extraction_chunks : [];
  const firstChunk = asRecord(chunks[0]);
  return {
    subject: typeof metadata.subject_id === 'string' ? metadata.subject_id : undefined,
    document: typeof firstChunk.document_id === 'string'
      ? firstChunk.document_id
      : typeof provenance.document_id === 'string' ? provenance.document_id : undefined,
    source: typeof firstChunk.source === 'string'
      ? firstChunk.source
      : typeof provenance.source === 'string' ? provenance.source : undefined,
    start: entity.valid_from || entity.event_time || entity.observed_at,
    end: entity.valid_until,
  };
}

function temporalCompatible(a: ReturnType<typeof contextIdentity>, b: ReturnType<typeof contextIdentity>): boolean {
  if (!a.start || !b.start) return true;
  const aStart = Date.parse(a.start);
  const bStart = Date.parse(b.start);
  const aEnd = a.end ? Date.parse(a.end) : Number.POSITIVE_INFINITY;
  const bEnd = b.end ? Date.parse(b.end) : Number.POSITIVE_INFINITY;
  if (![aStart, bStart, aEnd, bEnd].every((value) => Number.isFinite(value) || value === Number.POSITIVE_INFINITY)) return false;
  return aStart <= bEnd && bStart <= aEnd;
}

function contextsCompatible(a: Entity | Candidate, b: Entity | Candidate): boolean {
  const left = contextIdentity(a);
  const right = contextIdentity(b);
  if (left.subject && right.subject) return left.subject === right.subject && temporalCompatible(left, right);
  if (left.document && right.document) return left.document === right.document && temporalCompatible(left, right);
  if (left.source && right.source) return left.source === right.source && temporalCompatible(left, right);
  return false;
}

async function embedBounded(entities: Entity[], embeddingService?: EmbeddingService): Promise<void> {
  if (!embeddingService) return;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(EMBEDDING_CONCURRENCY, entities.length) }, async () => {
    while (cursor < entities.length) {
      const index = cursor++;
      const entity = entities[index];
      if (entity.embedding) continue;
      try {
        entity.embedding = (await embeddingService.embed(`${entity.name}: ${entity.description || ''}`)).embedding;
      } catch (error) {
        console.warn(`[resolveEntities] Generating embedding failed for entity "${entity.name}":`, error);
      }
    }
  });
  await Promise.all(workers);
}

async function loadCandidates(db: Database, entity: Entity): Promise<Candidate[]> {
  const normalized = normalizeName(entity.name);
  const exact = await db.all<Record<string, unknown>>(
    `SELECT id, name, type, description, tags, metadata, embedding, created_at, access_count
     FROM entities
     WHERE type = ? AND lower(trim(name)) = ?
       AND json_extract(metadata, '$.merged_into') IS NULL
     LIMIT ?`,
    [entity.type, normalized, MAX_CANDIDATES]
  );
  const rows = new Map<string, Record<string, unknown>>(exact.map((row) => [String(row.id), row]));
  if (entity.embedding && rows.size < MAX_CANDIDATES) {
    const vector = await db.vectorSearch(entity.embedding, KNN_RECALL);
    const ids = vector
      .filter((candidate) => candidate.type === entity.type && !rows.has(candidate.id))
      .slice(0, MAX_CANDIDATES - rows.size)
      .map((candidate) => candidate.id);
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const vectorRows = await db.all<Record<string, unknown>>(
        `SELECT id, name, type, description, tags, metadata, embedding, created_at, access_count
         FROM entities WHERE id IN (${placeholders})`,
        ids
      );
      for (const row of vectorRows) rows.set(String(row.id), row);
    }
  }
  return [...rows.values()].slice(0, MAX_CANDIDATES).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    type: row.type as EntityType,
    description: typeof row.description === 'string' ? row.description : '',
    tags: parseStringArray(row.tags),
    metadata: parseJsonRecord(row.metadata),
    embedding: row.embedding ? decodeEmbedding(row.embedding as Buffer) : undefined,
    created_at: String(row.created_at),
    access_count: typeof row.access_count === 'number' ? row.access_count : 0,
  }));
}

async function queueCandidate(
  db: Database,
  entity: Entity,
  canonical: Candidate,
  similarity: number | undefined,
  reason: string,
): Promise<MergeCandidate> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO entity_merge_candidates (
       id, canonical_id, candidate_entity_id, candidate_name, candidate_type,
       similarity, reason, context, status, operator, created_at
     ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'pending', NULL, ?)`,
    [id, canonical.id, entity.name, entity.type, similarity ?? null, reason, JSON.stringify(contextIdentity(entity)), now]
  );
  return {
    id,
    canonicalId: canonical.id,
    candidateEntityId: entity.id,
    candidateName: entity.name,
    candidateType: entity.type,
    similarity,
    reason,
  };
}

export async function resolveEntities(
  entities: Entity[],
  relationships: Relationship[],
  db: Database,
  embeddingService?: EmbeddingService,
): Promise<ResolutionResult> {
  const localIdMap: Record<string, string> = {};
  const batch: Entity[] = [];
  const batchByKey = new Map<string, Entity>();

  for (const entity of entities) {
    const key = `${normalizeName(entity.name)}:::${entity.type}`;
    const existing = batchByKey.get(key);
    const mayFold = existing
      && !NEVER_AUTO_MERGE_TYPES.has(entity.type)
      && (!CONTEXT_GATED_TYPES.has(entity.type) || contextsCompatible(existing, entity));
    if (!existing || !mayFold) {
      const clone: Entity = { ...entity, tags: entity.tags ? [...entity.tags] : [] };
      batch.push(clone);
      if (!existing) batchByKey.set(key, clone);
      localIdMap[entity.id] = clone.id;
      continue;
    }
    localIdMap[entity.id] = existing.id;
    if ((entity.description || '').length > (existing.description || '').length) existing.description = entity.description;
    existing.tags = Array.from(new Set([...(existing.tags || []), ...(entity.tags || [])]));
    existing.metadata = mergeMetadata(asRecord(existing.metadata), asRecord(entity.metadata));
  }

  await embedBounded(batch, embeddingService);

  const newByType = new Map<EntityType, Candidate[]>();
  const aliases: Entity[] = [];
  const updates = new Map<string, ResolutionResult['entitiesToUpdate'][number]>();
  const finalIdMap: Record<string, string> = {};
  const mergeCandidates: MergeCandidate[] = [];

  for (const entity of batch) {
    const candidates = [
      ...(await loadCandidates(db, entity)),
      ...(newByType.get(entity.type) || []),
    ].slice(0, MAX_CANDIDATES);
    const normalized = normalizeName(entity.name);
    const exact = candidates.find((candidate) => normalizeName(candidate.name) === normalized);
    let matched: Candidate | undefined;
    let mergeReason = '';
    let mergeSimilarity: number | undefined;

    if (exact) {
      if (NEVER_AUTO_MERGE_TYPES.has(entity.type)) {
        if (!exact.isNew) mergeCandidates.push(await queueCandidate(db, entity, exact, 1, 'exact_name_manual_only'));
      } else if (CONTEXT_GATED_TYPES.has(entity.type) && !contextsCompatible(entity, exact)) {
        if (!exact.isNew) mergeCandidates.push(await queueCandidate(db, entity, exact, 1, 'exact_name_context_mismatch'));
      } else {
        matched = exact;
        mergeReason = 'normalized_name_exact';
        mergeSimilarity = 1;
      }
    }

    if (!matched && !exact && entity.embedding) {
      let best: Candidate | undefined;
      let bestSimilarity = -1;
      for (const candidate of candidates) {
        if (!candidate.embedding) continue;
        const similarity = cosineSimilarity(entity.embedding, candidate.embedding);
        if (similarity > bestSimilarity) {
          best = candidate;
          bestSimilarity = similarity;
        }
      }
      const threshold = AUTO_THRESHOLDS[entity.type];
      if (best && AUTO_SEMANTIC_TYPES.has(entity.type) && threshold !== undefined && bestSimilarity >= threshold) {
        matched = best;
        mergeReason = 'type_specific_semantic_match';
        mergeSimilarity = bestSimilarity;
      } else if (best && bestSimilarity >= REVIEW_SIMILARITY && !best.isNew) {
        mergeCandidates.push(await queueCandidate(db, entity, best, bestSimilarity, 'semantic_review_required'));
      }
    }

    if (matched) {
      finalIdMap[entity.id] = matched.id;
      if ((entity.description || '').length > matched.description.length) matched.description = entity.description || '';
      matched.tags = Array.from(new Set([...matched.tags, ...(entity.tags || [])]));
      matched.metadata = mergeMetadata(matched.metadata, asRecord(entity.metadata));
      const entityCreatedAt = entity.created_at || new Date().toISOString();
      if (entityCreatedAt < matched.created_at) matched.created_at = entityCreatedAt;
      matched.access_count += entity.access_count || 0;
      if (!matched.embedding && entity.embedding) matched.embedding = entity.embedding;
      if (!matched.isNew) {
        updates.set(matched.id, {
          id: matched.id,
          name: matched.name,
          description: matched.description,
          tags: matched.tags,
          embedding: matched.embedding,
          metadata: matched.metadata,
          created_at: matched.created_at,
          access_count: matched.access_count,
        });
      }
      const mergedAt = new Date().toISOString();
      aliases.push({
        ...entity,
        metadata: {
          ...asRecord(entity.metadata),
          merged_into: matched.id,
          merge_reason: mergeReason,
          similarity: mergeSimilarity,
          merge_operator: 'system',
          merged_at: mergedAt,
        },
        tags: Array.from(new Set([...(entity.tags || []), 'merged-alias'])),
      });
    } else {
      finalIdMap[entity.id] = entity.id;
      const candidate: Candidate = {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        description: entity.description || '',
        tags: entity.tags ? [...entity.tags] : [],
        metadata: asRecord(entity.metadata),
        embedding: entity.embedding,
        created_at: entity.created_at || new Date().toISOString(),
        access_count: entity.access_count || 0,
        isNew: true,
      };
      const list = newByType.get(entity.type) || [];
      list.push(candidate);
      newByType.set(entity.type, list);
    }
  }

  const newEntities = [...newByType.values()].flat().map((candidate): Entity => ({
    id: candidate.id,
    name: candidate.name,
    type: candidate.type,
    description: candidate.description,
    tags: candidate.tags,
    embedding: candidate.embedding,
    metadata: candidate.metadata,
    created_at: candidate.created_at,
    updated_at: new Date().toISOString(),
    last_accessed: new Date().toISOString(),
    access_count: candidate.access_count,
  }));

  const resolvedIdMap: Record<string, string> = {};
  for (const [originalId, representativeId] of Object.entries(localIdMap)) {
    resolvedIdMap[originalId] = finalIdMap[representativeId] || representativeId;
  }
  const relationshipsToCreate: Relationship[] = [];
  const seenRelationships = new Set<string>();
  for (const relationship of relationships) {
    const sourceId = resolvedIdMap[relationship.source_id] || relationship.source_id;
    const targetId = resolvedIdMap[relationship.target_id] || relationship.target_id;
    if (sourceId === targetId) continue;
    const key = `${sourceId}:${relationship.type}:${targetId}`;
    if (seenRelationships.has(key)) continue;
    seenRelationships.add(key);
    relationshipsToCreate.push({ ...relationship, source_id: sourceId, target_id: targetId });
  }

  return {
    entitiesToCreate: [...newEntities, ...aliases],
    entitiesToUpdate: [...updates.values()],
    relationshipsToCreate,
    idMap: resolvedIdMap,
    mergeCandidates,
  };
}


// P0-11: Merge review queue operations
export interface MergeAction {
  action: 'confirm' | 'reject' | 'revert';
  mergeCandidateId: string;
  operator?: string;
}

export async function confirmMerge(db: Database, mergeId: string): Promise<void> {
  await db.withTransaction(async () => {
    const row = await db.get<any>(
      "SELECT * FROM entity_merge_candidates WHERE id = ? AND status = 'pending'",
      [mergeId]
    );
    if (!row) throw new Error("Merge candidate not found or already processed");

    const canonicalId = row.canonical_id;
    const candidateId = row.candidate_entity_id;
    const now = new Date().toISOString();

    // Create alias with merged_into pointing to canonical
    await db.run(
      "UPDATE entities SET metadata = json_set(COALESCE(metadata, '{}'), '$.merged_into', ?, '$.merge_reason', 'manual_confirm', '$.merged_at', ?) WHERE id = ?",
      [canonicalId, now, candidateId]
    );

    // Update merge candidate status
    await db.run(
      "UPDATE entity_merge_candidates SET status = 'confirmed', reviewed_at = ? WHERE id = ?",
      [now, mergeId]
    );

    // Write audit log
    await db.run(
      "INSERT INTO entity_merge_audit (id, canonical_id, alias_id, action, operator, created_at) VALUES (?, ?, ?, 'confirm', 'system', ?)",
      [candidateId + '_audit_' + Date.now(), canonicalId, candidateId, now]
    );
  });
}

export async function rejectMerge(db: Database, mergeId: string): Promise<void> {
  await db.withTransaction(async () => {
    const row = await db.get<any>(
      "SELECT * FROM entity_merge_candidates WHERE id = ? AND status = 'pending'",
      [mergeId]
    );
    if (!row) throw new Error("Merge candidate not found or already processed");

    const now = new Date().toISOString();
    await db.run(
      "UPDATE entity_merge_candidates SET status = 'rejected', reviewed_at = ? WHERE id = ?",
      [now, mergeId]
    );
  });
}

export async function revertMerge(db: Database, mergeId: string): Promise<void> {
  await db.withTransaction(async () => {
    const audit = await db.get<any>(
      "SELECT * FROM entity_merge_audit WHERE id LIKE ? AND reverted_at IS NULL LIMIT 1",
      [mergeId + '%']
    );
    if (!audit) throw new Error("Merge audit record not found");

    const now = new Date().toISOString();

    // Remove merged_into from alias entity
    await db.run(
      "UPDATE entities SET metadata = json_remove(COALESCE(metadata, '{}'), '$.merged_into', '$.merge_reason', '$.merged_at') WHERE id = ?",
      [audit.alias_id]
    );

    // Mark merge candidate as reverted
    await db.run(
      "UPDATE entity_merge_candidates SET status = 'reverted', reviewed_at = ? WHERE canonical_id = ? AND status = 'confirmed'",
      [now, audit.canonical_id]
    );

    // Mark audit as reverted
    await db.run(
      "UPDATE entity_merge_audit SET reverted_at = ? WHERE id = ?",
      [now, audit.id]
    );
  });
}
