import { Database } from '../db/sqlite.js';

// ── 类型定义 ──

export interface Blindspot {
  type: 'consumption_without_action' | 'source_homogeneity' | 'search_without_capture';
  title: string;
  content: string;
  related_entities: string[];
  confidence: number; // 0-1
}

// ── 消费但不行动 ──

async function findConsumptionWithoutAction(db: Database): Promise<Blindspot[]> {
  const results: Blindspot[] = [];
  try {
    const rows = await db.all<{
      id: string; name: string; type: string; consumption_count: number;
    }>(
      `SELECT e.id, e.name, e.type, COUNT(*) AS consumption_count
       FROM entities e
       JOIN behavior_events consumed ON consumed.entity_id = e.id
         AND consumed.event_type IN ('viewed', 'retrieved', 'cited')
       WHERE consumed.occurred_at < datetime('now', '-7 days')
         AND consumed.intent = 'action'
         AND json_extract(e.metadata, '$.merged_into') IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM behavior_events action
           WHERE action.entity_id = e.id
             AND action.event_type IN ('captured','edited','decided','task_created','task_completed')
             AND action.occurred_at >= consumed.occurred_at
         )
         AND NOT EXISTS (
           SELECT 1 FROM behavior_events deferred
           WHERE deferred.entity_id = e.id
             AND deferred.intent IN ('deferred','none')
             AND deferred.occurred_at >= consumed.occurred_at
         )
       GROUP BY e.id, e.name, e.type
       HAVING COUNT(*) >= 5
       ORDER BY consumption_count DESC
       LIMIT 3`,
    );

    for (const row of rows) {
      results.push({
        type: 'consumption_without_action',
        title: `你可能错过了 ${row.name} 的实践机会`,
        content: `你带着行动意图浏览/引用了 "${row.name}"（${row.type}）${row.consumption_count} 次，但之后没有捕获、编辑、决策或任务行为。考虑将其转化为行动。`,
        related_entities: [row.id],
        confidence: Math.min(0.95, 0.5 + row.consumption_count * 0.05),
      });
    }
  } catch (e) {
    console.warn('[BlindspotDetector] 消费但不行动检测失败:', e);
  }
  return results;
}

// ── 来源同质化 ──

async function findSourceHomogeneity(db: Database): Promise<Blindspot[]> {
  const results: Blindspot[] = [];
  try {
    const entities = await db.all<{
      id: string; name: string; tags: string | null; source_file: string | null; metadata: string | null;
    }>(
      `SELECT id, name, tags, source_file, metadata FROM entities
       WHERE created_at > datetime('now', '-30 days')
         AND json_extract(metadata, '$.merged_into') IS NULL
       ORDER BY created_at DESC
       LIMIT 500`,
    );
    const groups = new Map<string, typeof entities>();
    for (const entity of entities) {
      const topic = extractSemanticTopic(entity.tags, entity.name);
      if (!topic) continue;
      const group = groups.get(topic) || [];
      group.push(entity);
      groups.set(topic, group);
    }

    for (const [topic, topicEntities] of groups) {
      if (topicEntities.length < 5) continue;
      const sources = new Set(topicEntities.map((entity) => extractSourceIdentity(entity.source_file, entity.metadata)).filter(Boolean));
      if (sources.size <= 2 && sources.size > 0) {
        const sourceList = [...sources].join('、');
        results.push({
          type: 'source_homogeneity',
          title: `${topic} 主题的信息来源较单一`,
          content: `你在 ${topic} 主题上累积了 ${topicEntities.length} 条信息，但来源集中在 ${sourceList}。建议补充不同网站、文件或 AI 来源。`,
          related_entities: topicEntities.slice(0, 5).map((entity) => entity.id),
          confidence: 0.7,
        });
      }
    }
  } catch (e) {
    console.warn('[BlindspotDetector] 来源同质化检测失败:', e);
  }
  return results;
}

/**
 * 从实体的 source_file 或 metadata.source 中提取域名
 */
const GENERIC_TOPIC_TAGS = new Set(['uploaded-file', 'imported', 'auto_extracted', 'llm-extracted', 'web', 'url']);

function extractSemanticTopic(tagsStr: string | null, name: string): string | null {
  try {
    const tags = tagsStr ? JSON.parse(tagsStr) : [];
    const topic = Array.isArray(tags)
      ? tags.find((tag) => typeof tag === 'string' && tag.length >= 2 && !GENERIC_TOPIC_TAGS.has(tag))
      : undefined;
    if (topic) return String(topic).slice(0, 40);
  } catch { /* malformed legacy tags have no reliable topic */ }
  const words = name.match(/[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,8}/g);
  return words?.[0]?.slice(0, 40) || null;
}

function extractSourceIdentity(sourceFile: string | null, metadataStr: string | null): string | null {
  // 尝试从 metadata.source 提取
  if (metadataStr) {
    try {
      const meta = typeof metadataStr === 'string' ? JSON.parse(metadataStr) : metadataStr;
      const source = meta?.source || meta?.provenance?.source || meta?.provenance?.url;
      if (source && typeof source === 'string') {
        try {
          return `site:${new URL(source).hostname}`;
        } catch {
          // source 不是 URL，直接用作来源标识
          if (source !== 'user' && source !== 'agent-loop') return `ai:${source}`;
        }
      }
    } catch { /* 解析失败忽略 */ }
  }
  // 尝试从 source_file 提取
  if (sourceFile) {
    try {
      return `site:${new URL(sourceFile).hostname}`;
    } catch {
      // 非 URL，可能是文件路径，提取目录或扩展名作为来源
      const extension = sourceFile.match(/\.([A-Za-z0-9]{1,8})$/)?.[1]?.toLowerCase();
      return extension ? `file:${extension}` : 'file:local';
    }
  }
  return null;
}

// ── 搜索但未捕获 ──

async function findSearchWithoutCapture(db: Database): Promise<Blindspot[]> {
  const results: Blindspot[] = [];
  try {
    const searches = await db.all<{ topic: string; search_count: number }>(
      `SELECT LOWER(TRIM(topic)) AS topic, COUNT(*) AS search_count
       FROM behavior_events
       WHERE event_type = 'searched'
         AND occurred_at > datetime('now', '-14 days')
         AND topic IS NOT NULL
       GROUP BY LOWER(TRIM(topic))
       HAVING COUNT(*) >= 2
       ORDER BY search_count DESC
       LIMIT 20`,
    );
    for (const search of searches) {
      const term = normalizeSearchTopic(search.topic);
      if (!term) continue;
      try {
        const matches = await db.searchEntities(term, 2);
        if (matches.length < 2) {
          results.push({
            type: 'search_without_capture',
            title: `"${term}" 搜索未沉淀`,
            content: `你近期搜索了 "${term}" ${search.search_count} 次，但知识图谱中仅有 ${matches.length} 条相关记录。考虑主动捕获和整理这方面的信息。`,
            related_entities: matches.map(m => m.id),
            confidence: 0.55,
          });
        }
      } catch { /* 搜索失败跳过 */ }

      if (results.filter(r => r.type === 'search_without_capture').length >= 2) break;
    }
  } catch (e) {
    console.warn('[BlindspotDetector] 搜索但未捕获检测失败:', e);
  }
  return results;
}

const SEARCH_STOPWORDS = new Set([
  '什么', '怎么', '如何', '为什么', '这个', '那个', '可以', '是否', 'please', 'what', 'how', 'why',
]);

function normalizeSearchTopic(topic: string): string | null {
  const normalized = topic.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (normalized.length < 2 || SEARCH_STOPWORDS.has(normalized.toLowerCase())) return null;
  if (/^[\u4e00-\u9fff]{2,3}$/.test(normalized) && SEARCH_STOPWORDS.has(normalized)) return null;
  return normalized;
}

// ── 去重辅助 ──

function makeBlindspotDedupeKey(bs: Blindspot): string {
  const entityKey = bs.related_entities.slice().sort().join('|');
  return `${bs.type}:${entityKey}`;
}

/**
 * 获取 24h 内已发出的 blindspot 通知的去重 key 集合
 */
async function getRecentBlindspotKeys(db: Database): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    const rows = await db.all<{ related_entities: string; title: string }>(
      `SELECT related_entities, title FROM notifications
       WHERE type = 'blindspot'
         AND created_at > datetime('now', '-1 day')`,
    );
    for (const row of rows) {
      if (!row.related_entities) continue;
      try {
        const ids: string[] = JSON.parse(row.related_entities);
        // 通过 title 推断 blindspot type
        let bsType = 'unknown';
        if (row.title.includes('实践机会') || row.title.includes('错过')) bsType = 'consumption_without_action';
        else if (row.title.includes('来源单一') || row.title.includes('同质')) bsType = 'source_homogeneity';
        else if (row.title.includes('未沉淀') || row.title.includes('搜索')) bsType = 'search_without_capture';

        const entityKey = ids.slice().sort().join('|');
        keys.add(`${bsType}:${entityKey}`);
      } catch { /* 解析失败跳过 */ }
    }
  } catch { /* 查询失败不阻塞 */ }
  return keys;
}

// ── 主入口 ──

/**
 * 认知盲区检测：扫描知识图谱，识别用户可能遗漏的信息维度。
 * @param db 数据库实例
 * @returns 盲区列表（已去重，按 confidence 降序）
 */
export async function detectBlindspots(db: Database): Promise<Blindspot[]> {
  const allBlindspots: Blindspot[] = [];

  // 1. 消费但不行动
  const cwa = await findConsumptionWithoutAction(db);
  allBlindspots.push(...cwa);

  // 2. 来源同质化
  const sh = await findSourceHomogeneity(db);
  allBlindspots.push(...sh);

  // 3. 搜索但未捕获
  const swc = await findSearchWithoutCapture(db);
  allBlindspots.push(...swc);

  // 24h 去重
  const recentKeys = await getRecentBlindspotKeys(db);
  const suppressedRows = await db.all<{ insight_type: string }>(
    `SELECT DISTINCT insight_type FROM proactive_insights
     WHERE feedback = 'stop_this_type'
        OR (cooldown_until IS NOT NULL AND cooldown_until > datetime('now'))`,
  );
  const suppressedTypes = new Set(suppressedRows.map((row) => row.insight_type));
  const deduped = allBlindspots.filter(bs => {
    const key = makeBlindspotDedupeKey(bs);
    return !recentKeys.has(key) && !suppressedTypes.has(bs.type);
  });

  // 按置信度降序排序
  deduped.sort((a, b) => b.confidence - a.confidence);

  return deduped;
}
