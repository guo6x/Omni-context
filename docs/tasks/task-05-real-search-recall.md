# Task 05: 把"搜索 / 决策"功能接通——记忆能被真正找回

## 背景

排查发现：当前 UI 上的「决策 / 查询」按钮（`handleDecision()` in `desktop-daemon/src/app/page.tsx:251`、`triggerDecision()` in `desktop-daemon/src/hooks/useOmniContext.ts:93`）是个**假动作**——只是显示 HUD "处理中" → 1.5 秒后改成"成功"，**没真的去 brain-server 查任何东西**。

这是 AI 记忆类产品最致命的缺失：用户能往里塞文档、抓屏，但**永远找不出来**。

brain-server 后端实际上有完整的检索 API（已确认存在）：

- `GET /api/entities/search?q=<query>` — 按名字 / 描述检索实体
- `POST /api/memory/archival/search` — 长期记忆（archival）的向量 + 关键词混合搜索
- `POST /api/memory/core/search` — 核心记忆搜索

UI 没接。

## 目标

让用户可以**搜出自己的记忆**：

1. 主窗口加一个常驻搜索入口（顶部 header 中央的搜索框，或者左上角"放大镜"按钮点开浮层）
2. 输入关键词 → 同时调三个后端 API → 结果分组展示（实体 / archival 长期记忆 / 核心记忆）
3. 点击结果项：
   - 实体 → 跳到图谱并高亮该节点（图谱已有 selectedNode 机制，复用）
   - archival / core memory → 弹出详情卡片，显示原文内容、tags、importance、最近访问时间
4. 支持空查询提示（最近访问的实体 / 重要 archival）
5. 支持快捷键 `Ctrl/Cmd + K` 唤起搜索框（参考 GitHub / Linear / VS Code）

## 涉及文件

- `desktop-daemon/src/components/SearchPalette.tsx`（新建）
  - 类似命令面板（Spotlight 风格）的浮层组件
  - 顶部一个 input，下面是分组结果列表
  - ↑↓ 选中、Enter 跳转、Esc 关闭
- `desktop-daemon/src/hooks/useSearchMemory.ts`（新建）
  - 封装搜索逻辑：debounce 300ms → 并发调三个 API → 结果归一化
  - 暴露 `{ query, setQuery, results, isLoading, hasError }`
- `desktop-daemon/src/app/page.tsx`
  - header 区加一个搜索按钮（图标 + 提示 "搜索记忆 (Ctrl+K)"）
  - 挂 `SearchPalette` 浮层（受 `showSearchPalette` state 控制）
  - 绑定 `Ctrl/Cmd+K` 全局快捷键打开浮层
  - 把现有 `handleDecision` 改成「打开搜索浮层」而不是 1.5 秒假动作
- `desktop-daemon/src/components/GraphViewer.tsx`
  - 暴露 "focus 到指定 entityId" 的方法（props 加 `focusEntityId` + useEffect 处理）
- `desktop-daemon/src/hooks/useOmniContext.ts`
  - 改 `triggerDecision`：要么删掉，要么改成开搜索浮层的快捷调用
- `desktop-daemon/src/locales/zh.ts` + `en.ts`
  - 加 i18n key：`search.placeholder`、`search.no_results`、`search.section_entities`、`search.section_archival`、`search.section_core`、`shortcuts.open_search` 等

## 约束

- **三个 API 的请求载荷**先实测一遍再写：
  - `GET /api/entities/search?q=<query>&limit=20` —— 估计是 query 参数，看 `brain-server/src/api/handlers/entities.ts` 实际签名
  - `POST /api/memory/archival/search` —— 应是 `{ query, limit, useEmbedding? }`，看 `brain-server/src/api/handlers/memory.ts`
  - `POST /api/memory/core/search` —— 同上
  - **写 task 之前先读这三个 handler，把真实的入参 / 返回结构抄进 hook**

- **不修改 brain-server 后端代码**。仅 UI 接现有 API。

- 三个 API 并发调用用 `Promise.all`，单个失败不影响其他结果展示。

- Debounce 300ms 是为了避免敲一个字就发请求。

- 长 query 截断到 200 字符（避免有人粘大段文本）。

- 搜索结果**有 embedding 评分时按评分排，没有时按 last_accessed 排**。

- 浮层风格跟现有 SettingsPanel / EmptyState 的 glass-panel 一致。

- 不引入第三方 search UI 库（不要 cmdk 之类的）。手写一个就够。

- **Ctrl/Cmd+K** 不要跟现有快捷键冲突——检查 `desktop-daemon/src/hooks/useKeyboardShortcuts.ts` 已注册的有哪些。

## 验收标准

1. ✅ 主窗口 header 能看到一个搜索按钮 / 搜索框入口
2. ✅ 按 `Ctrl+K` 唤起搜索浮层
3. ✅ 在浮层 input 里输入关键词 → 300ms 后看到结果分组（实体 / archival / core）
4. ✅ 三组结果各显示 N 条（建议各 5 条），多的折叠
5. ✅ 用 ↑↓ 选中结果，Enter 跳转
6. ✅ 点击实体结果 → 浮层关闭 + 图谱视图聚焦到该节点（高亮 + 居中）
7. ✅ 点击 archival 结果 → 弹详情卡片显示原文 + 元数据
8. ✅ Esc 或点空白处关闭浮层
9. ✅ 空查询时显示"最近访问的实体"或者"开始输入以搜索"提示，不要白屏
10. ✅ 某个 API 失败时其他两组仍正常显示，UI 不崩
11. ✅ 之前那个 `handleDecision()` 的 1.5 秒假动作完全移除
12. ✅ `cd desktop-daemon && npm run build` 无 type 错误

## 构建与运行

```powershell
cd D:\AI_code\Omni-context\omni-context-release\desktop-daemon
npm run tauri:dev
```

测试数据：可以先用 EmptyState 里的 "加载示例图谱" 按钮塞 24 个实体进去，然后搜 "GraphRAG" / "Hexagonal" 之类的关键词验证。

## 进度文档

完成后写到 `docs/progress/2026-05-25-task-05-real-search-recall.md`，包含：

1. **任务目标**
2. **改动文件清单**
3. **三个 search API 的实际入参 / 返回结构**（这是执行 AI 第一步要确认的事情，写进进度文档方便后续维护）
4. **关键取舍**（特别是：结果排序策略、空查询的兜底逻辑、跳转图谱节点的实现）
5. **自测结果**（上面 12 条）
6. **遗留问题**（如：是否要支持过滤器、是否要支持高亮搜索词、是否要支持搜索历史）

## 不要做的事

- 不要做"搜索历史 / 最近搜索 / 收藏搜索"这种二级功能——MVP 先把核心打通
- 不要为了"漂亮"做粒子/激光/扫描线动画
- 不要在 brain-server 那边加新接口——现有的够用
- 不要做语义搜索的本地实现——直接走后端 archival/search 接口（它已经支持 embedding）
- 不要把搜索结果做成无限滚动——分组各显示前 N 条，多了折叠就行
