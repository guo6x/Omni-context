# CLI Product Surface — omctx（受控执行面）

> 本文件是 Narrative Lane 的 CLI 产品面定义。
> 状态语言遵守《状态语言冻结》：产品能力一律标注
> `CURRENTLY_VERIFIED` / `TARGET` / `FUTURE`，不得混淆"内部 runtime 已验证"
> 与"用户今天可直接使用"。
>
> 当前没有任何 `omctx` 二进制作为公开 npm 分发或用户安装面可用。D1A 已在
> `dev/goal24-cli-skills` 上对 **read-only alpha**（`doctor` / `ask` / `inspect` /
> `history`）完成 authoritative internal verification；这不是公开发布，也不等于
> `npm i -g omctx` 今天可用。下文的 TARGET 语义只描述尚未开放的控制面。

---

## 1. 正式表述（Formal positioning）

> **The Omni CLI is the portable execution surface of the decision-control layer.**

- It does **not** turn natural-language intent into arbitrary shell commands.
- Instead, it carries **approved semantic capabilities** through trusted adapters,
  restricted execution bindings, and independent read-back verification.
- The CLI sits **downstream of evidence qualification and decision authority**:
  它不产生决策权威，只承载已被授权的语义能力。

一句话边界：

> **CLI 不等于 shell。CLI 不获得 decision authority。**

CLI 属于三面架构中的 **Controlled Execution Surface**：

- 上游：Judgment / Authority Core（证据资格 → 决策 → 批准）
- 本面：CLI · Capability Adapter · Restricted Broker · Read-back
- 下游：外部世界（通过受控绑定触达）

---

## 2. 状态总表（Status overview）

| 项 | 状态 | 说明 |
|---|---|---|
| `omctx` 二进制（private alpha） | **IMPLEMENTED + AUTHORITATIVELY VERIFIED INTERNAL** | `packages/omctx` private package（0.1.0-alpha.0），真实临时 Brain smoke 已验证；未发布、无用户安装面；npm 名称审计 `CONFIRMED_CLEAR_ON_REGISTRY / NOT_RESERVED` |
| npm 全局安装（`npm i -g omctx`） | **TARGET** | 未发布；禁止 0.0.0 占位包；真实发布需满足第 6 节门槛 |
| `doctor` | **CURRENTLY_VERIFIED_INTERNAL** | 本地 Brain 健康 / 鉴权 / loopback 传输检查；只读 |
| `ask` | **CURRENTLY_VERIFIED_INTERNAL** | 只读 judgment 查询（get_decision_context）；ACTION_AUTHORITY=NONE；不是 TARGET 语义的 Intent→Execution |
| `inspect` | **CURRENTLY_VERIFIED_INTERNAL** | 只读决策查看（get_decision_lineage） |
| `history` | **CURRENTLY_VERIFIED_INTERNAL** | 只读 judgment history（GET /api/decisions） |
| `version` / `help` | **CURRENTLY_VERIFIED_INTERNAL** | 本地命令，无网络 |
| `approve` | **CURRENTLY_VERIFIED_INTERNAL** | 独立 Desktop `control:approve` 会话；仅推进 server-owned approval，绝不启动执行 |
| `verify` | **CURRENTLY_VERIFIED_INTERNAL** | 独立 Desktop `control:verify` 会话；仅消费 server-owned receipt + trusted read-back，确定性输出 VERIFIED / MISMATCH / INCONCLUSIVE |
| 命令 `reopen` | **FUTURE** | runtime 尚未实现；不得暗示 reopen 会自动重放原动作 |
| 内部 runtime 对应物（broker / adapters / evidence guard / approval / read-back） | **开发分支 runtime 已验证** | 见 Goal24 CP3–CP8 gate 证据（`docs/goal24/checkpoint*-security-gate.json`）；**没有 public invocation surface**，不属于 CURRENTLY_VERIFIED 用户面 |

> 上述"开发分支 runtime 已验证"不是 CLI 用户面状态，二者不得互相升级。

---

## 3. 命令目标信息架构（Target IA）

`doctor` / `ask` / `inspect` / `history` 的 D1A **read-only** 行为已是
**CURRENTLY_VERIFIED_INTERNAL**。本节余下内容只描述这些命令未来可能承载的
执行/批准语义，以及 `approve` / `verify` / `reopen`；approve/verify 仍是
private alpha 的本地 internal surface，不是公开 npm 用户面，reopen 仍未实现。

### 3.1 `omctx ask` — TARGET

- 语义：**Intent → Evidence Qualification → Decision**。
- 不是：Prompt → Shell。
- 可能输出（planned 决策状态）：

| 输出 | 含义（TARGET 语义） |
|---|---|
| `PROCEED` | 证据资格通过、无需人工批准、可进入绑定执行 |
| `NEEDS_EVIDENCE` | 证据不足以支撑行动，需要补充/刷新证据 |
| `NEEDS_CLARIFICATION` | 意图本身不明确，需要澄清 |
| `NEEDS_APPROVAL` | 风险级别要求人工批准 |
| `DEFERRED` | 当前不具备行动条件，暂时搁置 |
| `BLOCKED` | 被证据闸门或策略硬性拒绝 |

### 3.2 `omctx inspect` — TARGET

查看一次 Decision 的完整上下文：

- Decision（决策内容）
- Why（为什么）
- Evidence（证据）
- Missing Evidence（缺失证据）
- Risk（风险）
- Capability（所涉语义能力）
- Expected change（预期改变）
- Verification method（验证方法）
- Approval requirement（批准要求）

### 3.3 `omctx approve` — TARGET

- 只能批准 **Omni 已生成并绑定的 plan**。
- **禁止** caller 自己写 arbitrary command。
- 批准对象是"决策 + 绑定"，不是"一串命令"。

### 3.4 `omctx verify` — TARGET

- 语义：**"重新观察现实"**（触发独立 read-back，与当时的预期比对）。
- 不是：caller 告诉系统 `success=true`。
- 验证结果是观察产物，不是声明产物。

### 3.5 `omctx history` — TARGET

- 展示 **Judgment History**：Decision → Evidence → Approval → Execution →
  Read-back → Outcome → Correction / Reopen。
- 不是 shell history。
- 对应产品概念：决策时间线升级为"判断史 / 审计面"。

### 3.6 `omctx reopen` — FUTURE

- 重新打开一段历史判断：重查证据、修正预期、重新决策或记录维持原判。
- 不是 retry command。
- **绝不暗示** reopen 会自动 re-execute 原始动作。
- 当前状态：runtime 未实现（CP8 只冻结了 `rollback_candidate` 资格标记，
  无自动回滚、无 reopen 引擎；见 `docs/goal24/checkpoint8-security-gate.json`
  的 `rollback` 与 `github_future_readback` 段）。

---

## 4. 与现有内部 runtime 的映射（TARGET 视图）

| 现有开发分支内部组件（CP3–CP8 gate 证据） | CLI 目标面角色 |
|---|---|
| 受限执行 broker（spawn/kill/timeout、环境清洗、cwd 约束、输出上限） | Restricted Broker |
| GitHub 只读 CLI 适配器（5 个语义能力、可执行文件钉定） | Capability Adapter（首批形态） |
| Skills registry + importer（纯 TS、隔离默认） | Procedural knowledge（NOT authority） |
| Evidence qualification + surface guard | 上游证据闸门（CLI 不绕过） |
| Approval binding + risk policy（单次授权、重放防御） | 上游批准权威（CLI 不绕过） |
| Outcome read-back + 确定性 evaluator | Read-back 验证通道 |

CLI 产品面**复用**这些已验证组件，但当前它们没有任何 public invocation surface。

---

## 5. 禁止性声明（必须长期保持）

- CLI 不得将自然语言意图转成任意 shell 命令。
- CLI 不得自行升级证据资格或决策权威（authority 永远在 Judgment Core）。
- caller 不得通过 CLI 伪造"验证成功"。
- 不得把 `omctx` 写成"今天可安装"。
- 发布前必须满足第 6 节全部门槛，才允许发 alpha。

---

## 6. 真实发布门槛（npm publish 前置条件，本 Lane 不执行）

真实 CLI skeleton、真实 `--help`、真实 version、真实 README、
真实 repository metadata、至少一个真实 non-dangerous command。
全部满足后才可以发 alpha。本 Narrative Lane **不发布任何包**。
