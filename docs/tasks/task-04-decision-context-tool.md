# 任务 04：新增 MCP「决策上下文」工具

> 这是阶段 2（把知识图谱打磨成可对外的「数字脑子」）的第一个任务。
> 项目根目录：`omni-context-release/`。

## 背景与目标

Omni-Context 的护城河是：让外部 AI 产品接上这张知识图谱，获得一个「能基于用户历史做决策判断的脑子」。

当前 MCP server（`brain-server/src/mcp-server.ts`）暴露了 14 个工具，但全是「存 / 查」类
（add_entity、search_entities、unified_memory_search 等）。**缺一个真正面向「决策支持」的工具**——
外部 AI 在面对一个具体处境时，需要一次性拿到：相关的原则、相关的历史先例、以及这些历史之间的冲突。

**关键设计原则**：这个工具**不自己调用 LLM 下结论**。做决策的是接入的外部 AI，
Omni-Context 的职责是当记忆层——把组织好的历史材料喂过去，让外部 AI 自己判断。
所以本工具只做「检索 + 组织」，不做「推理 + 结论」。

## 要做的事

在 `brain-server/src/mcp-server.ts` 新增一个 MCP 工具 `get_decision_context`。

### 输入
```
{
  situation: string,   // 必填。外部 AI 正在面对的处境 / 问题（自然语言）
  limit?: number       // 可选。每类材料的条数上限，默认 5
}
```

### 行为
1. **相关历史**：用 `situation` 跑一次融合检索（复用 `unified_memory_search` 已有的逻辑：
   FTS 文本检索 + 向量检索 + 图谱邻域），得到与该处境最相关的实体。
2. **相关原则**：取核心原则（`db.getCorePrinciples()`），外加上一步检索结果里 `type === 'principle'`
   的实体。这是「用户/项目一贯怎么做」。
3. **历史冲突**：在上一步检索到的相关实体集合内，找出由 `conflicts_with` 关系连接的实体对——
   这是要主动提醒外部 AI 的「你的历史在这里有矛盾」。
4. 不做 LLM 合成、不下结论。

### 输出（结构化 JSON）
```
{
  situation: string,           // 回显
  principles: [...],           // 相关原则（含核心原则）
  relevantMemories: [...],     // 相关历史实体
  conflicts: [                 // 检索集合内的冲突对，没有则空数组
    { a: {id,name}, b: {id,name}, description: string }
  ],
  graphContext: {...}          // 相关实体的图谱邻域，便于外部 AI 看清关系
}
```

## 实现提示

- 尽量复用现有逻辑：融合检索可参考 `unified_memory_search` 这个 case 的实现；
  图谱邻域用 `db.getGraphNeighborhood`；原则用 `db.getCorePrinciples`。
- 冲突检测：对相关实体逐个取 `db.getRelationshipsForEntity`，筛 `type === 'conflicts_with'`，
  且两端都在相关实体集合内，去重后输出。
- 别忘了在 `listTools()` 里登记这个工具，`callTool()` 里加 case。
- 工具的 `description` 要写给「外部 AI」看：说清楚什么时候该调它、返回什么。不要写项目内部黑话。

## 约束

- 不引入新依赖、不加数据库表。
- 这个工具内部不调用 LLM。
- 不改动现有的 14 个工具。
- 遵循 `mcp-server.ts` 现有代码风格（zod schema 校验入参、`formatResponse` 包装输出）。

## 验收标准

- `npx tsc --noEmit` 在 `brain-server` 通过。
- `get_decision_context` 出现在 `listTools()` 返回里，描述面向外部 AI。
- 给定一个 `situation`，返回结构包含 `principles` / `relevantMemories` / `conflicts` / `graphContext` 四块。
- 数据库里没有冲突关系时，`conflicts` 返回空数组而不是报错。

## 完成后

在 `docs/progress/` 下新建 `2026-05-21-decision-context-tool.md`，内容包含：
任务目标、改动文件清单（每文件一句话）、关键实现说明、自测结果（命令+结果）、已知遗留。
