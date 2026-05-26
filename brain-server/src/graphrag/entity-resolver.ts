import { Database } from '../db/sqlite.js';
import { Entity, Relationship, EntityType } from '../shared-types.js';
import { cosineSimilarity, decodeEmbedding } from '../utils/math.js';

export interface EmbeddingService {
  embed(text: string): Promise<{ embedding: number[] }>;
}

export interface ResolutionResult {
  entitiesToCreate: Entity[];
  entitiesToUpdate: {
    id: string;
    name: string;
    description?: string;
    tags?: string[];
    embedding?: number[];
    metadata?: any;
    created_at?: string;
    access_count?: number;
  }[];
  relationshipsToCreate: Relationship[];
  idMap: Record<string, string>;
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * [核心壁垒] 实体级/事实级消解算法 (Entity Resolution & Dedup)
 * 
 * 功能：
 * 1. 批内消解：对输入批次内的临时实体按 normalized name 进行信息合并与折叠。
 * 2. 补齐向量：对剩余的唯一批次内实体，并发生成 embedding 向量。
 * 3. 库内消解：与库内同类实体进行相似度比对。
 *    - 名字完全相同 / normalize 相同 -> 视为同一实体；
 *    - 余弦相似度 > 0.92 且 type 相同 -> 视为同一实体（去重合并）；
 *    - 否则为新实体。
 * 4. 别名轨迹保留与关系重定向：
 *    - 若被合并，将关系源/宿 ID 重定向至 canonical 实体 ID。
 *    - 被合并的实体依然插入数据库中（便于追溯），但标记 metadata.merged_into = canonical_id，且 tags 包含 'merged-alias'。
 *    - 合并时保留最早的 created_at，累加 access_count，合并 tags 与 metadata。
 */
export async function resolveEntities(
  entities: Entity[],
  relationships: Relationship[],
  db: Database,
  embeddingService?: EmbeddingService
): Promise<ResolutionResult> {
  const localIdMap: Record<string, string> = {};
  const keyToEntity = new Map<string, Entity>();

  // 1. 批内消解与信息折叠
  for (const entity of entities) {
    const normName = normalizeName(entity.name);
    const key = `${normName}:::${entity.type}`;

    if (!keyToEntity.has(key)) {
      const clone = {
        ...entity,
        tags: entity.tags ? [...entity.tags] : [],
      };
      keyToEntity.set(key, clone);
      localIdMap[entity.id] = entity.id;
    } else {
      const existing = keyToEntity.get(key)!;
      localIdMap[entity.id] = existing.id;

      if (!existing.description && entity.description) {
        existing.description = entity.description;
      } else if (existing.description && entity.description && entity.description.length > existing.description.length) {
        existing.description = entity.description;
      }

      if (entity.tags) {
        const mergedTags = new Set([...existing.tags, ...entity.tags]);
        existing.tags = Array.from(mergedTags);
      }

      if (entity.metadata) {
        existing.metadata = { ...existing.metadata, ...entity.metadata };
      }
    }
  }

  const uniqueBatchEntities = Array.from(keyToEntity.values());

  // 2. 自动生成批内实体的向量数据 (Embedding)
  if (embeddingService) {
    await Promise.all(
      uniqueBatchEntities.map(async (entity) => {
        if (!entity.embedding) {
          try {
            const embeddingText = `${entity.name}: ${entity.description || ''}`;
            const embRes = await embeddingService.embed(embeddingText);
            entity.embedding = embRes.embedding;
          } catch (e) {
            console.warn(`[resolveEntities] Generating embedding failed for entity "${entity.name}":`, e);
          }
        }
      })
    );
  }

  interface Candidate {
    id: string;
    name: string;
    type: string;
    description: string;
    tags: string[];
    metadata: any;
    embedding?: number[];
    created_at: string;
    access_count: number;
    isNew?: boolean;
  }

  // 3. 按类型预加载库内候选实体，减少数据库交互
  const typeToCandidates = new Map<string, Candidate[]>();
  const neededTypes = Array.from(new Set(uniqueBatchEntities.map(e => e.type)));

  for (const type of neededTypes) {
    const rows = await db.all<any>(
      `SELECT id, name, type, description, tags, metadata, embedding, created_at, access_count FROM entities WHERE type = ?`,
      [type]
    );

    const candidatesList: Candidate[] = rows.map(row => {
      let tags: string[] = [];
      if (typeof row.tags === 'string') {
        try { tags = JSON.parse(row.tags) || []; } catch {}
      } else if (Array.isArray(row.tags)) {
        tags = row.tags;
      }

      let metadata: any = {};
      if (typeof row.metadata === 'string') {
        try { metadata = JSON.parse(row.metadata) || {}; } catch {}
      } else if (row.metadata) {
        metadata = row.metadata;
      }

      let embedding: number[] | undefined;
      if (row.embedding) {
        try {
          embedding = decodeEmbedding(row.embedding);
        } catch {}
      }

      return {
        id: row.id,
        name: row.name,
        type: row.type,
        description: row.description || '',
        tags,
        metadata,
        embedding,
        created_at: row.created_at,
        access_count: row.access_count || 0
      };
    });

    typeToCandidates.set(type, candidatesList);
  }

  const aliasEntitiesToCreate: Entity[] = [];
  const dbEntityUpdates = new Map<string, any>();
  const finalIdMap: Record<string, string> = {};

  // 4. 库内消解循环
  for (const entity of uniqueBatchEntities) {
    const normNew = normalizeName(entity.name);
    const candidates = typeToCandidates.get(entity.type) || [];

    // 获取当前候选对象的规范/canonical对象 (顺着 merged_into 链条查找)
    const candidatesMap = new Map<string, Candidate>(candidates.map(c => [c.id, c]));
    const getCanonical = (cand: Candidate): Candidate => {
      let current = cand;
      const seenIds = new Set<string>();
      while (current) {
        if (seenIds.has(current.id)) break;
        seenIds.add(current.id);
        if (current.metadata && current.metadata.merged_into) {
          const next = candidatesMap.get(current.metadata.merged_into);
          if (next) {
            current = next;
          } else {
            break;
          }
        } else {
          break;
        }
      }
      return current;
    };

    let matchedCandidate: Candidate | null = null;
    let bestSimilarity = 0.92;

    for (const cand of candidates) {
      if (normalizeName(cand.name) === normNew) {
        matchedCandidate = getCanonical(cand);
        break;
      }

      if (entity.embedding && cand.embedding) {
        const sim = cosineSimilarity(entity.embedding, cand.embedding);
        if (sim > bestSimilarity) {
          bestSimilarity = sim;
          matchedCandidate = getCanonical(cand);
        }
      }
    }

    if (matchedCandidate) {
      finalIdMap[entity.id] = matchedCandidate.id;

      // 更新规范实体的属性
      if (entity.description && (!matchedCandidate.description || entity.description.length > matchedCandidate.description.length)) {
        matchedCandidate.description = entity.description;
      }
      matchedCandidate.tags = Array.from(new Set([...matchedCandidate.tags, ...(entity.tags || [])]));
      matchedCandidate.metadata = { ...matchedCandidate.metadata, ...(entity.metadata || {}) };

      const entityCreatedAt = entity.created_at || new Date().toISOString();
      if (entityCreatedAt < matchedCandidate.created_at) {
        matchedCandidate.created_at = entityCreatedAt;
      }
      matchedCandidate.access_count += (entity.access_count || 0);
      if (!matchedCandidate.embedding && entity.embedding) {
        matchedCandidate.embedding = entity.embedding;
      }

      // 如果匹配的是已存在于数据库的候选实体，将其记入待更新Map
      if (!matchedCandidate.isNew) {
        dbEntityUpdates.set(matchedCandidate.id, {
          id: matchedCandidate.id,
          name: matchedCandidate.name,
          description: matchedCandidate.description,
          tags: matchedCandidate.tags,
          embedding: matchedCandidate.embedding,
          metadata: matchedCandidate.metadata,
          created_at: matchedCandidate.created_at,
          access_count: matchedCandidate.access_count
        });
      }

      // 别名实体作为一个只读别名轨迹存留，插入 entitiesToCreate
      const aliasEntity: Entity = {
        ...entity,
        metadata: {
          ...(entity.metadata || {}),
          merged_into: matchedCandidate.id
        },
        tags: Array.from(new Set([...(entity.tags || []), 'merged-alias']))
      };
      aliasEntitiesToCreate.push(aliasEntity);

    } else {
      // 没有任何匹配：作为新的候选实体
      finalIdMap[entity.id] = entity.id;

      const newCand: Candidate = {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        description: entity.description || '',
        tags: entity.tags ? [...entity.tags] : [],
        metadata: entity.metadata ? { ...entity.metadata } : {},
        embedding: entity.embedding,
        created_at: entity.created_at || new Date().toISOString(),
        access_count: entity.access_count || 0,
        isNew: true
      };

      candidates.push(newCand);
    }
  }

  // 收集所有标记为 isNew 的候选实体
  const newEntitiesToCreate: Entity[] = [];
  for (const [_, candidatesList] of typeToCandidates) {
    for (const cand of candidatesList) {
      if (cand.isNew) {
        newEntitiesToCreate.push({
          id: cand.id,
          name: cand.name,
          type: cand.type as EntityType,
          description: cand.description,
          tags: cand.tags,
          embedding: cand.embedding,
          metadata: cand.metadata,
          created_at: cand.created_at,
          updated_at: new Date().toISOString(),
          last_accessed: new Date().toISOString(),
          access_count: cand.access_count
        });
      }
    }
  }

  const entitiesToCreate = [...newEntitiesToCreate, ...aliasEntitiesToCreate];
  const entitiesToUpdate = Array.from(dbEntityUpdates.values());

  const resolvedIdMap: Record<string, string> = {};
  for (const origId of Object.keys(localIdMap)) {
    const repId = localIdMap[origId];
    resolvedIdMap[origId] = finalIdMap[repId] || repId;
  }

  // 5. 关系重映射与去重
  const relationshipsToCreate: Relationship[] = [];
  const seenRelationships = new Set<string>();

  for (const rel of relationships) {
    const sourceId = resolvedIdMap[rel.source_id] || rel.source_id;
    const targetId = resolvedIdMap[rel.target_id] || rel.target_id;

    if (sourceId === targetId) {
      continue;
    }

    const relKey = `${sourceId}-${rel.type}-${targetId}`;
    if (!seenRelationships.has(relKey)) {
      seenRelationships.add(relKey);
      relationshipsToCreate.push({
        ...rel,
        source_id: sourceId,
        target_id: targetId,
      });
    }
  }

  return {
    entitiesToCreate,
    entitiesToUpdate,
    relationshipsToCreate,
    idMap: resolvedIdMap,
  };
}
