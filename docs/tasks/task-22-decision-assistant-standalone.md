# Task 22: 决策模式重构为独立"决策助手"页面 + Ctrl+Shift+K

## 背景

[[task-12-decision-context-wire]] 把决策上下文功能塞进了 SearchPalette 浮层（右上角一个 Compass toggle 按钮），但实际使用体验有问题：

1. **入口不可发现**：用户按 Ctrl+K 打开搜索浮层，右上角的 Compass 图标根本没人会去点
2. **placeholder 不变**：切到决策模式还是显示"搜索记忆..."
3. **input 是单行小框**：决策场景天然 query 长（几十字描述情境），但 UI 是 Spotlight 体感
4. **结果挤**：6 类结果（决策 3 + 常规 3）塞一个浮层，认知负担重
5. **缺少使用引导**：用户切过去不知道该说啥

决策类查询的心理模型跟"快速搜索"完全不同：
- 决策查询天然慢（LLM 跑几秒到十几秒）
- 信息量大（原则 + 历史 + 冲突，每类多条）
- 用户需要"专注空间"思考，而不是浮层快进快出

**正确做法**：从 SearchPalette 里拆出来，做成**独立全屏覆盖层**，专门的"决策助手"视图。

## 目标

把决策上下文功能从 SearchPalette **完全移除**，重建为独立的"决策助手"覆盖层视图，通过 `Ctrl/Cmd+Shift+K` 唤起。

### A. 新组件 `DecisionAssistant`

布局：

```
┌─ 决策助手 ────────────────────────── [×] ┐
│                                          │
│  你正在做什么决策？                       │
│  ┌────────────────────────────────────┐ │
│  │ [大输入框 multiline ~5 rows]       │ │
│  │  placeholder: "例如：在选 React    │ │
│  │  状态管理库时，团队有没有定过原则？"│ │
│  └────────────────────────────────────┘ │
│  Ctrl+Enter 提交 / Esc 关闭              │
│                                          │
│  ─────────  分析结果  ─────────          │
│                                          │
│  ┌──────────┬──────────┬──────────┐    │
│  │ 适用原则 │ 相关历史 │ 潜在冲突 │    │
│  │   (3)    │   (5)    │   (2)    │    │
│  ├──────────┼──────────┼──────────┤    │
│  │ • ...    │ • ...    │ • ...    │    │
│  │ • ...    │ • ...    │ • ...    │    │
│  │ • ...    │ • ...    │          │    │
│  └──────────┴──────────┴──────────┘    │
│                                          │
└──────────────────────────────────────────┘
```

要点：
- **全屏 modal**（不是 page，避免路由复杂度），覆盖整个主窗口，深色半透明背景
- 输入框是 5 行 textarea，自动聚焦
- `Ctrl/Cmd + Enter` 提交（不是普通 Enter，因为 textarea 要支持换行）
- 三列结果区——每列独立 scrollable，column header 显示分类名 + 计数
- 提交后输入框上方显示"分析中..."spinner，结果出来填充三列
- 三列里每条项目可点击 → 跳转主图谱聚焦该实体（关闭决策助手）
- 顶部右上 ×、键盘 Esc 关闭
- 整个面板沿用 glass-panel + cyan 强调色风格

### B. 入口

1. **快捷键** `Ctrl/Cmd + Shift + K`（用户可在设置里改）
2. Header 区加一个独立按钮 ⚖️ / 🧭 "决策助手"（lucide `Scale` 或 `Compass`）
3. 移除 SearchPalette 右上角的 Compass toggle 按钮

### C. 从 SearchPalette 移除决策代码

- `SearchPalette.tsx`:
  - 删除 `searchMode` state、localStorage 持久化
  - 删除 toggle 按钮
  - 删除 `searchMode === 'decision'` 分支
  - `flattenedItems` 只保留 entity / archival / core
  - 删除 principle/history/conflict 三个类型支持（因为 SearchPalette 不再展示这些）
- `useSearchMemory.ts`:
  - **保留** decision_context 调用能力——抽出来给新 `useDecisionContext` hook 用
  - 移除 `searchMode` 参数，恢复为简单的并发三路搜索

### D. 新 hook `useDecisionContext`

- 入参：query
- 输出：`{ isLoading, error, result: { applicable_principles, relevant_history, potential_conflicts } | null, submit(query) => Promise }`
- 不做 debounce（决策提交是显式行为，用户点按钮才发）
- 实现：POST `/api/mcp/tool/get_decision_context`，`{ arguments: { situation: query, limit: 5 } }`

## 涉及文件

- `desktop-daemon/src/components/DecisionAssistant.tsx`（新建）
- `desktop-daemon/src/hooks/useDecisionContext.ts`（新建，从 useSearchMemory 拆）
- `desktop-daemon/src/hooks/useSearchMemory.ts`（精简，移除 decision 相关）
- `desktop-daemon/src/components/SearchPalette.tsx`（删除 decision 分支）
- `desktop-daemon/src/app/page.tsx`
  - 加 `showDecisionAssistant` state
  - 注册 `Ctrl/Cmd + Shift + K` 快捷键
  - Header 加按钮
  - 挂 `<DecisionAssistant />`
- `desktop-daemon/src/hooks/useKeyboardShortcuts.ts` 或快捷键 hook
  - 增加 `open_decision_assistant` 快捷键
- `desktop-daemon/src/locales/zh.ts` + `en.ts`
  - 删除：`search.mode_decision`、`search.mode_normal`、`search.decision_hint_short`（task-12 加的，现已不用）
  - 新增：
    - `decision.title` = "决策助手"
    - `decision.placeholder` = "你正在做什么决策？例如：在选 React 状态管理库时..."
    - `decision.submit` = "开始分析"
    - `decision.submit_hint` = "Ctrl+Enter 提交"
    - `decision.section_principles` / `section_history` / `section_conflicts`（之前 search.* 下的搬过来）
    - `decision.analyzing` = "AI 正在分析..."
    - `decision.no_result_principles` = "暂无适用原则" 等三个空状态
    - `header.open_decision_assistant` = "决策助手"
    - `shortcuts.decision_assistant_desc` = "唤起决策助手"

## 约束

- **后端接口不变**——继续用 `POST /api/mcp/tool/get_decision_context`
- 不要把决策助手做成 Next.js 独立 route（路由设计复杂度高）—— modal 覆盖层就够
- modal 打开时**主窗口的图谱画布要继续运行**（不要 unmount，否则关掉决策助手回主窗口图谱重置物理模拟）
- 提交后用户改输入再次提交：清掉旧结果再开始（避免新旧混淆）
- Ctrl+Shift+K 快捷键如果跟其他快捷键冲突，加进 `useKeyboardShortcuts` 的 DEFAULT_SHORTCUTS 里走统一管理
- 移除 SearchPalette 里的 decision 代码时要彻底——不要留死代码（"以防万一"的注释也别留）

## 验收标准

1. ✅ 按 `Ctrl/Cmd + Shift + K` → 决策助手浮层全屏覆盖
2. ✅ 自动聚焦输入框，placeholder 是引导性文案
3. ✅ 输入"在选 React 状态管理库时怎么权衡 zustand vs jotai" + Ctrl+Enter → 显示分析中 → 三列结果填充
4. ✅ 三列各自能滚动，header 显示计数
5. ✅ 点结果项目 → 决策助手关闭 + 主图谱聚焦该实体
6. ✅ Esc / × 关闭
7. ✅ Header 区有"决策助手"独立按钮，hover 显示快捷键
8. ✅ SearchPalette（Ctrl+K）里**不再有 Compass toggle 按钮**
9. ✅ SearchPalette 结果只有 entity / archival / core（恢复 task-12 前的状态）
10. ✅ 后端 LLM 没配 / 接口失败 → 决策助手显示友好错误，不 crash
11. ✅ 中英 i18n 都对
12. ✅ `npm run build` 通过

## 进度文档

`docs/progress/2026-05-26-task-22-decision-assistant-standalone.md`

包含：
- 决策助手新组件的结构 / 状态机
- 从 SearchPalette / useSearchMemory 移除的代码清单（用 diff 行数说明）
- useDecisionContext 设计
- 自测结果（含截图或文字描述）
- 遗留问题

## 不要做的事

- 不要在决策助手里加"保存这次决策"功能——超出范围
- 不要给决策助手加聊天式多轮交互——单次 query 单次结果
- 不要做"决策模板"（"选技术方案" / "选库" 之类）——MVP 不做
- 不要让决策助手打开时同时打开 SearchPalette（两个浮层互斥）
- 不要复用 SearchPalette 的样式继承——独立组件独立样式（共享 glass-panel 基类即可）
