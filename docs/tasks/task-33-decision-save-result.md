# Task 33: 决策助手"保存这次决策"

## 背景

[[task-22-decision-assistant-standalone]] 做了独立的决策助手页面。用户输入情境 → AI 返回三列结果（适用原则 / 相关历史 / 潜在冲突）。

**但分析结果不沉淀回图谱**——下次类似查询时这次的决策本身不会被纳入"历史"参考。这造成：

- 用户做过的决策不能累积成"决策原则"
- AI 跨会话看不到"上次我帮用户决定过什么"
- 决策助手的产出价值"用完即丢"

## 目标

决策助手三列结果出来后，让用户能"保存这次决策的结论"为一个 `decision` 类型的实体，建立到引用过的原则/历史的关系，下次能被检索到。

成功标准：

1. 决策助手结果区下方加一个"我已决定 → 保存这次决策"按钮
2. 点击 → 弹一个小输入框 "你最终决定是什么？（一两句话）"
3. 输入后 → 调 brain-server 保存：
   - 新建 entity（type: 'decision', name: 用户输入的决策摘要, description: 完整情境 + 决策）
   - 建关系：决策 entity → cited 原则/历史 entities 用 `decision_referenced` 关系
   - 入档 archival memory 备查
4. 保存成功后 toast 提示 + 决策助手关闭 + 图谱聚焦新创建的决策节点
5. 下次类似情境查 `get_decision_context` 时这次决策会出现在"相关历史"里

## 涉及文件

- `desktop-daemon/src/components/DecisionAssistant.tsx`
  - 结果区下方加"我已决定"按钮
  - 点击后展开输入区（不打开新弹窗，直接 inline）
  - 调 hook 保存
- `desktop-daemon/src/hooks/useDecisionContext.ts` 或新 hook `useSaveDecision`
  - 把保存逻辑封装：构造 entity + relationships → 调 brain-server
- `brain-server/src/api/handlers/mcp.ts` 或 `entities.ts`
  - 新增 `POST /api/decisions` handler，或复用 `add_entity` MCP 工具
  - 入参：`{ situation, conclusion, cited_entity_ids[] }`
  - 内部：创建 entity（type: 'decision'）+ 创建 `decision_referenced` 关系若干 + 写 archival
- `brain-server/src/shared-types.ts`
  - 如果 `decision` 不是已有 EntityType 之一，加进去
  - 如果 `decision_referenced` 不是已有 RelationshipType，加进去
- `desktop-daemon/src/locales/zh.ts` + `en.ts`
  - 加 `decision.save_button`、`decision.save_prompt`、`decision.save_success`、`decision.save_placeholder`

## 约束

- 决策保存**走 ingest 流程或者直接 add_entity**，不要发明新的 pipeline
- `decision_referenced` 关系是单向：decision → cited_entity（不要双向）
- 用户输入的"决定"短 → 自动 + situation 拼成完整 description 入档
- 没引用任何 cited entity 时也允许保存（一个孤立的决策点）
- 保存的 entity 也走 embedding pipeline（这样 next query 能向量召回）
- 保存后跳图谱聚焦时用 task-31 的脉冲动画（如果 task-31 完成了）
- 不要做"决策模板" / "导出决策"——MVP 不做
- 不要把决策做成可编辑——一旦保存就 immutable（如果用户后悔，单独删除再重新做）

## 验收标准

1. ✅ 决策助手提交后看到结果 → 下方有"我已决定"按钮
2. ✅ 点按钮 → 输入框展开，placeholder 引导 "（例如：选 zustand，因为它体积小且 Redux 团队推荐）"
3. ✅ 输入 "选 zustand" + 确认 → toast "决策已保存" → 助手关闭 → 主图谱聚焦新节点（红色 / 紫色，按 decision 类型颜色）
4. ✅ 数据库查：新增一个 entity (type='decision') + 引用过的 3 个原则 / 历史都有 `decision_referenced` 关系指向它
5. ✅ 下次再开决策助手输入类似情境 → 这次保存的决策出现在"相关历史"列
6. ✅ `cd brain-server && npm run build` 通过
7. ✅ `cd desktop-daemon && npm run build` 通过

## 进度文档

`docs/progress/2026-05-26-task-33-decision-save-result.md`

## 不要做的事

- 不要做"决策模板库"
- 不要做"分享决策给他人"
- 不要做"决策投票"
- 不要让决策类型也参与 decay（决策是 immutable 的，不衰减）
- 不要在决策保存时强制要求引用至少一个 cited entity
