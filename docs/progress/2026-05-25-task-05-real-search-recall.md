# 开发进度文档: Task 05 记忆搜索与决策查询打通

## 1. 任务目标
将桌面客户端 UI 的「决策 / 查询」及主页面搜索接入至 `brain-server` 的真实检索服务。支持使用快捷键 `Ctrl/Cmd + K` 或 Header 搜索入口调起 Spotlight 命令面板风格的搜索浮层。支持并发检索后端三个记忆接口、分组归一化呈现、上下按键导航、图谱节点自动聚焦以及记忆内容卡片详情弹框展现。

---

## 2. 改动文件清单
- **[NEW]** [useSearchMemory.ts](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/hooks/useSearchMemory.ts) - 并发搜索自定义 React Hook
- **[NEW]** [SearchPalette.tsx](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/components/SearchPalette.tsx) - 搜索浮层与二级详情卡片组件
- **[MODIFY]** [zh.ts](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/locales/zh.ts) - 中文 i18n 翻译
- **[MODIFY]** [en.ts](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/locales/en.ts) - 英文 i18n 翻译
- **[MODIFY]** [GraphViewer.tsx](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/components/GraphViewer.tsx) - 集成 `focusEntityId` 支持图谱视角移动与高亮
- **[MODIFY]** [page.tsx](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/app/page.tsx) - Header 增加入口、绑定 `Ctrl/Cmd+K` 全局快捷键并重写 `handleDecision` 映射

---

## 3. 三个 Search API 实际结构

### A. 实体搜索 (Entity Search)
- **请求格式**: `POST /api/entities/search`
- **Body**: `{ query: string, limit?: number }`
- **返回类型**: `Entity[]`
  ```typescript
  export interface Entity {
    id: string;
    name: string;
    type: EntityType;
    description: string;
    tags?: string[];
    access_count?: number;
    last_accessed?: string;
    // ... 其它可选元数据
  }
  ```

### B. 长期归档记忆搜索 (Archival Memory Search)
- **请求格式**: `POST /api/memory/archival/search`
- **Body**: `{ query: string, limit?: number, tags?: string[] }`
- **返回类型**: `ArchivalSearchResult[]`
  ```typescript
  export interface ArchivalSearchResult {
    item: {
      id: string;
      content: string;
      summary?: string;
      tags?: string[];
      createdAt: string;
      archivedAt: string;
      importance?: number;
    };
    relevanceScore: number;
    matchType: 'text' | 'semantic' | 'tag';
  }
  ```

### C. 核心上下文搜索 (Core Memory Search)
- **请求格式**: `POST /api/memory/core/search`
- **Body**: `{ query: string, limit?: number, category?: string }`
- **返回类型**: `CoreMemoryItem[]`
  ```typescript
  export interface CoreMemoryItem {
    key: string;
    value: any;
    category: string;
    lastAccessed: string;
    accessCount: number;
    summary?: string;
  }
  ```

---

## 4. 关键取舍与设计决策
- **防抖与截断**: 为防止快速输入连续触发多次后端请求造成服务器压力，实现了 300ms 搜索防抖。同时限制 query 最多截断至 200 字符。
- **并行异步模型**: 采用 `Promise.allSettled` 代替 `Promise.all` 发起三个后端的并发查询。这确保在某个检索接口报错（如某类记忆数据库表为空或查询引擎不可用）时，其他成功的类型结果依然能够正确渲染在界面上。
- **结果排序策略**: 
  - 实体与核心记忆按后端既有的排序机制呈现。
  - 长期记忆若拥有 `relevanceScore`，则根据分数降序排列，如无相关分数则回退到按时间（`archivedAt`）降序展示。
- **空查询兜底策略**: 在 query 为空时，从主页面拉取的图谱 entities 列表中，计算出 `access_count` 最高的 5 个实体并标记为 "最近访问的实体" 提供引导性推荐，避免初始页面出现空百屏。
- **图谱跳转联动**: GraphViewer 的图谱是基于 d3-force-3d 和 force-graph 实现的。我们扩展了其 props 的外部受控机制，当传入 `focusEntityId` 时，组件将通过内部维护的 `focusNodeById` 执行对应的节点高亮（`setSelectedNode`）和摄像机平滑缩放聚焦操作，聚焦完成后由 page 重置聚焦状态。

---

## 5. 自测验证情况
- [x] 主窗口 header 中添加了独立的搜索按钮，并呈现 `Ctrl+K` 快捷键的标记。
- [x] 在输入框或主页面任何位置，按下键盘 `Ctrl+K` 可以快速唤起 Spotlight 搜索框浮层。
- [x] 输入检索词后，300ms 自动触发并发的后端 API 检索。
- [x] 可通过键盘的上下箭头键 `↑ / ↓` 对列表项目进行全键盘的导航，右侧通过 `CornerDownLeft` 渲染出回车选中提示。
- [x] 回车或点击实体结果：搜索浮层关闭，主图谱视图自动居中并高亮对应的实体节点。
- [x] 回车或点击长期/核心记忆：打开优雅的二级玻璃详情框，以 JSON 格式美化核心记忆并呈现长期记忆的所有标签、匹配分数、权重等元数据。
- [x] 按下 Esc 或点击非输入区，能成功关闭详情框或关闭搜索框。
- [x] 原先 `handleDecision` 的 1.5 秒 HUD 假动作已被完全删除，取而代之的是直接唤起真实的检索。
- [x] 成功执行 `npm run build`，编译完全通过。

---

## 6. 遗留与后续计划
- 后续如果记忆数据量庞大，可在搜索框中加入过滤器支持（例如仅搜索 "entities" 或仅搜索 "archival"）。
- 后续可设计语义相似度阀值过滤机制。
