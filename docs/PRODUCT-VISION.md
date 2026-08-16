# Omni-Context 产品愿景（vNext）

> 这份文档是整个项目的「北极星」。所有规划、任务拆分、验收都以它为准。
> 当现实和这份文档冲突时——要么改代码对齐文档，要么改文档对齐新决定，二选一，不允许含糊。
>
> **本版为 O1 定位迁移后的 vNext**（Owner Decision 已批准，不再重新讨论）：
> 产品核心从「一张持续生长的知识图谱 / Personal Second Brain」
> 迁移为 **Judgment / Authority Core（判断与权威核心）**。
> 旧的 Memory / Knowledge Graph 资产**没有删除、也不是失败路线**，
> 而是被重新归位为 Judgment Core 的长期 **Evidence Substrate（证据底座）**。
>
> 本版对应 Narrative Lane（O3）产物；相关配套：
> `docs/goal24/narrative/thesis-note.{en,zh-CN}.md`、
> `docs/goal24/narrative/cli-product-surface.md`、
> `docs/goal24/narrative/naming-audit.json`、
> `docs/goal24/narrative/public-claim-matrix.json`、
> `docs/goal24/narrative/claim-audit.md`、
> `docs/goal24/execution-ledger.json`。

---

## 0. 文档治理：状态语言冻结

治理状态统一使用四级（见第 14 章）：

> `REPORT_ONLY` → `VERIFIED_LOCAL_EVIDENCE` → `REMOTE_INTEGRATED` → `GATE_VERIFIED`

- **只有 `GATE_VERIFIED` 允许画正式绿色 ✅。**
- 产品 capability 文档另外使用三类：`CURRENTLY_VERIFIED`（用户今天可直接使用）、
  `TARGET`（目标架构）、`FUTURE`（未来规划）。
- **不得混淆**「内部 runtime 已验证」与「用户今天可以直接使用」：
  内部验证（如 Goal24 CP3–CP8 gate）若没有 public invocation surface，
  只能写 "runtime verified on development branch"，不能写 "available today"。

---

## 1. Product thesis（产品论点）

### 正式 category headline

> **Evidence-grounded decision control for long-lived AI agents.**

### Trust anchor

> **Local-first, read-back verified, and owned by you.**

### Mechanism sentence

> **Qualify the evidence before an agent acts,**
> **bind execution to the decision that justified it,**
> **then read the world back and reopen the decision**
> **when reality disagrees.**

### 中文主解释

> 让长期运行的 AI Agent
> 在行动前有证据资格，
> 行动时有明确授权，
> 行动后有现实核验；
> 现实不符合原判断时，
> 重新打开那次决策。

### 产品核心

Omni-Context 的产品核心是 **Judgment / Authority Core（判断与权威核心）**。
完整长期闭环：

> Memory
> → Evidence Qualification
> → Decision
> → Approval
> → Execution
> → Read-back
> → Outcome
> → Reopen / Revision

### Moat 语言（机制护城河）

不再把 Memory、Knowledge Graph、MCP、Portable、Sandbox、Policy、
或单独的 Read-back 描述为独立 moat。

产品机制 moat 是四个动词的闭环：

> **qualify + bind + read-back + reopen**

传播资产句：

> **Own the judgment history — especially the decisions reality proved wrong.**

中文：

> 真正属于你的，不只是记忆，而是一部会被现实纠错的判断史。

> 注意：这是 category / product **thesis**，不是 DRG-2 前的
> capability completeness claim。在 Public Launch 之前，capability 声明受
> DRG v2 冻结约束（见第 11 章）。

---

## 2. Target user / wedge（目标用户与切入点）

**优先用户（wedge）：**

- technical individuals（技术个人用户）
- developers
- agent builders
- automation builders
- small AI-native teams（小型 AI 原生团队）
- 以上人群中**正在运营长期运行 Agent** 的人

**定位边界：**

- **Personal Second Brain 保留**为 deployment / use case 之一，
  **不是 master category**。
- **Enterprise governance 不是当前唯一目标**：本产品不强行写成
  大企业多 Agent governance suite。
- 第一价值主张是：给长期 Agent 装上「行动前有资格、行动后有核验、
  错了能重开」的决策控制，而不是又一个记忆仓库。

---

## 3. Judgment Core（判断与权威核心）

```
                     Omni-Context
                Judgment / Authority Core
   Evidence → Decision → Approval → Outcome → Reopen
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
 Agent Interface      Controlled         Human Control
    Surface          Execution Surface      Surface
```

- **Judgment / Authority Core 才是产品核心**，三面都是它的边缘接口。
- 核心职责：证据资格（qualify）、决策（decide）、绑定（bind）、
  结果评估（evaluate）、纠错历史（reopen / revision）。
- 权威单向流动：外部系统可以向 Core 提供证据与请求，
  但 **authority 只属于 Core 与用户**。

---

## 4. Three Surfaces（三面）

### 4.1 Agent Interface Surface（Agent 接口面）

- **MCP-first**；Skills / API 辅助。
- 作用：Agent 进入 Judgment Core 的接口。
- **MCP 不是 authority。Skills 不是 authority。**
- 现有 26 个 MCP 工具（数量以 `mcp_tool_manifest.json` 为准）
  重新归位为 evidence + decision access surface。

### 4.2 Controlled Execution Surface（受控执行面）

- 组成：**CLI · Capability Adapter · Restricted Broker · Read-back**。
- 作用：被批准的 semantic capability 以受限方式触达外部世界。
- **CLI 不等于 shell。CLI 不获得 decision authority。**
- 详细定义见 `docs/goal24/narrative/cli-product-surface.md`。

### 4.3 Human Control Surface（人类控制面）

- 组成：**Desktop Console（桌面控制台）**。
- 作用：inspect / approve / audit / history / reopen。
- **Desktop 不重新实现 Decision Kernel**，它只是 Judgment Core 的人类窗口。

### 三面一句话（TARGET architecture copy）

> MCP lets agents ask.
> CLI lets approved decisions touch the world.
> Desktop lets you inspect, approve, and reopen decisions.

中文：

> MCP 让 Agent 发起判断，
> CLI 让被授权的决策触达现实，
> Desktop 让人检查、批准，并在必要时重新打开决策。

> ⚠ 状态标注：以上为 **TARGET architecture** copy。
> `reopen` 目前尚无 user-facing verified 实现，
> 因此这句话**不能放进 CURRENT capability claim**。

---

## 5. Evidence Substrate（证据底座）

**Memory / Knowledge Graph 的新角色 = Evidence Substrate。**

记忆解决一个问题：**AI 知道什么。**

| 环节 | 解决什么问题 |
|---|---|
| Memory / Knowledge Graph | AI 知道什么（what the agent knows） |
| Evidence Qualification | 这些信息**现在还能不能信**（can it be trusted right now） |
| Decision Control | 基于这些信息**现在有没有资格行动**（is action authorized right now） |
| Outcome / Reopen | 做完以后**现实是否支持当时判断**、判断是否需要重开 |

- 不删除现有 Memory / Graph 资产。
- 不把它写成失败的旧路线。
- 正确表达：旧资产被**重新归位**为 Judgment Core 的长期 evidence substrate。
- 现有 26 个 MCP 工具 → Agent Interface / evidence + decision access surface。
- Capture、Browser Extension、Desktop capture → **evidence acquisition surfaces**。
- Skills → **procedural knowledge**（程序性知识），NOT authority。
- CLI / Capability Adapters → Controlled Execution Surface。
- Desktop → Human Control Surface。
- Decision Timeline → **Judgment History / audit surface**。
- Insights / Blind Spots → decision-quality enhancement（决策质量增强）。
- MCP → **one interface surface，NOT the product itself**。

---

## 6. Authority model（权威模型）

### 战略原则

> **Memory-source agnostic.**
> **Runtime-agnostic.**
> **Pluggable edges, centralized authority.**

### 完整设计原则（designed to）

> Omni-Context is **designed to** sit between
> heterogeneous memory/evidence sources
> and heterogeneous agent runtimes,
> while keeping evidence qualification,
> decision authority,
> outcome evaluation,
> and correction history
> under one user-owned control plane.

### 禁止书写的 claim（claim integrity）

- ❌ 禁止写：Omni currently supports **any memory OS**。
- ❌ 禁止写：Omni currently works with **any runtime**。
- 上面的表述一律只能是 "designed to / target architecture"，
  不得把未来目标写成当前 capability。

### 外部证据源通路（FUTURE / designed to）

- 未来 external evidence source：**MindMemOS、basic-memory、other memory systems**。
- 只能通过：

> External source → **EvidenceProvider Adapter**
> → provenance / freshness / verification qualification
> → **Evidence Guard**

- **外部 Memory 不自动变成 evidence authority。**

### 未来 runtime 通路（FUTURE / designed to）

- 未来 runtime：**OpenClaw、NemoClaw、Claude Code、other runtimes**。
- 只能作为 **Capability Transport**。
- 不得获得：decision authority / approval authority / outcome authority。

---

## 7. Outcome / Reopen lifecycle（结果与重开生命周期）

全闭环：

```
Memory → Evidence Qualification → Decision → Approval
   → Execution → Read-back → Outcome → Reopen / Revision
```

逐段语义：

1. **Memory**：积累与检索，回答「知道什么」。
2. **Evidence Qualification**：来源 / 新鲜度 / 验证状态，回答「现在还能不能信」。
3. **Decision**：明确的能力、输入、证据集、预期改变、验证方法。
4. **Approval**：按风险级别的人工或策略批准，批准绑定到具体 plan（单次授权）。
5. **Execution**：经 Restricted Broker 的受限执行，只执行被批准且绑定的语义能力。
6. **Read-back**：通过独立于执行动作的通道重新观察现实。
7. **Outcome**：把观察到的现实与当时的预期比对，产出 VERIFIED / MISMATCH / INCONCLUSIVE。
8. **Reopen / Revision**：现实不符时重开决策——重查证据、修正预期、重新决策或记录维持原判。

铁律：

> Process exit 0 ≠ semantic success
> ≠ external state changed
> ≠ user-intended outcome verified.

- **reopen 不是 retry command**：绝不暗示 reopen 会自动 re-execute 原始动作。
- **自动回滚不存在**（CP8 gate：`automatic_rollback = NO`，
  `rollback_candidate` 仅为资格标记）；不把 rollback 写成当前能力。

---

## 8. Local-first / data sovereignty（本地优先与数据主权）

- 数据全部在本地 SQLite，无云端、无账号、无公网鉴权。这是刻意设计，不是缺陷。
- 桌面端本地内嵌 Brain Server；外部客户端经本机 HTTP / MCP 接入。
- 信任锚保持：**Local-first, read-back verified, and owned by you.**
- 旧 v1.2 的数据主权原则全部保留（详见附录 A 历史组件盘点）。

---

## 9. Pluggable edges（可插拔边缘）

- **边缘可插拔，权威集中**：任何新的证据源或 runtime 都通过适配器接入，
  不改变 Judgment Core 的权威结构。
- 外部 Memory（FUTURE）：EvidenceProvider Adapter → qualification → Evidence Guard。
- 外部 Runtime（FUTURE）：作为 Capability Transport 使用，不获得任何 authority。
- 三面（MCP / CLI / Desktop）本身就是「可插拔边缘」的三种标准形态：
  面可以增加，权威不分散。

---

## 10. Current / Target / Future capability map（能力地图）

### A. CURRENTLY_VERIFIED（用户今天可直接使用）

- 本地持久记忆（SQLite；无账号、无服务器）
- 知识图谱（实体 / 关系 / 核心原则）
- 混合检索（全文 + 向量 + 图谱遍历）
- 时间 / 来源感知上下文
- 决策上下文、已保存决策与决策谱系、结果记录（校准 / 教训 / 后续）
- MCP 接口（26 个工具，数量以 `mcp_tool_manifest.json` 为准）
- 桌面应用：捕获、图谱可视化、时间线、问大脑、MCP 接入面板、设置等
- 浏览器插件（页面 / 选区捕获、popup 问大脑）
- 移动端只读搜索 MVP（实验性，未完整真机验证）

### B. 开发分支 runtime 已验证（内部 / 工程 Gate 证据；无 public user surface）

以下为 `dev/goal24-cli-skills` 上 CP3–CP8 的 gate 证据，**不代表用户今天可用**：

| 组件 | Gate 证据 | 说明 |
|---|---|---|
| Restricted execution broker | `checkpoint3-security-gate.json` PASS | spawn/kill/timeout、Job Object 约束、输出上限、环境清洗、cwd 约束；`execute_ipc_enabled=false` |
| GitHub 只读 CLI 适配器（5 个语义能力） | `checkpoint4-security-gate.json` PASS | 可执行文件钉定、无写能力（write bindings = 0） |
| Skills registry + importer | `checkpoint5-security-gate.json` PASS | 纯 TS、隔离默认、无公开信任变更面 |
| Evidence qualification + surface guard | `checkpoint6-security-gate.json` PASS | 服务器自有资格、防伪造覆盖、无公开注册面 |
| Approval binding + risk policy | `checkpoint7-security-gate.json` PASS | 单次授权、重放防御、无公开批准 IPC |
| Outcome read-back + deterministic evaluator | `checkpoint8-security-gate.json` PASS（DRG1 SATISFIED） | 受信 resolver、跨语言状态映射 26 + 观测 35 向量 mismatch 0、synthetic E2E 6 例；无公开 readback IPC |

- 测试证据（CP8 全量）：Brain 1279 passed / 0 failed；Rust 206 passed / 0 failed / 7 ignored。
- 状态表述必须是：**runtime verified on development branch**，
  而不是 "available today"。

### C. TARGET（目标架构）

- `omctx` CLI：`ask / inspect / approve / verify / history`（信息架构见
  `cli-product-surface.md`；**二进制本身 = TARGET**，npm 全局安装 = TARGET）
- 三面完整成型（MCP 接口面 + 受控执行面 + 人类控制面）
- Desktop 升级为 Human Control Surface（inspect / approve / audit / history / reopen）

### D. FUTURE（未来规划）

- `omctx reopen` 用户 UX（runtime 未实现）
- 真实（非 synthetic、用户能理解的）E2E
- 外部 memory adapters（MindMemOS / basic-memory / 其他）
- 多 runtime adapters（OpenClaw / NemoClaw / Claude Code / 其他，仅作 Capability Transport）
- GitHub write 能力及其 read-back（CP8 现状：`issue_create=LOCATOR_GAP`、
  `issue_comment=READBACK_CAPABILITY_GAP`、`pr_merge=MAPPED_PARTIAL`、
  production write bindings = 0）

### E. DO_NOT_CLAIM（禁止对外宣称）

- "works with any memory OS / any runtime"（只能是 designed to）
- `omctx` 今天可安装
- github writes 为当前 public feature
- Reopen 已实现
- LLM judge 或自动回滚（两者在 CP8 gate 中均为 NO）

---

## 11. DRG v2（发布治理规则）

以下规则属于 narrative governance 的一部分，写入本文档以冻结：

**DRG-1**：CP8 PASS 后，Packaging preparation 解除阻塞。

- 当前 CP8 已有历史 Gate PASS。以下从真实 Gate artifact 读取，
  不是从提示词复制：
  - `docs/goal24/checkpoint8-security-gate.json`：
    `"gate_status": "CHECKPOINT8_SECURITY_GATE=PASS"`、
    `"drg1": "DRG1_TECHNICAL_PREREQUISITE=SATISFIED"`。
- 因此 DRG-1 的技术前置**已满足**（依据上述 artifact）。

**DRG-2**：至少一个**真实、非 synthetic、用户能理解**的 E2E 成立后，
才允许 Public Launch。

- DRG-2 前：**public capability claims = FREEZE**。
  只能陈述有 repo + Gate 证据支持的当前事实。
- 可以讨论：target architecture、thesis、future CLI UX、future ecosystem strategy，
  但必须显式标 `TARGET` / `FUTURE` / `DESIGNED TO`。
- CP8 的 synthetic E2E（6 例）**不满足** DRG-2 的「真实、非 synthetic」要求。

---

## 12. Product non-goals（明确不做，防止范围蔓延）

- ❌ 多用户 / 账号体系 / 密码
- ❌ 云端存储 / 云同步
- ❌ 公网部署 / 公网鉴权
- ❌ 落盘加密
- ❌ Safari 插件
- ❌ ESP32 双向通信
- ❌ 移动端写入能力（移动端定位为只读）
- ❌ LLM judge（判定成功与否不由 LLM 说了算；CP8 gate: `llm_judge=NO`）
- ❌ 自动回滚（CP8 gate: `automatic_rollback=NO`；
  `rollback_candidate` 仅资格标记）
- ❌ 无约束的通用 shell agent（GOAL24_SCOPE_FREEZE.json 的 forbidden_designs）
- ❌ 把 Enterprise governance suite 写成唯一目标（positioning non-goal）
- ❌ npm 占位包（0.0.0）与任何形式的先占式发布

这些不是「以后做」，是这个产品形态**刻意不要**。
要加需先改本文件第 1 章的定位，并过 Owner Decision。

---

## 13. Distribution strategy（分发策略）

**现状（CURRENTLY_VERIFIED 分发路径）：**

- 桌面应用：Windows 安装包经 GitHub Releases 分发；macOS / Linux 社区构建；
  从源码构建（`npm run install:all` + `npm run package`）。
- Landing：GitHub Pages（`docs/index.html`，中英双语）。
- MCP：桌面接入面板 + `mcp-proxy.js` stdio 转发。

**`omctx` CLI 分发（TARGET，未发布）：**

- 命名：`omctx`（npm registry 当前 CONFIRMED_CLEAR_ON_REGISTRY / NOT_RESERVED；
  `omni-context` / `mcp-omni-context` / `omni-context-cli` 均为第三方占用，
  详见 `docs/goal24/narrative/naming-audit.json`）。
- 发布门槛（全部满足才允许发 alpha）：真实 CLI skeleton、真实 `--help`、
  真实 version、真实 README、真实 repository metadata、
  至少一个真实 non-dangerous command。
- **禁止**：0.0.0 占位包、Narrative Lane 内 npm publish。

**纪律：**

- 不直接 push main；不直接覆盖 `dev/goal24-cli-skills`。
- Narrative 产物经 feature branch `docs/goal24-narrative-vnext` 走正常流程。

---

## 14. Governance / verification language（治理与验证语言）

### 治理四级状态

> `REPORT_ONLY` → `VERIFIED_LOCAL_EVIDENCE` → `REMOTE_INTEGRATED` → `GATE_VERIFIED`

- 只有 `GATE_VERIFIED` 允许画正式绿色 ✅。
- feature branch push **不能叫** REMOTE_INTEGRATED；
  可另记 `remote_feature_pushed=true`。
- 只有 authoritative dev branch 真实集成并 Gate PASS 才允许 GATE_VERIFIED。

### 产品能力三类状态

- `CURRENTLY_VERIFIED`：用户今天可直接使用（需 repo / release 证据）。
- `TARGET`：目标架构（design）。
- `FUTURE`：未来规划。
- 禁止把"内部 runtime 已验证"与"用户今天可以直接使用"混为一谈。

### 证据权威链（truth precedence）

> **remote SHA / protected refs**
> **> checkpoint gate + manifest**
> **> execution ledger**
> **> executor report**
> **> chat memory**

- remote SHA 是 remote integration authority，**不是**本地 worktree existence authority。
- 本 Narrative Lane 的最高验证级别：`VERIFIED_LOCAL_EVIDENCE`
  （即便 feature branch 已 push；authoritative branch 仍是 `dev/goal24-cli-skills`）。

---

## 15. Legacy asset re-mapping（旧资产重新安置）

| 旧资产 / 旧说法 | 新角色 |
|---|---|
| Knowledge Graph | Evidence Substrate |
| 现有 26 MCP tools | Agent Interface / evidence + decision access surface |
| Capture / Browser Extension / Desktop capture | Evidence acquisition surfaces |
| Skills | Procedural knowledge，NOT authority |
| CLI / Capability Adapters | Controlled Execution Surface |
| Desktop | Human Control Surface |
| Decision Timeline | Judgment History / audit surface |
| Insights / Blind Spots | Decision-quality enhancement |
| MCP | one interface surface，NOT the product itself |

---

## 附录 A：历史组件盘点（v1.2 基线快照，2026-06-07）

> 本附录保留旧版 PRODUCT-VISION.md 的组件明细，防止信息丢失。
> 表中的 ✅/🟡/⬜/❌ 是**旧基线的历史状态标记**（当时已实现 = 用户面可用），
> 与本文档第 0 / 14 章的新治理语言是两套体系：
> 旧标记**不构成** `GATE_VERIFIED`，产品对外状态一律以第 10 章能力地图为准。
> 快照时间：2026-06-07；对应旧文档最后更新。

### A.1 旧系统架构总览（五个组件，一个中心）

```
        [浏览器插件]   [移动端 App]   [ESP32 物理按钮]
              \             |              /
               \            |             /
              HTTP/LAN    HTTP/LAN      UDP:9090
                 \          |           /
                  v         v          v
              ┌─────────────────────────────┐
              │      Brain Server (本地)     │   ← 唯一的大脑
              │  HTTP API · MCP · SQLite     │
              │  向量检索 · 图谱 · Agent Loop │
              └─────────────────────────────┘
                          ^
                          | 内嵌启动 / HTTP
                          v
                  [桌面端 Tauri App]   ← 主控台 + 系统级捕获
                          ↑
                          | mcp-proxy.js (stdio↔HTTP)
                          |
                [Claude Desktop / Cursor / Cline / ...]
                12+ 款 MCP 客户端共享同一份图谱
```

- Brain Server 是唯一数据权威，其余四个都是它的「感官」或「界面」。
  （vNext 注：此句在新架构中被「Judgment / Authority Core 集中权威」吸收。）

### A.2 Brain Server（后台大脑）历史明细

技术栈：Node.js + 自实现 HTTP 路由 + SQLite（FTS5 + sqlite-vec）

| 特性 | 最终形态 | 旧状态 | 备注 |
|---|---|---|---|
| HTTP API 服务 | 实体/关系/图谱/导入导出全套 REST | ✅ | `api-server.ts` |
| SQLite 存储 | 实体·关系·记忆·通知，FTS5 全文索引 | ✅ | `db/sqlite.ts` |
| 向量检索 | sqlite-vec 原生 KNN | ✅ | 未做大数据量压测 |
| 三层融合检索 | 向量+全文+图谱关联，一次查询穿透 | ✅ | 三层均已验证 |
| Embedding 服务 | 本地 Xenova transformers 生成向量 | ✅ | 模型内置仓库；hash-fallback 状态经 `/api/admin/embedding/status` 暴露 |
| GraphRAG 抽取 | 从文本抽实体+关系 | ✅ | 云端 DeepSeek 实测良好 |
| 截图 → OCR → 抽取 | 沉淀流程真解析截图文字 | ✅ | OCRPipeline + 10s 超时兜底 |
| 文件上传（Office/EPUB/HTML/代码） | 拖文件 → 自动解析 → 抽取 | ✅ | 30+ 扩展名 |
| 上传异步 job + 进度 | POST 返 jobId，前端轮询 | ✅ | 五阶段，5min TTL |
| 记忆分层 + 衰减 | core / archival + decay-scheduler | ✅ | 每 6 cycle 检查 decay_warning |
| Proactive Agent | 定期扫图谱、生成 Insights 推送 | ✅ | |
| MCP Server | 14 个工具（旧计数；现 26，以 `mcp_tool_manifest.json` 为准） | ✅ | stdio + HTTP 双模 |
| MCP HTTP 代理 | `mcp-proxy.js` 薄壳 | ✅ | 解决 DB 隔离 + LLM 配置共享 |
| 数据导入/导出 | 整库 JSON 备份/恢复 | ✅ | 桌面 UI 入口待补 |
| 认知盲区检测 | 三种盲区定期推送 | ⬜ | task 35-1 |
| 图分析驱动洞见 | statistical/latent_connection/anti_consensus | ⬜ | task 35-2 |

### A.3 桌面端（主控台）历史明细

技术栈：Tauri 1.x + Next.js 14（静态导出）+ Tailwind

| 特性 | 旧状态 | 备注 |
|---|---|---|
| 知识图谱可视化 | ✅ | 2D/3D 力导向 + size/Legend 三件套 |
| 图谱 MST 骨架视图 | ✅ | 裁冗余边只留最强骨架 |
| 图谱时间轴 | ✅ | 按创建时间回放图谱演化 |
| 节点编辑/删除/合并 | ✅ | 详情面板内直接操作 |
| 全窗口拖放上传 | ✅ | Tauri file-drop + Rust 递归扫描 |
| 常驻上传入口 | ✅ | header 区固定按钮 |
| 悬浮 HUD | ✅ | 独立置顶窗口 |
| Spotlight 搜索浮层 | ✅ | Ctrl+K，三路并发搜索 |
| 决策助手独立页面 | ✅ | Ctrl+Shift+K，三列结果 |
| 洞见通知中心 | ✅ | 毛玻璃 Insights 收件箱 |
| 系统托盘 + 后台常驻 | ✅ | 关 X 最小化 + 菜单 |
| MCP 接入面板 | ✅ | 12 个客户端卡片 + 一键写入（仅验证过的客户端）+ 复制 JSON 兜底 |
| Agent Skills 支持 | ✅ | `skills/omni-context-memory/SKILL.md` |
| 首启 Wizard + LLM 预设 | ✅ | 11 家服务商预设 |
| 沉淀真反馈 | ✅ | HUD 等待真实 await，三分支显示 |
| 离线横幅文案 | ✅ | 简短文案 + 详细信息折叠 |
| 系统自检 Tab | ✅ | embedding / LLM / OCR / BS 真实状态 |
| 国际化 | ✅ | zh/en 全量覆盖（130+ key） |
| 空状态新手引导 | ✅ | 加载 Demo + 逐功能导览 |
| 决策复盘时间线 | ✅ | DecisionTimeline（vNext: Judgment History 前身） |
| 问大脑答案卡多轮 | ✅ | 右栏多轮续聊 |
| 答案卡/洞察复制·收藏 | ✅ | 存 archival「收藏」标签 |
| 记忆管理收藏夹 | ✅ | |
| 决策续聊 + 决策链 | ✅ | previous_decision_id 挂 A→B→C 链 |
| 会话历史（可续聊） | ✅ | discussions 表 |
| 聊天记录导入（JSON/HTML） | ✅ | ChatGPT/Claude/Gemini |
| 单文件上传上限 30MB | ✅ | 前端与 brain-server 对齐 |
| 设置面板 | ✅ | |
| 浅色主题 | ✅ | |
| 屏幕/剪贴板捕获 | ✅ | 捕获→图谱链路打通 |
| 开机自启 | ✅ | tauri-plugin-autostart |
| Tauri allowlist + Cargo features | ✅ | |
| Windows 打包 | ✅ | msi + nsis |
| macOS / Linux 打包 | ✅ | CI matrix 全绿；Intel mac / AppImage 走源码构建 |
| 自动更新 | 🟡 | 代码就绪，私钥待配 GitHub Secret |
| 抓屏隐私控制 | ✅ | 暂停 toggle + 敏感应用 blocklist |
| 日志落盘 | ✅ | %LOCALAPPDATA%\omni-context\logs\ + 轮转 |

### A.4 移动端 App（实验性，暂搁）

| 特性 | 旧状态 | 备注 |
|---|---|---|
| 只读搜索 MVP | 🟡 | 代码完成，已出 APK，未完整真机验证 |
| 设置页（服务器地址 + 配对码） | ✅ | |
| 实体详情 + 邻居 | 🟡 | 未完整真机验证 |
| LAN 同步 + 鉴权 | ✅ | 127.0.0.1→0.0.0.0 |
| Android 打包 | ✅ | |
| 扫码配对 | ✅ | |
| iOS 打包 | ⬜ | 连 ios/ 工程都没有 |
| 截屏沉淀 / 上传 | ❌ | 移动端定位为只读 |

### A.5 浏览器插件

| 特性 | 旧状态 | 备注 |
|---|---|---|
| 一键沉淀当前页 / 选区 | ✅ | chrome.scripting.executeScript |
| popup 内「问大脑」 | ✅ | |
| 品牌一致 | ✅ | 品牌 logo |
| 与 Brain Server 通信 | ✅ | HTTP |
| 打包产物 | ✅ | unpacked + zip |
| Firefox 适配 | 🟡 | 标称兼容 109+，未实测 |
| 异步 job 协议同步 | ✅ | chrome.alarms 持久化轮询 |
| Safari 适配 | ❌ | 明确不做 |

### A.6 ESP32 物理硬件（实验性，暂搁）

| 特性 | 旧状态 | 备注 |
|---|---|---|
| 固件源码 | 🟡 | main.ino 在，未编译验证 |
| 接线/BOM/装配文档 | ✅ | |
| 与桌面端联动 | 🟡 | UDP:9090 单向触发 |
| 双向通信 | ❌ | 当前设计单向 |

### A.7 对外 AI 接入接口（旧「数字脑子」交付层）

| 特性 | 旧状态 | 备注 |
|---|---|---|
| MCP Server | ✅ | 旧计数 14；现 26（以 manifest 为准） |
| MCP HTTP 代理 | ✅ | mcp-proxy.js |
| 多客户端接入卡片 | ✅ | 12 + 1 张卡片；一键仅限已验证客户端 |
| 决策支持能力 | ✅ | get_decision_context + Ctrl+Shift+K |
| 决策复盘视图 | ✅ | DecisionTimeline |
| AI 大脑三件套 | ✅ | instructions + save_conclusion + access_count |
| HTTP API 对外开放 | 🟡 | MCP 为对外主通道；HTTP 内部用 |
| 接入文档 | ✅ | docs/MCP-INTEGRATION.md |
| 能力预览 UI | ✅ | 5 个使用场景示例 |

### A.8 组件间通信协议（旧实现，保留事实）

| From → To | 协议 | 说明 |
|---|---|---|
| 桌面端 UI → Brain Server | HTTP (3001) | fetch 调用 |
| 浏览器插件 → Brain Server | HTTP (3001) | 同 LAN，CORS 允许 |
| 移动端 → Brain Server | HTTP (3001) | LAN 内可达即可 |
| ESP32 → 桌面端 | UDP (9090) | 单向触发；默认仅 127.0.0.1 |
| MCP 客户端 → mcp-proxy.js → Brain Server | stdio + HTTP (3001) | 共享同一份 DB |

> 不存在跨进程 WebSocket 推送通道；各客户端轮询 HTTP API。

### A.9 旧路线图节点（历史留存）

- 阶段 1 图谱地基 ✅（2026-05-21）；阶段 2 数字脑子 ✅（2026-05-21）；
  阶段 3 主动智能引擎 ✅（2026-05-21）；阶段 6 产品深化 ✅（2026-05-22）；
  阶段 7 用户体验产品化 ✅（task 01-34）；阶段 7.5 打磨 + 可发布性 ✅（2026-05-29）；
  阶段 9 认知深度（2026-06-07 启动，task 35 盲区检测 / 洞见升级）。
- 旧路线图「知识图谱 + 对外接口是护城河」的排序原则已被本文件第 1 章 moat 语言取代。

### A.10 旧「仍欠的事」清单（v1.2 后，历史留存）

- 待真机验证：移动端真机、macOS/Linux 打包实测、ESP32 真机。
- 待外部配置：Tauri auto-update 私钥注入 GitHub Secret。
- 看市场反馈再决定：桌面 v1.3+ 候选、HTTP API 对外契约化。
- 分发与宣传：一句话价值主张、首发渠道、可信度素材（90 秒录屏、
  `docs/DEMO_SCRIPT.md`）。
- 明确暂缓：多用户/账号、云同步、公网部署、落盘加密、Safari、ESP32 双向、移动端写入。

> 本附录为历史基线留存。凡与第 1–15 章冲突处，以第 1–15 章为准。
