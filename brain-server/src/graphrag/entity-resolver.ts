import { Database } from '../db/sqlite.js';
import { Entity, Relationship } from '../shared-types.js';

export interface ResolutionResult {
  entitiesToCreate: Entity[];
  entitiesToUpdate: {
    id: string;
    name: string;
    description?: string;
    tags?: string[];
    embedding?: number[];
  }[];
  relationshipsToCreate: Relationship[];
  idMap: Record<string, string>;
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function resolveEntities(
  entities: Entity[],
  relationships: Relationship[],
  db: Database
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

  const entitiesToCreate: Entity[] = [];
  const entitiesToUpdate: { id: string; name: string; description?: string; tags?: string[] }[] = [];
  const finalIdMap: Record<string, string> = {};

  // 2. 库内匹配与消解
  for (const entity of uniqueBatchEntities) {
    const normNew = normalizeName(entity.name);
    const pattern = `%${normNew.replace(/ /g, '%')}%`;
    const candidates = await db.all<any>(
      `SELECT id, name, type, description, tags, metadata FROM entities WHERE type = ? AND LOWER(name) LIKE ?`,
      [entity.type, pattern]
    );

    let matchedDbEntity: any = null;
    for (const cand of candidates) {
      if (normalizeName(cand.name) === normNew) {
        matchedDbEntity = cand;
        break;
      }
    }

    if (matchedDbEntity) {
      finalIdMap[entity.id] = matchedDbEntity.id;

      const dbTags: string[] = typeof matchedDbEntity.tags === 'string'
        ? JSON.parse(matchedDbEntity.tags)
        : (Array.isArray(matchedDbEntity.tags) ? matchedDbEntity.tags : []);

      const mergedTags = Array.from(new Set([...dbTags, ...(entity.tags || [])]));
      
      let updateNeeded = false;
      const updates: { id: string; name: string; description?: string; tags?: string[] } = {
        id: matchedDbEntity.id,
        name: matchedDbEntity.name,
      };

      if (!matchedDbEntity.description && entity.description) {
        updates.description = entity.description;
        updateNeeded = true;
      }

      if (mergedTags.length > dbTags.length) {
        updates.tags = mergedTags;
        updateNeeded = true;
      }

      if (updateNeeded) {
        entitiesToUpdate.push(updates);
      }
    } else {
      finalIdMap[entity.id] = entity.id;
      entitiesToCreate.push(entity);
    }
  }

  const resolvedIdMap: Record<string, string> = {};
  for (const origId of Object.keys(localIdMap)) {
    const repId = localIdMap[origId];
    resolvedIdMap[origId] = finalIdMap[repId] || repId;
  }

  // 3. 关系重映射与去重
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
