import { Database } from '../db/sqlite.js';
import { Entity } from '../shared-types.js';

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
      id: string; name: string; type: string; access_count: number;
    }>(
      `SELECT e.id, e.name, e.type, e.access_count
       FROM entities e
       WHERE e.access_count >= 5
         AND e.created_at < datetime('now', '-7 days')
         AND json_extract(e.metadata, '$.merged_into') IS NULL
         AND json_extract(e.metadata, '$.user_edited') IS NULL
         AND e.id NOT IN (
           SELECT r.target_id FROM relationships r
           WHERE r.type = 'derived_from'
             AND (r.valid_until IS NULL OR r.valid_until > datetime('now'))
         )
       ORDER BY e.access_count DESC
       LIMIT 3`,
    );

    for (const row of rows) {
      results.push({
        type: 'consumption_without_action',
        title: `你可能错过了 ${row.name} 的实践机会`,
        content: `你已浏览/引用 "${row.name}"（${row.type}）${row.access_count} 次，但从未主动沉淀或做出相关决策。考虑将其转化为行动。`,
        related_entities: [row.id],
        confidence: Math.min(0.95, 0.5 + row.access_count * 0.05),
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
    // 按 type 分组，取近 30 天内实体数 >= 5 的类型
    const typeGroups = await db.all<{ type: string; cnt: number }>(
      `SELECT type, COUNT(*) as cnt FROM entities
       WHERE created_at > datetime('now', '-30 days')
         AND json_extract(metadata, '$.merged_into') IS NULL
         AND metadata IS NOT NULL
       GROUP BY type
       HAVING cnt >= 5
       ORDER BY cnt DESC
       LIMIT 5`,
    );

    for (const group of typeGroups) {
      // 获取该类型下的实体及其 source_file / metadata.source
      const entities = await db.all<{
        id: string; name: string; source_file: string | null; metadata: string | null;
      }>(
        `SELECT id, name, source_file, metadata FROM entities
         WHERE type = ?
           AND created_at > datetime('now', '-30 days')
           AND json_extract(metadata, '$.merged_into') IS NULL
         ORDER BY access_count DESC
         LIMIT 20`,
        [group.type],
      );

      // 提取域名
      const domains = new Set<string>();
      for (const e of entities) {
        const domain = extractDomain(e.source_file, e.metadata);
        if (domain) domains.add(domain);
      }

      // 如果 ≥5 个实体但 ≤2 个不同域名 → 同质化
      if (entities.length >= 5 && domains.size <= 2 && domains.size > 0) {
        const domainList = Array.from(domains).join('、');
        results.push({
          type: 'source_homogeneity',
          title: `${group.type} 类信息来源单一`,
          content: `你在 ${group.type} 主题上累积了 ${entities.length} 条信息，但所有来源都集中在 ${domainList}。建议拓宽信息渠道以获得更全面的视角。`,
          related_entities: entities.slice(0, 5).map(e => e.id),
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
function extractDomain(sourceFile: string | null, metadataStr: string | null): string | null {
  // 尝试从 metadata.source 提取
  if (metadataStr) {
    try {
      const meta = typeof metadataStr === 'string' ? JSON.parse(metadataStr) : metadataStr;
      const source = meta?.source || meta?.provenance?.source || meta?.provenance?.url;
      if (source && typeof source === 'string') {
        try {
          return new URL(source).hostname;
        } catch {
          // source 不是 URL，直接用作来源标识
          if (source !== 'user' && source !== 'agent-loop') return source;
        }
      }
    } catch { /* 解析失败忽略 */ }
  }
  // 尝试从 source_file 提取
  if (sourceFile) {
    try {
      return new URL(sourceFile).hostname;
    } catch {
      // 非 URL，可能是文件路径，提取目录或扩展名作为来源
      return null;
    }
  }
  return null;
}

// ── 搜索但未捕获 ──

async function findSearchWithoutCapture(db: Database): Promise<Blindspot[]> {
  const results: Blindspot[] = [];
  try {
    // 从 discussions 表中获取近 14 天的对话
    const discussions = await db.all<{ id: string; title: string; turns: string }>(
      `SELECT id, title, turns FROM discussions
       WHERE updated_at > datetime('now', '-14 days')
       ORDER BY updated_at DESC
       LIMIT 20`,
    );

    if (discussions.length === 0) return results;

    // 从讨论标题和内容中提取关键词（中文 bigram/trigram + 英文分词）
    const searchTerms = new Set<string>();
    for (const d of discussions) {
      const titleKeywords = extractKeywords(d.title);
      for (const token of titleKeywords.slice(0, 5)) {
        searchTerms.add(token);
      }

      // 从 turns 中提取用户提问的关键词
      try {
        const turns: Array<{ role: string; content: string }> = JSON.parse(d.turns);
        const userTurns = turns.filter(t => t.role === 'user');
        for (const turn of userTurns.slice(0, 2)) {
          const contentKeywords = extractKeywords(turn.content);
          for (const token of contentKeywords.slice(0, 5)) {
            searchTerms.add(token);
          }
        }
      } catch { /* turns 解析失败忽略 */ }
    }

    // 检查每个搜索词是否在实体中出现
    for (const term of Array.from(searchTerms).slice(0, 10)) {
      try {
        const matches = await db.searchEntities(term, 2);
        if (matches.length < 2) {
          results.push({
            type: 'search_without_capture',
            title: `"${term}" 搜索未沉淀`,
            content: `你在近期讨论中提到了 "${term}"，但知识图谱中几乎没有相关记录（仅 ${matches.length} 条）。考虑主动捕获和整理这方面的信息。`,
            related_entities: matches.map(m => m.id),
            confidence: 0.55,
          });
        }
      } catch { /* 搜索失败跳过 */ }

      // 最多产出 2 条此类盲区
      if (results.filter(r => r.type === 'search_without_capture').length >= 2) break;
    }
  } catch (e) {
    console.warn('[BlindspotDetector] 搜索但未捕获检测失败:', e);
  }
  return results;
}

// ── 中文/混合文本关键词提取 ──

/**
 * 从混合中英文文本中提取有意义的搜索关键词。
 * 中文部分用字符 bigram + trigram 切分，
 * 英文部分按空格和标点切分。
 * 只保留长度 ≥ 2 的 token。
 */
function extractKeywords(text: string): string[] {
  if (!text) return [];
  const results: string[] = [];

  // 先用标点和空白把英文/数字段和中文字符串分开
  const segments = text.split(/[\s,，。、！？：；""（）\(\)\[\]【】《》<>\/\\|@#$%^&*+=~`]+/).filter(Boolean);

  for (const seg of segments) {
    // 纯中文或中英混合段：提取连续中文字符的 bigram + trigram
    const chineseOnly = seg.replace(/[^\u4e00-\u9fff]/g, '');
    if (chineseOnly.length >= 2) {
      // bigram: 每相邻 2 字
      for (let i = 0; i <= chineseOnly.length - 2; i++) {
        results.push(chineseOnly.slice(i, i + 2));
      }
      // trigram: 每相邻 3 字
      for (let i = 0; i <= chineseOnly.length - 3; i++) {
        results.push(chineseOnly.slice(i, i + 3));
      }
    } else if (chineseOnly.length === 0 && seg.length >= 2) {
      // 纯英文/数字段，且长度 ≥ 2
      results.push(seg.toLowerCase());
    }
  }

  // 去重，按长度降序（更长的 token 更有意义）
  const unique = [...new Set(results)];
  unique.sort((a, b) => b.length - a.length);
  return unique;
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
  const deduped = allBlindspots.filter(bs => {
    const key = makeBlindspotDedupeKey(bs);
    return !recentKeys.has(key);
  });

  // 按置信度降序排序
  deduped.sort((a, b) => b.confidence - a.confidence);

  return deduped;
}
