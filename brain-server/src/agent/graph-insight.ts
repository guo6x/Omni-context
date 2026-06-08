import { Database } from '../db/sqlite.js';
import { Entity } from '../shared-types.js';

// ── 类型定义 ──

export interface GraphInsight {
  title: string;
  content: string;
  category: 'statistical' | 'latent_connection' | 'anti_consensus';
  related_entities: string[];  // entity IDs
  confidence: number;           // 0-1
}

// ── 对立关键词对（中英文混合，覆盖更多语义场景）──

const OPPOSING_KEYWORDS = {
  pro: [
    '优势', '优点', '支持', '好处', '利', '赞成', '正面', '肯定', '推荐', '值得',
    '有效', '成功', '提升', '改善', '优化', '增长', '突破', '领先', '最佳', '优秀',
    'pro', 'benefit', 'advantage', 'support', 'positive', 'effective', 'improve',
    'success', 'recommend', 'best', 'strength', 'gain', 'boost',
  ],
  con: [
    '劣势', '缺点', '批评', '反对', '坏处', '弊', '负面', '否定', '不推荐', '问题',
    '无效', '失败', '下降', '恶化', '瓶颈', '限制', '缺陷', '不足', '风险', '挑战',
    '错误', '漏洞', '争议', '隐患', '误区', '陷阱', '警告', '注意', '避免', '慎重',
    'con', 'drawback', 'disadvantage', 'criticism', 'negative', 'ineffective',
    'failure', 'risk', 'limitation', 'weakness', 'problem', 'issue', 'flaw',
  ],
};

// ── 统计型洞见 ──

async function findStatisticalInsights(db: Database): Promise<GraphInsight[]> {
  const results: GraphInsight[] = [];

  // 信号 1：注意力分布异常（近 14 天）
  try {
    let typeStats = await db.getAccessCountByType(14);
    // 过滤掉系统自动或批量生成的 principle 和 evidence 类型，使注意力分布只聚焦在用户主动认知的实体类型（如 concept、project、decision 等）
    typeStats = typeStats.filter(t => t.type !== 'principle' && t.type !== 'evidence');
    if (typeStats.length >= 2) {
      const totalAccess = typeStats.reduce((sum, t) => sum + t.total_access, 0);
      if (totalAccess > 0) {
        const topType = typeStats[0];
        const topPct = Math.round((topType.total_access / totalAccess) * 100);
        if (topPct >= 50) {
          const secondType = typeStats[1];
          const secondPct = Math.round((secondType.total_access / totalAccess) * 100);
          results.push({
            category: 'statistical',
            title: `注意力分布异常：${topType.type} 类型占比 ${topPct}%`,
            content: `近两周你最高频接触的是 ${topType.type} 类型（占总接触量的 ${topPct}%），但 ${secondType.type} 只有 ${secondPct}%。你可能在 ${topType.type} 上投入了过多注意力。`,
            related_entities: [],
            confidence: 0.9,
          });
        }
      }
    }
  } catch (e) {
    console.warn('[GraphInsight] 注意力分布分析失败:', e);
  }

  // 信号 2：未深入主题（近 30 天，无 derived_from 入边，数量 ≥ 5）
  try {
    const shallow = await db.all<{ type: string; cnt: number }>(
      `SELECT e.type, COUNT(*) as cnt
       FROM entities e
       LEFT JOIN relationships r ON e.id = r.target_id AND r.type = 'derived_from'
         AND (r.valid_until IS NULL OR r.valid_until > datetime('now'))
       WHERE r.target_id IS NULL
         AND e.created_at > datetime('now', '-30 days')
         AND json_extract(e.metadata, '$.merged_into') IS NULL
       GROUP BY e.type
       HAVING cnt >= 5
       ORDER BY cnt DESC
       LIMIT 3`,
    );
    for (const row of shallow) {
      results.push({
        category: 'statistical',
        title: `未深入主题：${row.type} 类型累积 ${row.cnt} 条未沉淀`,
        content: `你在 ${row.type} 上累积了 ${row.cnt} 条信息，但没有一条被主动沉淀或关联到决策。考虑深入整理或建立关联。`,
        related_entities: [],
        confidence: 0.85,
      });
    }
  } catch (e) {
    console.warn('[GraphInsight] 未深入主题分析失败:', e);
  }

  // 信号 3：知识衰减预警增强（高重要度实体批量接近 stale）
  try {
    const decaying = await db.all<{ id: string; name: string; type: string; days_ago: number }>(
      `SELECT id, name, type,
              CAST((julianday('now') - julianday(last_accessed)) AS INTEGER) as days_ago
       FROM entities
       WHERE json_extract(metadata, '$.merged_into') IS NULL
         AND COALESCE(CAST(json_extract(metadata, '$.importance') AS REAL), 0.5) >= 0.7
         AND last_accessed < datetime('now', '-7 days')
         AND last_accessed > datetime('now', '-14 days')
       ORDER BY last_accessed ASC
       LIMIT 10`,
    );
    if (decaying.length >= 3) {
      const names = decaying.slice(0, 5).map(d => `${d.name}(${d.days_ago}天)`).join('、');
      results.push({
        category: 'statistical',
        title: `${decaying.length} 条重要知识即将遗忘`,
        content: `以下高重要度记忆已多日未访问，有遗忘风险：${names}。建议近期回顾。`,
        related_entities: decaying.map(d => d.id),
        confidence: 0.95,
      });
    }
  } catch (e) {
    console.warn('[GraphInsight] 知识衰减预警分析失败:', e);
  }

  return results;
}

// ── 潜伏关联 ──

async function findLatentConnections(db: Database, entities: Entity[]): Promise<GraphInsight[]> {
  const results: GraphInsight[] = [];
  // 加载近 7 天已产生的 latent_connection 通知，用于去重
  const recentPairs = await getRecentInsightPairs(db, 'latent_connection', 7);

  for (const entity of entities) {
    // 获取一度邻居
    const depth1 = await db.getGraphNeighborhood(entity.id, 1);
    const neighborIds = new Set(depth1.nodes.map(n => n.id));
    neighborIds.delete(entity.id);

    // 获取二度邻居
    const depth2 = await db.getGraphNeighborhood(entity.id, 2);
    const secondDegreeNodes = depth2.nodes.filter(
      n => n.id !== entity.id && !neighborIds.has(n.id)
    );

    if (secondDegreeNodes.length === 0) continue;

    // 找桥梁节点：哪个一度邻居同时连接了二度节点
    for (const latentNode of secondDegreeNodes.slice(0, 3)) {
      // 检查去重
      const pairKey = makePairKey(entity.id, latentNode.id);
      if (recentPairs.has(pairKey)) continue;

      // 找到桥梁
      const latentNeighbors = await db.getGraphNeighborhood(latentNode.id, 1);
      const latentNeighborIds = new Set(latentNeighbors.nodes.map(n => n.id));
      const bridges = depth1.nodes.filter(
        n => n.id !== entity.id && latentNeighborIds.has(n.id)
      );

      if (bridges.length > 0) {
        const bridge = bridges[0];
        results.push({
          category: 'latent_connection',
          title: `${entity.name} 和 ${latentNode.name} 可能存在间接关联`,
          content: `它们通过 ${bridge.name} 连接，但从未被显式关联。这可能揭示了一个尚未被注意到的联系。`,
          related_entities: [entity.id, latentNode.id, bridge.id],
          confidence: 0.6,
        });
        // 每个起始实体最多产出 1 条潜伏关联
        break;
      }
    }
  }

  return results;
}

// ── 反共识洞见 [核心壁垒] ──

async function findAntiConsensus(db: Database): Promise<GraphInsight[]> {
  const results: GraphInsight[] = [];
  const recentPairs = await getRecentInsightPairs(db, 'anti_consensus', 7);

  // 获取近 30 天活跃的实体（降低门槛：有描述或有名字即可参与立场分类）
  const recentEntities = await db.all<{
    id: string; name: string; type: string; description: string | null;
  }>(
    `SELECT id, name, type, description FROM entities
     WHERE created_at > datetime('now', '-30 days')
       AND json_extract(metadata, '$.merged_into') IS NULL
       AND (description IS NOT NULL AND description != ''
            OR name IS NOT NULL AND name != '')
     ORDER BY access_count DESC
     LIMIT 150`,
  );

  // 标记每个实体的视角倾向
  interface TaggedEntity {
    id: string;
    name: string;
    type: string;
    description: string;
    stance: 'pro' | 'con' | 'neutral';
  }

  const tagged: TaggedEntity[] = recentEntities.map(e => {
    const text = `${e.name} ${e.description || ''}`.toLowerCase();
    let proScore = 0;
    let conScore = 0;
    for (const kw of OPPOSING_KEYWORDS.pro) {
      if (text.includes(kw)) proScore++;
    }
    for (const kw of OPPOSING_KEYWORDS.con) {
      if (text.includes(kw)) conScore++;
    }
    const stance = proScore > conScore ? 'pro' : conScore > proScore ? 'con' : 'neutral';
    return { ...e, stance };
  });

  const proEntities = tagged.filter(e => e.stance === 'pro');
  const conEntities = tagged.filter(e => e.stance === 'con');

  // 找同主题下的对立对：共享一度邻居 → 同主题
  for (const pro of proEntities.slice(0, 10)) {
    const proNeighbors = await db.getGraphNeighborhood(pro.id, 1);
    const proNeighborIds = new Set(proNeighbors.nodes.map(n => n.id));

    for (const con of conEntities.slice(0, 10)) {
      if (pro.id === con.id) continue;
      const pairKey = makePairKey(pro.id, con.id);
      if (recentPairs.has(pairKey)) continue;

      // 检查是否共享一度邻居（代表同主题）
      const conNeighbors = await db.getGraphNeighborhood(con.id, 1);
      const sharedNeighbor = conNeighbors.nodes.find(
        n => n.id !== pro.id && n.id !== con.id && proNeighborIds.has(n.id)
      );

      if (sharedNeighbor) {
        results.push({
          category: 'anti_consensus',
          title: `对立视角：${pro.name} vs ${con.name}`,
          content: `关于 ${sharedNeighbor.name} 这个主题，"${pro.name}" 倾向正面视角，而 "${con.name}" 倾向批判视角。审视这对矛盾可能带来新的洞察。`,
          related_entities: [pro.id, con.id, sharedNeighbor.id],
          confidence: 0.7,
        });
        // 每个 pro 实体最多产出 1 条反共识
        break;
      }
    }

    // 最多产出 2 条反共识洞见
    if (results.filter(r => r.category === 'anti_consensus').length >= 2) break;
  }

  return results;
}

// ── 辅助函数 ──

function makePairKey(id1: string, id2: string): string {
  return [id1, id2].sort().join('|');
}

/**
 * 获取近 N 天内已产出的某类洞见通知中涉及的实体对，用于去重。
 * 通过解析 notifications 表中 related_entities 字段实现。
 */
async function getRecentInsightPairs(db: Database, category: string, days: number): Promise<Set<string>> {
  const pairs = new Set<string>();
  try {
    const rows = await db.all<{ related_entities: string; title: string }>(
      `SELECT related_entities, title FROM notifications
       WHERE type = 'insight'
         AND created_at > datetime('now', '-' || ? || ' days')
         AND title LIKE ?`,
      [days, category === 'latent_connection' ? '%间接关联%' : '%对立视角%'],
    );
    for (const row of rows) {
      if (!row.related_entities) continue;
      try {
        const ids: string[] = JSON.parse(row.related_entities);
        if (ids.length >= 2) {
          pairs.add(makePairKey(ids[0], ids[1]));
        }
      } catch { /* 解析失败跳过 */ }
    }
  } catch { /* 查询失败不阻塞 */ }
  return pairs;
}

// ── 主入口 ──

/**
 * 图分析驱动的洞见生成：先通过确定性图算法扫描候选，再交给调用者决定是否 LLM 润色。
 * @param db 数据库实例
 * @param entities 本轮待整合实体（来自 getEntitiesForConsolidation）
 * @returns 候选洞见列表，按 confidence 降序排列
 */
export async function generateGraphInsights(db: Database, entities: Entity[]): Promise<GraphInsight[]> {
  const allInsights: GraphInsight[] = [];

  // 1. 统计型（纯计算，不依赖输入 entities）
  const statistical = await findStatisticalInsights(db);
  allInsights.push(...statistical);

  // 2. 潜伏关联（依赖输入 entities 做图遍历）
  if (entities.length >= 1) {
    const latent = await findLatentConnections(db, entities);
    allInsights.push(...latent);
  }

  // 3. 反共识（全库扫描，不依赖输入 entities）
  const anti = await findAntiConsensus(db);
  allInsights.push(...anti);

  // 按置信度降序排序
  allInsights.sort((a, b) => b.confidence - a.confidence);

  return allInsights;
}
