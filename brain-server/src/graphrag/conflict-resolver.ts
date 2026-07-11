import { Database } from '../db/sqlite.js';
import { Relationship, SINGLE_VALUED_REL_TYPES } from '../shared-types.js';
import { GraphRAGExtractor } from './extractor.js';
import { createAuditedAiFetch } from '../security/audited-ai-fetch.js';

const conflictLlmFetch = createAuditedAiFetch({ purpose: 'graphrag.conflict-resolution', kind: 'llm' });

/**
 * 自动冲突检测与消解逻辑
 * 对每一条新抽取的关系，检查是否存在同一 (source_id, target_id) 实体对之间的有效旧关系。
 * 若存在，调用 LLM 评估其语义关系：
 * 1. superseded: 旧关系已被新关系取代 -> 将旧关系设为失效
 * 2. conflict: 两者逻辑冲突，产生 conflicts_with 关系
 * 3. independent: 两者独立并存 -> 不作处理
 */
export async function resolveConflicts(
  newRels: Relationship[],
  db: Database,
  extractor: GraphRAGExtractor
): Promise<void> {
  if (!newRels || newRels.length === 0) return;

  // 检查 LLM 配置是否可用
  const llmConfig = extractor.getLlmConfig();
  if (!llmConfig.apiUrl) {
    console.log('[conflict-resolver] LLM apiUrl is empty. Skip conflict resolution.');
    return;
  }

  for (const newRel of newRels) {
    try {
      const now = new Date().toISOString();

      // 1. 处理单值关系失效 (SINGLE_VALUED_REL_TYPES)
      if (SINGLE_VALUED_REL_TYPES.includes(newRel.type)) {
        const supersededRels = await db.all<Relationship>(
          `SELECT * FROM relationships
           WHERE source_id = ? AND type = ? AND target_id != ?
             AND (valid_until IS NULL OR valid_until > ?)`,
          [newRel.source_id, newRel.type, newRel.target_id, now]
        );
        for (const oldRel of supersededRels) {
          console.log(`[conflict-resolver] Invalidate superseded single-valued relationship: ${oldRel.id} (${oldRel.type})`);
          await db.invalidateRelationship(oldRel.id, `superseded by extraction at ${newRel.valid_from || now}`);
        }
      }

      // 2. 原有的同一实体对 LLM 冲突消解
      // 查询图谱中同一实体对且当前有效的已有关系（排除 conflicts_with 和当前新关系本身）
      const existingRels = await db.all<Relationship>(
        `SELECT * FROM relationships 
         WHERE source_id = ? AND target_id = ? 
           AND id != ? 
           AND type != 'conflicts_with' 
           AND (valid_until IS NULL OR valid_until > ?)`,
        [newRel.source_id, newRel.target_id, newRel.id, now]
      );

      if (existingRels.length === 0) {
        continue;
      }

      console.log(`[conflict-resolver] Found ${existingRels.length} existing relationship(s) for pair (${newRel.source_id} -> ${newRel.target_id}). Evaluating conflicts...`);

      // 构造 Prompt
      const prompt = `你是一个知识图谱冲突消解专家。
系统当前正在尝试在实体对 (source_id: "${newRel.source_id}", target_id: "${newRel.target_id}") 之间插入一条新关系。
请结合上下文评估此新关系与目前已有的、有效的旧关系之间的语义关系，判断新关系是否取代了旧关系，或是与其逻辑上并存冲突，还是完全相互独立。

【实体信息】
- 源实体 (source_id): "${newRel.source_id}"
- 目标实体 (target_id): "${newRel.target_id}"

【要插入的新关系】
- 类型: "${newRel.type}"
- 描述: "${newRel.description || ''}"
- 权重: ${newRel.weight}

【已有的旧关系列表】
${existingRels.map((rel, index) => `
---
旧关系 #${index + 1}:
- ID: "${rel.id}"
- 类型: "${rel.type}"
- 描述: "${rel.description || ''}"
- 权重: ${rel.weight}
`).join('\n')}

请评估新关系并对每一个旧关系进行分类判断，选项必须是以下之一：
- "superseded": 旧关系在语义上已被新关系取代或覆盖（例如：新关系提供了更新的状态、配置、偏好，使得旧关系逻辑上不再有效）。
- "conflict": 旧关系与新关系存在无法妥协的逻辑冲突（例如：同一个任务在同一时间段内有两个互相矛盾的执行方案，无法判断谁是谁非，属于真实的并存冲突立场）。
- "independent": 旧关系与新关系在语义上是完全独立或不矛盾的，可以合理并存（例如：两者描述的是该实体对之间不同维度、且不互相冲突的内容）。

请严格以 JSON 格式输出，不要包含任何说明文字或 markdown 的包围格式。格式如下：
{
  "resolutions": [
    {
      "oldRelationshipId": "旧关系的 ID",
      "status": "superseded" | "conflict" | "independent"
    }
  ]
}
`;

      // 调用 LLM
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15s 超时

      let content = '';
      try {
        const response = await conflictLlmFetch(`${llmConfig.apiUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(llmConfig.apiKey ? { 'Authorization': `Bearer ${llmConfig.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: llmConfig.model,
            messages: [
              { role: 'system', content: '你是一个知识图谱冲突消解专家，只输出有效的 JSON，不要输出任何其他文本。' },
              { role: 'user', content: prompt }
            ],
            max_tokens: 4000,
            temperature: 0.1,
            response_format: { type: 'json_object' }
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          console.error(`[conflict-resolver] LLM API call failed with status: ${response.status}`);
          continue;
        }

        const data = await response.json() as {
          choices: Array<{ message: { content: string } }>;
        };

        content = data.choices?.[0]?.message?.content || '';
      } finally {
        clearTimeout(timeout);
      }

      if (!content) {
        console.error('[conflict-resolver] Empty response from LLM');
        continue;
      }

      // 解析 JSON
      const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      const responseData = JSON.parse(jsonStr.trim());

      if (responseData && Array.isArray(responseData.resolutions)) {
        for (const res of responseData.resolutions) {
          const oldRel = existingRels.find(r => r.id === res.oldRelationshipId);
          if (!oldRel) continue;

          if (res.status === 'superseded') {
            console.log(`[conflict-resolver] Invalidate superseded relationship: ${oldRel.id}`);
            await db.invalidateRelationship(oldRel.id);
          } else if (res.status === 'conflict') {
            console.log(`[conflict-resolver] Detected genuine conflict between new rel and old rel: ${oldRel.id}`);
            // 检查 conflicts_with 是否已存在
            const conflictExists = await db.get<any>(
              `SELECT id FROM relationships 
               WHERE ((source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?))
                 AND type = 'conflicts_with'
                 AND (valid_until IS NULL OR valid_until > ?)`,
              [newRel.source_id, newRel.target_id, newRel.target_id, newRel.source_id, now]
            );

            if (!conflictExists) {
              console.log(`[conflict-resolver] Adding conflicts_with relationship between ${newRel.source_id} and ${newRel.target_id}`);
              await db.addRelationship({
                source_id: newRel.source_id,
                target_id: newRel.target_id,
                type: 'conflicts_with',
                description: `冲突发生在 [${newRel.type}](${newRel.description || ''}) 与旧有关系之间`,
                weight: 1.0,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error(`[conflict-resolver] Error resolving conflict for relationship ${newRel.id}:`, err);
    }
  }
}
