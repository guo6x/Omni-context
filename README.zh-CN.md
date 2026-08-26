# Omni-Context

<p align="center"><a href="README.md">English</a> · <strong>简体中文</strong></p>

> **面向长期运行 AI Agent 的证据底座化决策控制（Evidence-grounded decision control）。**
> **本地优先、经读回核验、归你所有（Local-first, read-back verified, and owned by you）。**

<p align="center">
  <img src="docs/landing/assets/social-preview.svg" alt="Omni-Context" width="720">
</p>

[![Build](https://img.shields.io/github/actions/workflow/status/guo6x/Omni-context/build.yml?branch=main)](https://github.com/guo6x/Omni-context/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

<p align="center">
  <a href="https://github.com/guo6x/Omni-context/releases/latest"><strong>下载 Windows 版</strong></a> ·
  <a href="#当前状态">当前状态</a> ·
  <a href="https://guo6x.github.io/Omni-context/">介绍页</a>
</p>

> **产品基线状态** —— `product/omni-v3-unified-r1` 是在 Goal 23.5 仓库收口中提升进 `main` 的历史工程基线，`main` 现在作为稳定开发主线。工程起点 `17dc1d0` **不是**正式实验冻结产品：原 Targeted-7 门禁**失败**，当前 selector **无正式性能证明**。详见 [docs/PRODUCT-BASELINE.md](docs/PRODUCT-BASELINE.md) 与 [docs/tag-remediation-proposal.md](docs/tag-remediation-proposal.md)。

---

## Omni-Context 是什么

**Omni-Context 是面向长期运行 AI Agent 的证据底座化决策控制。**

> 让长期运行的 AI Agent
> 在行动前有证据资格，
> 行动时有明确授权，
> 行动后有现实核验；
> 现实不符合原判断时，
> 重新打开那次决策。

判断闭环：

```
证据资格 → 绑定 → 读回 → 重开
Qualify → Bind → Read-back → Reopen
```

Agent 已经会行动——写代码、开 issue、跑命令。但**记忆不是证据**（Agent 记住的只是
关于世界的陈述，不是经过验证的事实），**工具成功不等于结果真实**（退出码 0 不代表
世界真的按你的意图改变了）。Omni-Context 补上的就是这个缺口：行动前审定证据资格，
把执行绑定到为之负责的那次精确决策上，行动后读回现实，现实不符时重新打开那次决策。

- **记忆与知识图谱**是长期**证据底座（Evidence Substrate）**——回答"Agent 知道什么"。
  它们是产品的重要组成部分，被重新安置到判断闭环的底部，**没有被删除**。
- **MCP 只是接口面之一**，不是产品本身。
- **桌面端**是人类控制面：检查、批准、审计，并在必要时重新打开决策。

完整论点：[docs/goal24/narrative/thesis-note.zh-CN.md](docs/goal24/narrative/thesis-note.zh-CN.md) ·
产品愿景：[docs/PRODUCT-VISION.md](docs/PRODUCT-VISION.md)

---

## 当前状态

能力状态只用三种标签：**CURRENTLY_VERIFIED**（用户今天可直接使用）、**TARGET**（目标架构）、
**FUTURE**（未来规划）。"开发分支 runtime 已验证"不等于"今天可用"。治理语言冻结在
[docs/PRODUCT-VISION.md](docs/PRODUCT-VISION.md)（第 14 章）。

### A. 当前用户可直接使用（CURRENTLY_VERIFIED）

- 本地持久记忆——你硬盘上的 SQLite，无账号、无服务器
- 由实体、关系与核心原则构成的知识图谱
- 混合检索（全文 + 向量 + 图谱遍历）
- 时间 / 来源感知的上下文
- 包含原则、先例与冲突的决策上下文
- 已保存的决策、决策谱系与结果记录
- MCP 集成——26 个工具，数量以 [mcp_tool_manifest.json](mcp_tool_manifest.json) 为准
- 桌面捕获 / 本地桌面应用（GitHub Releases 提供 Windows 安装包）

### B. 开发分支 runtime 已验证（CP3–CP8 内部工程 Gate）

正在 `dev/goal24-cli-skills` 上开发。以下各项均有工程 Gate 证据，**但尚无任何
公开调用入口**——状态是 **runtime verified on development branch（开发分支 runtime 已验证）**，
不是 "available today"：

| 组件 | Gate 证据 |
|---|---|
| 受限执行 broker（spawn/kill/timeout、进程约束、输出上限） | [checkpoint3-security-gate.json](docs/goal24/checkpoint3-security-gate.json) — PASS |
| GitHub 只读 CLI 适配器（5 个语义能力、可执行文件钉定、零写绑定） | [checkpoint4-security-gate.json](docs/goal24/checkpoint4-security-gate.json) — PASS |
| Skills registry + importer（默认隔离、完整性校验） | [checkpoint5-security-gate.json](docs/goal24/checkpoint5-security-gate.json) — PASS |
| 证据资格 + surface guard（服务器自有资格、防伪造覆盖闭合） | [checkpoint6-security-gate.json](docs/goal24/checkpoint6-security-gate.json) — PASS |
| 批准绑定 + 风险策略（单次授权、重放防御） | [checkpoint7-security-gate.json](docs/goal24/checkpoint7-security-gate.json) — PASS |
| 结果读回 + 确定性 evaluator（受信 resolver、跨语言状态/观测向量） | [checkpoint8-security-gate.json](docs/goal24/checkpoint8-security-gate.json) — PASS（DRG1 前置已满足） |
| 真实非 synthetic E2E：一次经批准门控的 GitHub issue-close 闭环，针对真实 GitHub 且独立读回（exit 0 ⇒ PENDING ⇒ 读回 CLOSED ⇒ VERIFIED） | [drg2-authoritative-gate.json](docs/goal24/real-e2e/drg2-authoritative-gate.json) — PASS（DRG2 已满足） |

CP8 全量测试证据：Brain 1279 passed / 0 failed；Rust 206 passed / 0 failed / 7 ignored；
跨语言向量 26（状态）+ 35（观测），mismatch 0。

**Post-CP8 真实 E2E（开发分支已验证）：** 已在真实 GitHub 上演示一次真实、非 synthetic、经批准门控的 issue-close 闭环，并带独立读回——exit 0 不被当作成功（Outcome 保持 PENDING），直到受信的 `github.issue.read` 读回观测到 CLOSED、确定性 evaluator 返回 VERIFIED。这是 **internal runtime（内部运行时）** 证据：目前 **没有面向用户的 GitHub 自动化 CLI 功能**。详见 [docs/goal24/real-e2e/authoritative-real-e2e-proof.json](docs/goal24/real-e2e/authoritative-real-e2e-proof.json)。

### C. 内部控制面 / FUTURE —— 尚未发布

- `omctx` CLI（`ask` / `inspect` / `approve` / `verify` / `history`）
  —— **CURRENTLY_VERIFIED_INTERNAL**。`approve` 与 `verify` 分别需要
  Desktop 短时 control session，绝不启动执行、重试写入或回滚；package
  仍为 private，尚未作为 npm 用户安装面发布。详见
  [docs/goal24/narrative/cli-product-surface.md](docs/goal24/narrative/cli-product-surface.md)。
- `omctx reopen` 用户 UX —— **FUTURE**（runtime 未实现）。
- 外部记忆适配器（如 MindMemOS、basic-memory）—— **FUTURE**，只能经
  EvidenceProvider Adapter → 资格审定 → Evidence Guard 接入；外部 Memory 不会自动
  成为证据权威。
- 多 runtime 适配器（如 OpenClaw、NemoClaw、Claude Code）—— **FUTURE**，仅作为
  capability transport；runtime 不得获得决策 / 批准 / 结果权威。

> **DRG v2**：在至少一个真实、非 synthetic、用户能理解的 E2E 成立之前，
> 对外 capability 声明冻结为「有 repo + Gate 证据支持的当前事实」。
> 其余一律显式标注 **TARGET** / **FUTURE** / **DESIGNED TO**。
> Omni 是 *designed to* 站在异构记忆/证据源与异构 Agent runtime 之间——
> **不**宣称今天就能对接任意 memory OS 或任意 runtime。

---

## 工作原理

```
证据获取（捕获 / 浏览器插件 / 桌面捕获 / 导入）
       ↓
证据底座（本地知识图谱 + 记忆 + 检索）
       ↓
判断与权威核心（资格 → 决策 → 批准）
       ↓
受控执行（受限 broker → 能力适配器）
       ↓
读回 → 结果 → 重开 / 修订
```

1. **捕获** —— 截图、拖入文件、剪藏网页，或按一个物理按钮。任何东西都行。
2. **抽取** —— OCR + LLM 流水线把实体、关系与核心原则抽取进本地知识图谱。
3. **资格与决策** —— 证据资格审定判断"这些信息现在还能不能信、够不够格支撑行动"。
4. **执行与核验** —— 被批准的语义能力经受限 broker 执行，然后读回现实、与当初支撑决策的预期比对。

---

## 它有什么不一样

- **不是笔记应用** —— 它是决策控制层。工具不需要各自的记忆系统，共享同一份证据底座与同一个权威核心。
- **不是云端** —— 数据存在你硬盘上的 SQLite 里。无需账号、无服务器，数据永不离开你的机器。
- **不绑定单一 AI** —— 目前基于 MCP；MCP 客户端共享同一份记忆。MCP 是接口面，不是产品。
- **主动而非被动** —— 智能体会主动扫描你的图谱，找出你已经遗忘的关联并主动浮现。
- **会质疑你的认知** —— 盲区检测告诉你漏了什么，反共识洞见挑战你的已有假设。

---

## 工具

当前 MCP 接口暴露 26 个工具，按用途分组。权威数量由 [`mcp_tool_manifest.json`](mcp_tool_manifest.json) 生成。

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

完整参数 schema：见 [docs/MCP-INTEGRATION.md](docs/MCP-INTEGRATION.md)。

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

> 今天**没有**可安装的 `omctx` npm 包——它是 TARGET。命名与 registry 状态：
> [docs/goal24/narrative/naming-audit.json](docs/goal24/narrative/naming-audit.json)。

---

## 为什么不是"光有记忆"？为什么不是"光有可观测性"？为什么不是"通用 runtime"？

- **光有记忆**：记得住，但分不清哪些记忆现在还够格支撑行动。Omni 在行动前先做证据资格。
- **光有可观测性**：事后告诉你发生了什么，但不能把执行绑定到决策、也不能在事前拒绝一次坏行动。Omni 在事前与事中做绑定和闸门，事后做核验。
- **通用 agent runtime**：你说什么它执行什么，快，但没有权威。Omni 的执行面只承载被批准的语义能力，绝不把自由意图翻译成任意 shell 命令。

---

## 社区

- [Issues](https://github.com/guo6x/Omni-context/issues) —— Bug、功能需求
- [Discussions](https://github.com/guo6x/Omni-context/discussions) —— 想法、问答
- [参与贡献](./docs/BUILDING.md) —— 开发环境搭建、架构概览

---

MIT 许可证。真正属于你的，是一部会被现实纠错的判断史。
