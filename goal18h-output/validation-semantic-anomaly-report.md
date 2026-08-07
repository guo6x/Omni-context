# Goal 18H-R · Validation 语义异常审计报告（RI-03 / RI-04 裁定）

范围：Goal 18 validation 120 样本 + 冻结的 v1.1 规范产物（只读引用）
裁定日期：2026-08-07

## 1. RI-03：`evidence_refs` 正式语义裁定 = **A（相关证据，允许反对证据）**

### 1.1 权威依据

1. **Schema（v1.1 与 v2 相同）**：`options[].evidence_refs` 仅有
   `type: array of string`，**无 description** —— 字段语义欠定义（这是文档缺口，不是数据缺陷）。
2. **冻结 v1.1 fixtures（35 个 dev/reg，authoritative）**：扫描发现 **16 处**
   option 引用了 `supports` 不包含该 option 的 evidence，包括：
   - `dev-tt01-001` opt-b 引用 ev002（supports=[opt-a]）—— 引用「支持另一选项」的比较证据；
   - `dev-tt04-001` opt-a 引用 ex001（supports=[]）—— 引用过期陷阱；
   - `dev-tt05-001` opt-a/opt-b 引用 cf001（supports=[]）—— 引用冲突证据；
   - `dev-tt06-001` opt-a 引用 ev002（supports=[hc1,opt-b]）；
   - `dev-tt13-001` opt-a 引用 ev002（supports=[opt-b]）；
   - `dev-tt15-001` opt-a 引用 ex001。
   v1.1 以该约定通过全部冻结检查，说明「相关证据（含反对/冲突/过期陷阱）」是
   基准谱系的既定语义。
3. **Spec context-encoding（frozen）**：
   - `Options carry only id, label, features.description and filtered evidence_refs (qualified ids only).`
   - 硬性不变量：`No expired id may appear in evidence_refs`（指 kernel 编码层）。
   适配器对 `evidence_refs` 做 qualified 过滤，证明 fixture 层允许包含
   expired/conflicting 引用（陷阱），编码层再剥离。

### 1.2 裁定

`evidence_refs` = **与该 option 评估相关的证据引用（relevant evidence）**，
允许包含反对该 option、支持其他 option、以及 expired/conflicting 陷阱证据；
**不是**「仅支持该 option 的证据」。`supports` 才是「该 evidence 支持的对象」。

### 1.3 处置

- **不是 fixture consistency defect**：47 处 RI-03 INFO 全部符合定义 A，不修改数据；
- **文档缺口必须修复**（Goal 18H-R §十 RI-03 A 分支）：
  - schema 的 `evidence_refs` 增加 description（relevant evidence 语义）；
  - 人审 UI 以「必须考虑的信息」呈现（v2 已如此，不暗示 supporting）；
  - 建议在 `benchmark-v2-design.md` / `annotation-guide.md` 中同步说明。
- v2 人审包不把 evidence_refs 当作 supporting 展示（事实卡片 + 过期/冲突角标）。

## 2. RI-03 分布（47 处，8 个任务类型）

TT01=14, TT04=10, TT13=8, TT14=6, TT10=3, TT02=2, TT03=2, TT06=2
（其余任务类型 0）。全部为「引用相关/反对证据」的正常表达。

## 3. RI-04：qualified evidence 指向 deleted source —— **TT15 设计陷阱，非缺陷**

### 3.1 现象（含人审包 HREV-043/044/045）

HREV-043/044/045 对应 `decision-bench-v2-val-tt15-002/003/004`（TT15）。
模式相同：timeline 中 e001 被 e004 删除（delete 事件）→ qualified `ev001`
在删除之后声称「仍为可用选项（现行信息）」，`source_ref` 仍指向 e001，无 revalidation 事件。

### 3.2 裁定依据（gold 交叉核对）

1. TT15 的 severe_failure_labels 明确包含 **`GHOST-CITATION`** 与
   **`CASCADE-INVALIDATION-MISS`** —— 该模式是任务设计的被测对象；
2. gold `expected_action = INVALIDATE`（decision-d1 + 级联 decision-d2），
   `must_cite = [ev001, ev002]`：模型必须引用 ev001 并识破其「幽灵引用」，
   依据「不得引用已删除来源」条件作出级联失效；
3. 设计文档 §2/plans.mjs：TT15 = 「证据删除：决策失效需级联传播」；
4. 冻结 v1 的 TT15 用「e005 备注事件」重新背书 qualified ev001，v2 改为
   直接用「幽灵引用」升级陷阱强度 —— 属于基准对 TT15 的有意演化。

### 3.3 结论

- HREV-043/044/045 的 RI-04 模式 **不是数据 defect**，是 TT15 设计的
  GHOST-CITATION 陷阱；**不缺少 revalidation event 是陷阱本身**；
- RI 审计规则已相应细化：TT15 → INFO（设计陷阱），非 TT15 → ERROR（当前 0）。

## 4. 对人审包的影响

- RI-03（相关证据语义）已通过 UI 文案「必须考虑的信息」正确处理；
- RI-04（过期/来源删除）在事实卡片上以「已过期 / 来源已删除」角标呈现，
  提示 reviewer 谨慎对待 —— 符合盲审目的，不泄露 gold 结论。
