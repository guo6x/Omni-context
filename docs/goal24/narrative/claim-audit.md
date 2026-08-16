# Claim Audit — Narrative Surface（对外声明审计）

> 审计对象：Narrative Lane 所有权的对外叙事面文件。
> 审计时间：2026-08-16。审计方法：基线全文阅读 + 关键字全文扫描 + 逐条归类。
> 结论口径：`CURRENT` / `TARGET` / `FUTURE` / `DO_NOT_CLAIM`，
> 与 `docs/goal24/narrative/public-claim-matrix.json` 一致。

---

## 1. 审计范围

本 Lane 所有权的叙事面：

- README.md
- README.zh-CN.md
- docs/PRODUCT-VISION.md
- docs/index.html（GitHub Pages landing，实际 landing source；docs/landing/ 下只有素材）
- docs/goal24/narrative/**（本轮新建）

**不在本 Lane 所有权、未改动、仅登记的旧叙事文件**（下一步 Owner 跟进）：

| 文件 | 现存旧叙事问题 |
|---|---|
| docs/MARKETING.md | 旧定位「跨所有 AI 通用的记忆 / 护城河 = 知识图谱 + 对外接口」；含对竞品的对比性表述 |
| docs/ARCHITECTURE.md | 未在本轮核对其中的能力表述 |
| docs/MCP-INTEGRATION.md | 工具级说明（属能力文档，未核对定位语言） |
| docs/SOCIAL-POST-READY.md | 旧定位发帖文案 |
| docs/article-zhihu-memory-not-yours.* | 旧定位长文 |
| docs/DEMO_SCRIPT.md | 旧 demo 脚本（与新 Demo placeholder 并存） |

> 这些文件超出本 Lane 文件所有权（Owner 只授权了
> PRODUCT-VISION / README×2 / landing / goal24-narrative / execution-ledger），
> 本 Lane 不修改，只在下方登记为 next_owner_action。

---

## 2. 基线发现的陈旧声明（已修复）

### R1. 「None of the roadmap items are available yet.」（README×2）

- 基线：README.md「Active development / Roadmap」整节结论句；
  README.zh-CN.md「以上路线图项目目前均不可用」。
- 问题：与真实 repo 状态不符——CP3–CP8 已有内部 / 工程 Gate 证据
  （`docs/goal24/checkpoint3..8-security-gate.json` 全部 PASS），
  且 origin/dev/goal24-cli-skills = 2e0b665b（CP8 freeze 提交）。
- 修复：改为三层模型——
  A. Current user-facing（今天可用）；
  B. Development-branch runtime verified（CP3–CP8 gate 证据表，
  显式声明「runtime verified on development branch，无 public invocation surface」）；
  C. Target / Future（omctx CLI、reopen UX、E2E、外部适配器，均带标签）。

### R2. 竞品对比矩阵（README×2 + landing Compare 区）

- 基线：README×2「Omni vs alternatives」表；landing「How we compare」表，
  对 ChatGPT Memory / Mem0 / Letta / Obsidian 逐格断言
  （如「Mem0 非本地」「Letta 非 MCP-native」等）。
- 问题：对第三方产品的事实断言在本 Lane 无证据可核验，属 claim integrity 风险；
  且与「不做虚假 competitor matrix」的治理要求冲突。
- 修复：全部移除，替换为不点名第三方的事实性定位
  （「Why not memory alone / observability alone / a generic runtime」）。

### R3. Landing 旧 headline / meta（docs/index.html）

- 基线：title/meta「Long-term memory for any AI」；hero「Memory for your AI」；
  副文案「A local knowledge graph that any MCP-compatible AI can use as long-term memory」；
  og:title/description 同旧定位。
- 修复：title/meta/og 与 hero 全部换为
  「Evidence-grounded decision control for long-lived AI agents」+
  trust anchor「Local-first, read-back verified, and owned by you.」+ mechanism sentence。
- 同时删除「12+ 客户端」式未核验计数表述，改为「MCP clients share the same local brain」。

### R4. PRODUCT-VISION 旧顶层定位

- 基线：第 1 章「Omni-Context 的内核是一张持续生长的知识图谱」；
  「知识图谱 + 对外接口（MCP/API）是产品真正的护城河」。
- 修复：第 1 章改为「Evidence-grounded decision control for long-lived AI agents」；
  moat 语言改为「qualify + bind + read-back + reopen」；
  知识图谱 / MCP 重新归位为 Evidence Substrate / interface surface（第 5、15 章）。

### R5. PRODUCT-VISION 旧 ✅ 状态标记

- 基线：第 4 章大量 ✅ 特性标记，语义为「当时已实现（用户面）」，
  与新治理语言（只有 GATE_VERIFIED 允许正式绿色 ✅）冲突。
- 修复：旧明细整体移入附录 A「历史组件盘点」，
  显式声明旧标记是 v1.2 基线历史快照、被第 10 章能力地图覆盖、
  不构成 GATE_VERIFIED。

---

## 3. 修复后关键字扫描结果（归类）

扫描词：available / supports / works with / verified / production / autonomous /
write / reopen / rollback / CLI / install / npm / all runtimes / any memory。
逐文件结论：

### README.md（34 处命中，全部合规）

- 「verified」：全部出现在「read-back verified」（trust anchor）、
  「runtime verified on the development branch」或「not a verified fact」语境 —— CURRENT / 内部状态，合规。
- 「available today」：全部是否定句（「not the same as available today」「not available」）—— 合规。
- 「reopen」：机制句 / 桌面控制面描述（TARGET copy）/
  `omctx reopen` 标 FUTURE（runtime 未实现）—— 合规。
- 「install / npm」：构建指令（npm run install:all / package）与否定句
  （「no npm package to install today — it is a TARGET」）—— 合规。
- 「works with any memory OS / any runtime」：仅出现在 DRG 禁止句（「does not claim」）—— 合规。
- 「supports」：仅出现在「frozen to what repo + gate evidence supports」—— 合规。

### README.zh-CN.md（8 处命中，全部合规）

- 与 EN 版同构：否定句 + TARGET/FUTURE 标签；「verified」均为
  「经读回核验（trust anchor）」与「runtime verified on development branch」。合规。

### docs/PRODUCT-VISION.md（28 处命中，全部合规）

- 「reopen」全部处于机制句 / 生命周期 / TARGET copy / FUTURE 标签语境，
  并有「reopen 目前尚无 user-facing verified 实现」「reopen 不是 retry command」护栏。
- 「rollback」全部为否定表述（automatic_rollback=NO；资格标记 only）。合规。
- 「install / npm」为构建指令与分发门槛（TARGET）表述。合规。
- 「supports / works with」全部出现在「禁止书写」条款。合规。
- 「verified」用于 trust anchor、内部验证分层说明。合规。

### docs/index.html（32 处命中，全部合规）

- 「reopen」处于机制、三面（TARGET copy + 显式状态注记）、
  `omctx reopen` 卡片（FUTURE 标签）语境。合规。
- 「install / npm」为下载/构建区与否定句（「nothing to install yet」、
  「No omctx npm package exists yet (TARGET)」）。合规。
- 「available today」仅出现在否定句（「Not 'available today'」）。合规。
- 每张 omctx 命令卡片均带 TARGET / FUTURE 标签（见第 4 节校验）。合规。

---

## 4. TARGET 标签就近校验（§33 要求：所有 TARGET CLI 示例附近必须有 TARGET / planned 标识）

| 示例位置 | 命令 | 就近标签 | 结果 |
|---|---|---|---|
| README.md §C | ask / inspect / approve / verify / history | 同列表首行「TARGET」 | ✅ 合规 |
| README.md §C | reopen | 同列表「FUTURE」 | ✅ 合规 |
| README.zh-CN.md §C | ask / inspect / approve / verify / history | 「TARGET」 | ✅ 合规 |
| README.zh-CN.md §C | reopen | 「FUTURE」 | ✅ 合规 |
| docs/index.html CLI 区 | ask/inspect/approve/verify/history 卡片 | 每卡底部 TARGET 标签 | ✅ 合规 |
| docs/index.html CLI 区 | reopen 卡片 | 卡片底部 FUTURE 标签 | ✅ 合规 |
| docs/goal24/narrative/cli-product-surface.md | 全部 6 命令 | 每节标题即标注 TARGET / FUTURE + 全局声明 | ✅ 合规 |
| docs/PRODUCT-VISION.md §10 | omctx CLI / reopen | 章节 C（TARGET）/ D（FUTURE） | ✅ 合规 |

---

## 5. Claim matrix 一致性

- `docs/goal24/narrative/public-claim-matrix.json` 计：
  CURRENTLY_VERIFIED 8、CURRENTLY_VERIFIED_INTERNAL 9、
  TARGET 6、FUTURE 5、DO_NOT_CLAIM 8。
- 叙事面（README×2 / index.html / PRODUCT-VISION）中的所有能力性表述
  均落在矩阵的某个 claim 或 DO_NOT_CLAIM 中；无矩阵外的新声明。
- 内部验证类声明全部使用 CURRENTLY_VERIFIED_INTERNAL + availability=internal_runtime，
  避免「runtime verified = publicly usable」混同。

---

## 6. Next owner actions（本 Lane 不动手）

1. docs/MARKETING.md 全面对齐新定位（或归档）。
2. docs/ARCHITECTURE.md、docs/MCP-INTEGRATION.md 的定位性语言复核。
3. docs/SOCIAL-POST-READY.md、docs/article-zhihu-memory-not-yours.* 旧定位长文处理。
4. docs/DEMO_SCRIPT.md 与 landing 的 Demo placeholder 统一（等真实 E2E）。
5. `omctx` 首次真实发布时按命名审计执行 reservation。
