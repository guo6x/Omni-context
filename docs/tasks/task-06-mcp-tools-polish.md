# 任务 06：打磨 MCP 工具面，让外部 AI 真能用

> 阶段 2（数字脑子）的第二个任务。
> 项目根目录：`omni-context-release/`。文件：`brain-server/src/mcp-server.ts`。

## 背景

MCP server 是 Omni-Context 对外的「数字脑子」接口——外部 AI（Cursor、Claude 等）通过它接入
知识图谱。当前工具面有两个问题，让外部 AI 用不顺：

1. **`vector_search` 对外不可用**：它要求调用方传入一个 384 维向量数组（`embedding` 参数）。
   外部 AI 生不出这个向量，这个工具等于废的。
2. **工具描述是写给项目内部的**：好几个工具的 `description` 带内部黑话，对外部 AI 是噪音甚至误导。
   例如 `get_graph_neighborhood` 写着「（用于3D可视化）」、`record_capture` 写着「核心入口」。

## 要做的事

### 1. 修 `vector_search`：改成接受文本

把 `vector_search` 的入参从 `embedding`（number 数组）改成 `query`（字符串）：
- 入参：`{ query: string, limit?: number }`。
- 实现：用 `this.embeddingService.embed(query)` 在服务端生成向量，再调 `db.vectorSearch`。
  可参考 `unified_memory_search` 里已有的「embed → vectorSearch」写法。
- 同步更新 `listTools()` 里该工具的 `inputSchema` 和 zod 校验（如果有）。
- 用途定位：纯语义相似度搜索（与 `unified_memory_search` 的区别是不做文本/图谱融合）。

### 2. 重写所有工具的 description，面向外部 AI

逐个检查 `listTools()` 里 14 个工具（加上新的 `vector_search`、`get_decision_context`）的
`description`，按这个标准重写：

- 说清楚**这个工具什么时候该被调用**、**返回什么**。
- 删掉内部视角的话术：「核心入口」「用于3D可视化」「[核心壁垒]」「自动注入每次对话系统提示词」
  这类——外部 AI 不关心这些，它只想知道「我要做 X，该不该调这个」。
- 站在「一个接入了 Omni-Context 的外部 AI」的视角写。中英文均可，与现有 `get_decision_context`
  的描述风格保持一致即可。

参考：`get_decision_context` 的 description 已经是面向外部 AI 写的，可作范本。

## 约束

- 只改 `mcp-server.ts`。不动工具的实际功能逻辑（除了 `vector_search` 的入参）。
- 不增删工具（`vector_search` 是改造不是删除）。
- 不引入新依赖。
- 遵循现有代码风格。

## 验收标准

- `npx tsc --noEmit` 在 `brain-server` 通过。
- `vector_search` 入参是 `query` 字符串，内部自行生成向量。
- 14+ 个工具的 description 都不再含内部黑话，每条都讲清「何时用 + 返回什么」。

## 完成后

在 `docs/progress/` 下新建 `2026-05-21-mcp-tools-polish.md`，内容包含：
任务目标、改动文件清单、关键说明、自测结果（命令+结果）、已知遗留。
