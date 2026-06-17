# 任务：检索精度修复 —— 核心原则不再无条件污染回答

状态：待开始
负责人：外部 AI
指挥/审查：本人（通过本文档下达，进度走 `docs/PROGRESS-retrieval-precision.md`）
创建日期：2026-06-18

---

## 0. 给执行者的话

- 这是一个**聚焦的小改动**，不是重构。只改检索排序里的一个具体缺陷，不要扩功能面、不要顺手"优化"别的地方。
- 改动前**先读懂现有代码**，尤其是 `retrieveDecisionContext` 与 `rerankByLlm` 两个函数。
- 全程用中文写代码注释（与现有风格一致），提交用 conventional commit。
- **必须**在 `docs/PROGRESS-retrieval-precision.md` 输出进度（格式见第 8 节），让我能随时看进展。
- 不确定的设计选择，写进进度文档的"待确认"区，**不要自己拍板改契约**。

---

## 1. 背景与根因（已定位，不需要你再排查）

外部审查反馈：问答类 MCP 工具会把跨域的个人/创业原则（如「先搞渠道再产品」「念起即行三步法」）当作相关记忆塞进答案，污染产品/项目类问题的回答。

根因已定位到代码级，**不是"检索精度差"这种模糊问题**：

`brain-server/src/api/handlers/mcp.ts` 的 `retrieveDecisionContext`（约 172–251 行）流程本身是讲究的：
文本召回 + 向量召回 → 去重 → 时间窗补召回 → **LLM 重排挑出真正相关的 top-N**（`rerankByLlm`）。

问题出在重排**之后**的这三行（约 211–216 行）：

```ts
const corePrinciples = await ctx.db.getCorePrinciples();        // 取全部 isCore 原则，无上限、无过滤
const seenPrincipleIds = new Set(corePrinciples.map(p => p.id));
const searchPrinciples = relevantMemories.filter(m => m.type === 'principle' && !seenPrincipleIds.has(m.id));
const principles = [...corePrinciples, ...searchPrinciples];     // 全部核心原则被无条件并入结果
```

`getCorePrinciples()`（`brain-server/src/db/sqlite.ts:471`）返回**所有** `metadata.isCore=1` 的原则，无数量上限、无相关性判断。真实库里有 ~52 条核心原则。

随后 `ask_memory`（`mcp.ts:1111` 起）把 `relevantMemories + principles` 合并成"相关记忆"喂给 LLM，system prompt 还明确要求"用到某条记忆时用其名称指明来源"。于是这 52 条全局原则**绕过了 LLM 重排**，每次必然进入答案并被引用。

**反向验证**：反馈里唯一称"用得好"的 `unified_memory_search`（`mcp.ts:892` 起）是唯一**不**走 `retrieveDecisionContext`、不灌核心原则的工具。"吵 vs 准"与"是否硬塞核心原则"完全对应 —— 根因坐实。

---

## 2. 目标

让核心原则**凭相关性进入回答**，而不是免检特权全量灌入。具体两个子目标：

- **控量**：每次回答最多保留少量（默认 3 条）与当前问题真正相关的核心原则。
- **去误标**：在喂给回答 LLM 的 prompt 里，把"原则"与"相关记忆"分区，并指示模型"原则仅在确与本问题相关时才引用"，避免离题原则被当作来源引用。

保留产品原意：核心原则仍是用户的"宪法"，**相关时**应当影响决策——我们只是不再让无关原则刷屏。

---

## 3. 非目标（明确不做）

- 不实现反馈里提到的 `types` / `tags` / `project` / `excludeTypes` 过滤参数（留作后续 chunk）。
- 不改任何 MCP 工具的入参 schema（`mcp-tools.ts` 不动）。
- 不改 `unified_memory_search` 的逻辑（它没这个 bug）。
- 不动前端、不动移动端、不动 onboarding。
- 不重构 `retrieveDecisionContext` 的整体结构，只改原则注入这一段及相关 prompt。
- 不引入新依赖。

---

## 4. 文件级改动清单

### 4.1 主改动：`brain-server/src/api/handlers/mcp.ts` —— `retrieveDecisionContext`

把"无条件并入全部核心原则"改为"核心原则也要过相关性这关，并限量"。

设计（方案 A，复用现有 `rerankByLlm`）：

1. 仍 `getCorePrinciples()` 取全部核心原则作为**候选**。
2. 新增常量 `CORE_PRINCIPLE_CAP = 3`。
3. 让核心原则与召回记忆**一起**经过相关性筛选，而不是直接拼接。推荐做法：
   - 把核心原则丢进 `rerankByLlm(ctx, situation, corePrinciples, CORE_PRINCIPLE_CAP)`，只保留 LLM 判定相关的前 `CORE_PRINCIPLE_CAP` 条。
   - `rerankByLlm` 已自带优雅降级：LLM 不可用时返回 `candidates.slice(0, topN)`，即至多 `CORE_PRINCIPLE_CAP` 条。**这正好保证了"无论有没有 LLM，核心原则数量都被硬性封顶"**，这一点要在测试里验证（见 6.1）。
4. `searchPrinciples`（召回结果里本就命中的 principle 类型）逻辑保持不变——它们是被检索/重排选中的，属于"相关"。
5. 最终 `principles = [...<相关性筛选后的核心原则>, ...searchPrinciples]`，对 id 去重。

注意：
- `rerankByLlm` 的 system prompt 当前是通用重排措辞，对原则同样适用，不需要改它。
- 不要改 `conflicts` / `graphContext` / access tracking 那几段。

### 4.2 prompt 分区：`ask_memory`（`mcp.ts` 约 1111–1188）

当前把 `relevantMemories` 与 `principles` 混在一起当"相关记忆"。改为：

- system prompt 里把**核心原则**单列一节（如「你的核心原则（仅在确与本问题相关时才参考/引用，否则忽略）：」），与「相关记忆」分开。
- `sources` 字段构成可保持不变（仍返回 memories + principles 供前端展示），但 prompt 文本要分区并加上"无关则忽略"的指示。

### 4.3 prompt 分区：`graph_answer`（`mcp.ts` 约 1189–1310）

同 4.2 的思路：`gaCtxBlock` 里把原则与记忆分区，加"原则无关则不引用"的指示。其余结构（reasons/refs/edges）不动。

> 说明：`analyze_decision` 与 `get_decision_context` 也走 `retrieveDecisionContext`，4.1 改完它们自动受益，**无需单独改**。`analyze_decision` 的 `buildAnalysisPrompt` 已把原则单列「核心原则」节，无需再动；过一遍确认即可。

### 4.4 同步副本（先确认是否活路径）：`brain-server/src/mcp-server.ts`

`mcp-server.ts`（stdio MCP server）在约 622–628 行有一份**重复**的决策上下文逻辑，同样无条件灌核心原则，且**连 LLM 重排都没有**（只有文本+向量去重）。

执行步骤：

1. **先确认它是否还是活路径**。线上桌面 app 的 MCP 走 `mcp-proxy.js` 回环到 HTTP API（即 4.1 那条路）。判断 `mcp-server.ts` 是否仍被构建/启动入口引用（查 `package.json` scripts、`mcp-proxy.ts`、桌面端启动逻辑）。把结论写进进度文档。
2. 若**仍可达**：对那段（约 622–628）施加与 4.1 等价的限量+相关性处理（注意它没有 rerank，可退而求其次：至少加 `CORE_PRINCIPLE_CAP` 硬上限 + 优先取召回命中的原则）。
3. 若**已是死代码/未被任何入口引用**：不改逻辑，只在进度文档里记一行"`mcp-server.ts` 为遗留路径，未改"，留给后续清理。

---

## 5. 验收标准（行为，可测）

1. 给 `retrieveDecisionContext` 一个与多数核心原则无关的查询时，返回的 `principles` 中**核心原则数量 ≤ 3**。（无 LLM 环境下由 cap 保证，可确定性断言。）
2. 召回结果里本就命中的 principle（`searchPrinciples`）不受 cap 影响，仍正常返回。
3. `ask_memory` / `graph_answer` 的 system prompt 中，核心原则与相关记忆**分属不同段落**，且含"无关则忽略/不引用"指示。
4. `unified_memory_search` 行为**完全不变**。
5. 现有测试全绿：`brain-server` 的 `npm run typecheck` 与 `npm test`（当前基线：5 个测试文件、87 个用例通过）。
6. 不新增对 LLM 的强依赖：LLM 未配置时，四个工具仍能返回结果（核心原则走 cap 降级），不报错、不阻塞。

---

## 6. 测试计划（最小）

### 6.1 新增单测（必须）

在 `brain-server/tests/` 下新增针对 `retrieveDecisionContext` 的测试（或就近扩展已有相关测试文件），在**不配置 LLM** 的前提下：

- 构造内存库：插入 ≥10 条 `isCore=1` 的核心原则 + 若干普通实体。
- 调用走 `get_decision_context` 工具或直接测 `retrieveDecisionContext`（取你能稳定 mock 的层）。
- 断言：结果 `principles` 里 `isCore` 原则数量 ≤ `CORE_PRINCIPLE_CAP`。
- 断言：`unified_memory_search` 同输入下返回不含被强灌的核心原则（回归保护）。

### 6.2 回归

- 跑全量 `npm test`，确认仍 87/87（或新增用例后相应增加，无失败）。
- `npm run typecheck` 通过。

### 6.3 人工冒烟（在进度文档里记录结果）

- 本地起 app，对一个产品/项目类问题用「问大脑」，确认不再出现「先搞渠道再产品」之类无关原则被当来源引用。

---

## 7. 风险与回滚

| 风险 | 说明 | 处理 |
|---|---|---|
| 误伤"原则应指导每个决策"的产品原意 | 相关原则可能被 cap 掉 | cap=3 且按相关性排序，相关的优先；保留 `analyze_decision` 既有的「核心原则」独立分节 |
| LLM 不可用时相关性退化为"取前 3" | 无 LLM 时只能按 `getCorePrinciples` 的 `updated_at DESC` 取前 3，非真相关 | 可接受：至少把噪声从 52 降到 3；后续 chunk 再上 embedding 相关性门槛 |
| stdio 路径与 HTTP 路径行为不一致 | 两份逻辑 | 按 4.4 处理并在进度文档说明 |

回滚：本任务改动集中在 `mcp.ts`（及可能的 `mcp-server.ts`）少数函数 + 一个测试文件，`git revert` 对应 commit 即可，无数据迁移、无 schema 变更。

---

## 8. 进度文档要求

在 `docs/PROGRESS-retrieval-precision.md` 持续更新，至少包含：

```
# 进度：检索精度修复

## 当前状态
（待开始 / 进行中 / 待审查 / 已完成）

## 已完成
- [ ] 4.1 retrieveDecisionContext 核心原则限量+相关性筛选
- [ ] 4.2 ask_memory prompt 分区
- [ ] 4.3 graph_answer prompt 分区
- [ ] 4.4 mcp-server.ts 活路径判定（结论：____）
- [ ] 6.1 新增单测
- [ ] typecheck / test 全绿（结果贴在下面）

## 关键决策记录
（你做的任何设计选择，尤其偏离本文档的地方，写在这里并说明理由）

## 验证结果
（npm test 输出摘要、人工冒烟结果）

## 待确认（留给指挥）
（任何你不确定、需要我拍板的点）

## 改动文件清单
（file -> 改了什么）
```

完成后把状态置为"待审查"，由我审查后再决定提交。**不要自行 push 到远端**，提交（commit）可以，push 等我确认。
