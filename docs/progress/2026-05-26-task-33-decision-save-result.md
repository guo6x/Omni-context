# Task 33 Progress: 决策助手"保存这次决策"

**日期:** 2026-05-26
**状态:** ✅ 完成

## 变更文件

1. `brain-server/src/shared-types.ts` — 向 EntityType 添加 `'decision'`，向 RelationshipType 添加 `'decision_referenced'`
2. `brain-server/src/mcp-tools.ts` — 添加 `SaveDecisionSchema`，更新 zod 枚举，注册 `save_decision` 工具
3. `brain-server/src/api/handlers/mcp.ts` — 添加 `save_decision` 处理逻辑
4. `desktop-daemon/src/hooks/useDecisionContext.ts` — 添加 `saveDecision()` 函数
5. `desktop-daemon/src/components/DecisionAssistant.tsx` — 保存按钮 + 内联输入 + 保存流程
6. `desktop-daemon/src/locales/zh.ts` — 5 个新 i18n 键（中文）
7. `desktop-daemon/src/locales/en.ts` — 5 个新 i18n 键（英文）

## 构建验证

- `cd brain-server && npm run build` ✅ 通过
- `cd desktop-daemon && npm run build` ✅ 通过

## 实现细节

### save_decision API (brain-server)
- 入参: `{ situation, conclusion, cited_entity_ids[] }`
- 创建 `type: 'decision'` 实体，name=结论摘要，description=完整情境+决策
- 生成 embedding 向量（确保下次搜索可召回）
- 创建 `decision_referenced` 关系：decision → 每个被引用的实体
- 写入 archival memory（含 embedding，importance=7）
- 返回创建的实体

### 前端流程
1. 决策结果出现后，底部显示"我已决定"按钮
2. 点击展开内联输入区（textarea + 取消/确认按钮）
3. 确认后调用 `saveDecision(situation, conclusion, citedIds)`
4. 成功 → Toast "决策已保存" → 关闭助手 → 聚焦新节点

### 约束合规
- 走 `add_entity` 流程（直接调用 ctx.db.addEntity）
- `decision_referenced` 单向：decision → cited_entity
- 允许无引用实体时保存
- 保存的实体走 embedding pipeline
- 决策 immutable（保存后不可编辑）
