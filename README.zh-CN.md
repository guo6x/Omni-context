# Omni-Context

<p align="center"><a href="README.md">English</a> · <strong>简体中文</strong></p>

> **Omni-Context 是面向长期运行 AI Agent 的本地持久上下文与决策智能层。你的记忆与决策只留在你的机器上。**

<p align="center">
  <img src="docs/landing/assets/social-preview.svg" alt="Omni-Context" width="720">
</p>

[![Build](https://img.shields.io/github/actions/workflow/status/guo6x/Omni-context/build.yml?branch=main)](https://github.com/guo6x/Omni-context/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

<p align="center">
  <a href="https://github.com/guo6x/Omni-context/releases/latest"><strong>下载 Windows 版</strong></a> ·
  <a href="#工作原理">工作原理</a> ·
  <a href="https://guo6x.github.io/Omni-context/">介绍页</a>
</p>

> **产品基线状态** —— `product/omni-v3-unified-r1` 是在 Goal 23.5 仓库收口中提升进 `main` 的历史工程基线，`main` 现在作为稳定开发主线。工程起点 `17dc1d0` **不是**正式实验冻结产品：原 Targeted-7 门禁**失败**，当前 selector **无正式性能证明**。详见 [docs/PRODUCT-BASELINE.md](docs/PRODUCT-BASELINE.md) 与 [docs/tag-remediation-proposal.md](docs/tag-remediation-proposal.md)。

---

## 为什么需要 Omni-Context

**你的 AI 每次对话都把你忘干净了。** ChatGPT 的记忆很浅，Cursor 的上下文只活一个会话，Claude 跨项目不记得你。

**云端记忆意味着把数据放在别人的服务器上。** Mem0、Letta、Zep —— 都很出色，但都云优先。你的上下文与决策跑在他们的基础设施上。

**Omni-Context 是面向长期运行 AI Agent 的本地持久上下文与决策智能层。** 它在你的机器上维护知识图谱、检索索引与决策历史，让 Agent 可以基于你的真实上下文工作，而不是从一个空白对话窗口开始。

**不止是记忆存储。** 大多数"AI 记忆"工具只是高级数据库。Omni-Context 还记录决策 —— 上下文、推理、谱系与结果 —— 并为 Agent 的选择提供证据支持。MCP 只是当前的一种集成面，而不是产品本身。

---

## 工作原理

```
捕获 / 来源
       ↓
本地持久上下文
       ↓
知识图谱 + 检索
       ↓
证据 / 决策智能
       ↓
集成面
       ↓
AI Agent
```

1. **捕获** —— 截图、拖入文件、剪藏网页，或按一个物理按钮。任何东西都行。
2. **抽取** —— OCR + LLM 流水线把实体、关系与核心原则抽取进本地知识图谱。
3. **推理** —— 决策上下文、谱系与结果让 Agent 获得带证据限定的上下文，而不是原始记忆倾倒。
4. **集成** —— 当前 AI 客户端通过 MCP 访问；CLI/API 适配器正在开发中。

---

## 当前能力（Today）

- 本地持久记忆（你硬盘上的 SQLite —— 无账号、无服务器）
- 由实体、关系与核心原则构成的知识图谱
- 混合检索（全文 + 向量 + 图谱遍历）
- 时间 / 来源感知的上下文
- 包含原则、先例与冲突的决策上下文
- 已保存的决策与决策谱系
- 结果记录（校准、教训、后续行动）
- MCP 集成（当前的集成面）
- 桌面捕获 / 本地桌面应用

## 开发中（Active development / Roadmap）

正在 `dev/goal24-cli-skills` 上积极开发：

- 传输无关的能力
- Skills
- CLI 适配器
- 证据门控执行
- 审批边界
- 已验证的结果

以上路线图项目目前**均不可用**。

---

## 它有什么不一样

- **不是笔记应用** —— 它是上下文与决策层。你的工具不需要各自的记忆系统，它们共享同一个大脑。
- **不是云端** —— 数据存在你硬盘上的 SQLite 里。无需账号、无服务器，数据永不离开你的机器。
- **不绑定单一 AI** —— 目前基于 MCP；Claude Desktop、Cursor、Cline 等 MCP 客户端共享同一份记忆。
- **主动而非被动** —— 智能体会主动扫描你的图谱，找出你已经遗忘的关联并主动浮现。
- **会质疑你的认知** —— 盲区检测告诉你漏了什么，反共识洞见挑战你的已有假设。你的图谱会反问你。

---

## 工具

当前 MCP 接口暴露 26 个工具，按用途分组。权威数量由 [`mcp_tool_manifest.json`](`mcp_tool_manifest.json`) 生成。

### 决策与检索 —— "大脑"

- `get_decision_context` —— 给定一个情境，一次调用返回相关原则、先例、冲突与图谱邻域
- `unified_memory_search` —— 一次自然语言查询完成三层融合检索（全文 + 向量 + 图谱遍历）
- `vector_search` —— 纯语义向量检索；即使措辞不同也能找到概念相似的实体
- `ask_memory` —— 提出一个问题，获得以你的图谱为依据的综合回答
- `graph_answer` —— 基于图谱的问答，并引用来源实体
- `search_entities` —— 按名称 / 描述关键词查找实体
- `get_core_context` —— 获取与某个主题相关的核心原则（不指定主题时返回精简总览）
- `get_entity` —— 按 ID 获取一个实体的完整信息及其全部关系
- `get_graph_neighborhood` —— 获取某个实体周围的 N 跳子图
- `list_entities` —— 列出实体，可按类型过滤

### 捕获与写入 —— 让记忆生长

- `record_capture` —— 保存一个捕获快照（截图 / 剪贴板 / 文本）
- `extract_from_capture` —— 从一段文本自动抽取实体、关系与核心原则
- `add_entity` —— 创建新实体
- `add_relationship` —— 连接两个已有实体
- `update_entity` —— 修改实体的名称 / 描述 / 标签 / 元数据
- `set_core_principle` —— 记录或更新一条核心原则

### 决策流水线 —— 沉淀思考

- `save_conclusion` —— 持久化一条值得记住的结论
- `save_decision` —— 记录一个决策及其上下文与推理
- `analyze_decision` —— 分析决策的一致性与潜在冲突
- `discuss_decision` —— 从多个角度探讨一个决策
- `get_decision_lineage` —— 追溯一个决策随时间的演变
- `record_decision_outcome` —— 记录已保存决策的观察结果（校准、教训、后续行动）

### 图谱维护

- `merge_entities` —— 合并重复实体
- `delete_entity` —— 删除一个实体
- `get_stats` —— 实体 / 关系数量、类型分布
- `get_decay_report` —— 哪些记忆已越过衰减阈值（清理候选）

完整参数 schema：见 [`docs/MCP-INTEGRATION.md`](docs/MCP-INTEGRATION.md)。

---

## 安装

### Windows

从 [Releases](https://github.com/guo6x/Omni-context/releases/latest) 下载 `Omni-Context-Setup-x64.msi`，双击即可。完全离线 —— 已内置 Node.js 运行时和嵌入模型。

### macOS / Linux

构建脚本已就绪。有相应硬件的社区贡献者，欢迎提 PR。

### 从源码构建

```bash
git clone https://github.com/guo6x/Omni-context.git
cd Omni-context
npm run install:all
npm run package
```

---

## Omni 与其他方案对比

|                    | Omni | ChatGPT Memory | Mem0 | Letta | Obsidian |
|--------------------|------|----------------|------|-------|----------|
| 本地运行           | ✓    | ✗              | ✗    | ✓     | ✓        |
| 原生 MCP           | ✓    | ✗              | ✗    | ✗     | ✗        |
| 知识图谱           | ✓    | ✗              | 部分 | ✓     | 手动     |
| 跨 AI 共享         | ✓    | ✗              | ✓    | ✗     | ✗        |
| 数据归你所有       | ✓    | ✗              | ✗    | ✓     | ✓        |
| 离线优先           | ✓    | ✗              | ✗    | ✗     | ✓        |

---

## 社区

- [Issues](https://github.com/guo6x/Omni-context/issues) —— Bug、功能需求
- [Discussions](https://github.com/guo6x/Omni-context/discussions) —— 想法、问答
- [参与贡献](./docs/BUILDING.md) —— 开发环境搭建、架构概览

---

MIT 许可证。为想让 AI 真正了解自己的人而造。
