# CLI Product Surface — omctx（受控执行面）

> 本文件是 Narrative Lane 的 CLI 产品面定义。
> 状态语言遵守《状态语言冻结》：产品能力一律标注
> `CURRENTLY_VERIFIED` / `CURRENTLY_VERIFIED_INTERNAL` / `TARGET` / `FUTURE`，不得混淆
> "内部 runtime 已验证"与"用户今天可直接使用"。
>
> 当前没有任何 `omctx` 二进制作为公开 npm 分发或用户安装面可用。D1A / D1B 与 Goal27 已对
> private alpha 的 `doctor` / `ask` / `inspect` / `history` / `approve` / `verify` / `reopen`
> 建立内部验证证据；这不是公开发布，也不等于 `npm i -g omctx` 今天可用。

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
| `omctx` 二进制（private alpha） | **IMPLEMENTED + VERIFIED INTERNAL** | `packages/omctx` private package（0.1.0-alpha.0）；未发布、无用户安装面；npm 名称审计 `CONFIRMED_CLEAR_ON_REGISTRY / NOT_RESERVED` |
| npm 全局安装（`npm i -g omctx`） | **TARGET** | 未发布；禁止 0.0.0 占位包；真实发布需满足第 6 节门槛 |
| `doctor` | **CURRENTLY_VERIFIED_INTERNAL** | 本地 Brain 健康 / 鉴权 / loopback 传输检查；只读 |
| `ask` | **CURRENTLY_VERIFIED_INTERNAL** | 只读 judgment 查询（get_decision_context）；ACTION_AUTHORITY=NONE；不是 Intent→Execution |
| `inspect` | **CURRENTLY_VERIFIED_INTERNAL** | 只读决策查看（get_decision_lineage） |
| `history` | **CURRENTLY_VERIFIED_INTERNAL** | 只读 judgment history（GET /api/decisions） |
| `version` / `help` | **CURRENTLY_VERIFIED_INTERNAL** | 本地命令，无网络 |
| `approve` | **CURRENTLY_VERIFIED_INTERNAL** | 独立 Desktop `control:approve` 会话；仅推进 server-owned approval，绝不启动执行 |
| `verify` | **CURRENTLY_VERIFIED_INTERNAL** | 独立 Desktop `control:verify` 会话；仅消费 server-owned receipt + trusted read-back，确定性输出 VERIFIED / MISMATCH / INCONCLUSIVE |
| `reopen` | **CURRENTLY_VERIFIED_INTERNAL** | Goal27 human-only `control:reopen`；重新资格审定当前证据并生成新的 judgment/revision；绝不执行、重试、回滚、复用旧 approval/grant/plan 或自行验证现实 |
| Desktop 可见 reopen UX | **TARGET / FUTURE USER SURFACE** | 尚无已验证的公开用户界面；不能把内部 CLI/control runtime 写成今天可用的 Desktop 功能 |
| 内部 runtime（broker / adapters / evidence guard / approval / read-back / revision） | **CURRENTLY_VERIFIED_INTERNAL** | Goal24 CP3–CP8、Goal27 与 Goal29 均有 Gate / freeze 证据；不等于公开 npm / public execution surface |

> **核心区分**：`omctx reopen` 的 private/internal command 与 Goal27 DecisionRevision runtime 已实现并验证；
> 公开 npm 安装与 Desktop user-facing reopen UX 仍未发布。二者不得互相升级。

---

## 3. 命令语义与边界

`doctor` / `ask` / `inspect` / `history` / `approve` / `verify` / `reopen` 均已有 private/internal
实现或控制面证据。以下描述的是它们的产品语义边界；公开分发状态仍由第 6 节单独决定。

### 3.1 `omctx ask` — CURRENTLY_VERIFIED_INTERNAL / TARGET EVOLUTION

当前 private alpha：
- 只读调用 `get_decision_context`。
- `ACTION_AUTHORITY = NONE`。
- 不创建 ExecutionPlan、不批准、不执行。

目标演进语义：**Intent → Evidence Qualification → Decision**，而不是 Prompt → Shell。

可能输出的目标决策状态：

| 输出 | 含义（TARGET 语义） |
|---|---|
| `PROCEED` | 证据资格通过、无需人工批准、可进入绑定执行 |
| `NEEDS_EVIDENCE` | 证据不足以支撑行动，需要补充/刷新证据 |
| `NEEDS_CLARIFICATION` | 意图本身不明确，需要澄清 |
| `NEEDS_APPROVAL` | 风险级别要求人工批准 |
| `DEFERRED` | 当前不具备行动条件，暂时搁置 |
| `BLOCKED` | 被证据闸门或策略硬性拒绝 |

### 3.2 `omctx inspect` — CURRENTLY_VERIFIED_INTERNAL / TARGET EVOLUTION

当前 private alpha 经 `get_decision_lineage` 提供只读决策查看。

目标完整视图包括：
- Decision（决策内容）
- Why（为什么）
- Evidence（证据）
- Missing Evidence（缺失证据）
- Risk（风险）
- Capability（所涉语义能力）
- Expected change（预期改变）
- Verification method（验证方法）
- Approval requirement（批准要求）

尚未投影出来的字段不得由 CLI 猜测；当前实现使用 `NOT_AVAILABLE`。

### 3.3 `omctx approve` — CURRENTLY_VERIFIED_INTERNAL

- 只能批准 **Omni 已生成并绑定的 plan**。
- 使用独立短时 Desktop `control:approve` session。
- **禁止** caller 自己写 arbitrary command。
- 批准对象是“决策 + 绑定”，不是“一串命令”。
- approve 本身**绝不启动执行**。

### 3.4 `omctx verify` — CURRENTLY_VERIFIED_INTERNAL

- 使用独立短时 Desktop `control:verify` session。
- 语义：消费 server-owned execution receipt，并通过 trusted read-back 重新观察现实，与预期比对。
- caller 不能提交 verdict / receipt / observed state 来伪造成功。
- verify 本身不执行、重试或回滚原动作。

### 3.5 `omctx history` — CURRENTLY_VERIFIED_INTERNAL / TARGET EVOLUTION

当前 private alpha 提供窄化的只读 judgment history。

目标完整语义：Decision → Evidence → Approval → Execution → Read-back → Outcome → Correction / Reopen。
它不是 shell history。

### 3.6 `omctx reopen` — CURRENTLY_VERIFIED_INTERNAL

Goal27 已实现并通过内部 Gate 的受控重开 / 修订生命周期：

- 只接受 human-only、短时 Desktop `control:reopen` session；Agent 没有 reopen authority。
- mismatch / inconclusive 的 trusted outcome 可以成为重开触发条件；verified outcome 需要 owner 明确提供 reconsideration reason。
- 重新调用现有 Evidence Surface，对**当前证据**重新资格审定；历史证据仍可审计，但不会被直接当成当前证据复用。
- 通过同一个 deterministic Decision Kernel 重新判断。
- 新判断若为 DECIDE，只生成**新的、尚未批准的 plan**，进入新的 approval lifecycle。
- 记录 original snapshot、current evidence、evidence delta、root/parent revision links；阻止 fork，并对相同重开意图做幂等处理。
- **绝不**自动执行、重试原始 write、自动 rollback、复用旧 approval/grant/plan，或把 caller 声明当成现实验证。

Gate 证据：
- `docs/goal27/gates/reopen-authority-gate.json` — PASS
- `docs/goal27/gates/revision-evidence-gate.json` — PASS
- `docs/goal27/gates/revision-integrity-gate.json` — PASS
- `docs/goal29/proof/v1-freeze-proof.json` — Goal27 regression / CLI regression PASS

**发布边界**：上述是 `CURRENTLY_VERIFIED_INTERNAL`。`omctx` package 仍 private / unpublished；
Desktop 可见的 user-facing reopen workflow 也尚未成为当前公开 capability。

---

## 4. 与现有内部 runtime 的映射

| 已验证内部组件 | CLI / control surface 角色 |
|---|---|
| Restricted execution broker | Restricted Broker |
| Capability adapters / fixed semantic bindings | Capability Adapter |
| Skills registry + importer | Procedural knowledge（NOT authority） |
| Evidence qualification + surface guard | 上游证据闸门（CLI 不绕过） |
| Approval binding + risk policy | 上游批准权威（CLI 不绕过） |
| Outcome read-back + deterministic evaluator | Trusted verification channel |
| Goal27 DecisionRevision service | Human-only correction history；requalify → re-decide → new unapproved plan at most |

CLI 产品面复用这些已验证组件，但 private/internal runtime 不自动升级为 public product capability。

---

## 5. 禁止性声明（必须长期保持）

- CLI 不得将自然语言意图转成任意 shell 命令。
- CLI 不得自行升级证据资格或决策权威（authority 永远在 Judgment Core）。
- caller 不得通过 CLI 伪造“验证成功”。
- Agent 不得获得 `control:approve` / `control:verify` / `control:reopen`。
- reopen 不得变成 retry / rollback / execute command。
- 不得把 `omctx` 写成“今天可安装”。
- 不得把 Desktop user-facing reopen UX 写成已发布，除非有新的公开 surface + Gate 证据。
- 发布前必须满足第 6 节全部门槛，才允许发 alpha。

---

## 6. 真实发布门槛（npm publish 前置条件）

当前 private alpha 与内部 Gate 证据**不等于 npm 已发布**。
真实发布前至少需要：

- package metadata / repository metadata 最终审计
- command-level public capability matrix（明确哪些 command 对 public alpha 开放）
- install / uninstall smoke
- security / secret scan
- README 示例与实际 shipped commands 完全一致
- 明确的 Owner release decision

禁止：
- 0.0.0 占位包
- 为抢名称而无产品门禁地 publish
- 把内部 control session 当成通用 public execution gateway
