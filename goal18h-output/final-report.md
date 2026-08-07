# Goal 18H-R · 最终报告（§十七 十问）

日期：2026-08-07（Asia/Shanghai）
最终状态：**GLOBAL_BENCHMARK_DEFECT_FOUND**
（validation 侧 RI-02 缺陷已修复并重新冻结；holdback 同一生成器路径待裁定；Goal 20 禁止前进）

## 1. 原表单为什么不能填写？

v1 `review-form.html` 的 `renderMeta()` 按扁平结构读取 `s.query_time` /
`s.authority_level` / `s.risk_classification.level`，而 45 个 gold-blind 样本是
嵌套 machine schema（`scenario.*`），首次渲染即抛 `TypeError`，表单无法使用。
static/syntax 测试无法发现该类 schema-形状不一致；v2 已改为读取
`s.scenario.query_time` / `s.scenario.authority_level` /
`s.scenario.risk_classification.level|reversibility`，并由真实浏览器 E2E 断言
「查询时间 / 权限 / 风险」三项渲染成功。

## 2. Browser E2E 是否真实通过？

**是。** playwright-core 驱动系统 **Microsoft Edge 34/34 PASS**、**Google Chrome 34/34 PASS**
（headless 真实 Chromium 内核）。覆盖 open / start / tutorial / render HREV-001 /
answer / confirmation / lock / next（含未保存切换警告）/ restore（localStorage）/
export JSONL（导出首条 answer schema 合法）/ 全程无未捕获异常。
file:// 探针通过；`start-review.bat` 的 PowerShell 命令解析通过并以 HttpListener
实际提供表单（curl HTTP 200，122,001 字节）。报告见 browser-e2e-report.md。

## 3. 普通 reviewer 是否仍需要理解内部 taxonomy？

**不需要。** v2 主界面全中文自然语言：8 个渐进问题（Q1–Q8）、事实卡片（不显示
evidence ID）、条件统一为「需要考虑的条件」、机器代码（DECIDE/L0–L5/ev001 等）
默认折叠隐藏（可勾选「显示英文代码」）。人眼看到的是决策问题，后台保存机器字段。

## 4. 120 validation 中有多少 dangling refs？

- RI-01（options[].evidence_refs 引用存在性）：**0**；
- RI-02（supports 引用存在性）：修复前 **8 个 ERROR**（全部 TT15，
  `evidence[ev002].supports=["hc1"]`，hc1 不存在），修复后 **0**；
- RI-05/06/08（source_ref / snapshot / conflicts_with 引用存在性）：**0**；
- 合计修复前 8 个 dangling refs，修复后 0。

## 5. option/evidence_refs 的正式语义是什么？

**定义 A：相关证据（relevant evidence），允许反对证据、支持其他选项的证据、
以及 expired/conflicting 陷阱证据。** 依据：
1) 冻结 v1.1 fixtures（35 个 dev/reg）扫描出 16 处「option 引用 supports 不含自身」
   （dev-tt01-001 opt-b→ev002(opt-a)、dev-tt04-001 opt-a→ex001、dev-tt05-001→cf001 等）；
2) spec context-encoding 冻结文本：`Options carry ... filtered evidence_refs (qualified ids only)`
   与硬性不变量 `No expired id may appear in evidence_refs` —— 适配器在编码层过滤，
   证明 fixture 层允许包含过期/冲突项；
3) `supports` 才是「该 evidence 支持的对象」语义（schema 有 description）。
schema 的 `evidence_refs` 缺 description 属**文档缺口**，需在 schema/design/UI 文档中
明确 relevant-evidence 语义（RI-03 47 处 INFO 不构成数据缺陷，不修改数据）。

## 6. qualified evidence 指向 deleted source 的三条是否为 defect？

**否（设计陷阱）。** HREV-043/044/045 = decision-bench-v2-val-tt15-002/003/004。
TT15 的 gold `must_cite=[ev001,ev002]`、failure label `GHOST-CITATION` /
`CASCADE-INVALIDATION-MISS`、条件「不得引用已删除来源」——该模式正是任务要测试的
幽灵引用陷阱：qualified ev001 声称「现行信息」但其 source_ref 已被删除且无
revalidation event（缺失即陷阱本身），正确决策是识别后 INVALIDATE 并级联失效。
非 TT15 若出现同模式仍判 ERROR（当前 0）。

## 7. validation 是否发生修改？

**是，唯一一次授权修改（Goal 18H-R §12 纪律）。** 8 个 TT15 样本
`evidence[ev002].supports`：`["hc1"]` → `[]`（RI-02 生成器级 dangling ref）。
- 旧版本永久保留：`goal18h-output/archive/v1-validation-set.jsonl` 等三件（hash 已记录）；
- 逐字段 diff / 理由 / 裁决：`work/ri02-fix-changes.json` + `validation-change-log.jsonl`；
- gold 零改动（validation-gold.jsonl hash 不变）；scorer v1.1 不读取 supports，评分零影响；
- 覆盖矩阵因子不读取 supports，分布零变化。

## 8. 新 freeze hash 是什么？

**VALIDATION_GOLD_FREEZE_V1.1**（`goal18-output/validation-manifest.json`，supersede 原 manifest）：
- validation-set.jsonl sha256：`59e924631934a8712f05daedc269c4f27791bf86b97ed11fa5f1af0bdb3cbf34`
  （旧 3ceddb1a…，归档）；
- validation-gold.jsonl sha256：`763da3c34446e269c9735545c8ba427910ca33d687c8fb3ed7e0ea3f7e18baed`（不变）；
- manifest sha256：`01e5efed8b5a1fd9062672157060cfaf2aa903d5fe8bd98fe6518df3b4353af7`；
- integrity 套件重跑：**18/18 PASS**；RI 审计复跑：ERROR=0。

## 9. 旧 package 是否已标记废弃？

**是。** `human-review-package/DEPRECATED.md` 明确禁止使用 v1（含运行 Bug 与术语暴露），
仅作失败版本留档；当前唯一可交付包为 `human-review-package-v2/`。

## 10. 现在是否真的可以把 v2 package 给真人？

**技术上可以，正式上还差两道人类门禁：**
1. **项目协调人真人可用性 smoke test**（§15）：协调人本人只试 tutorial + 1 个
   dummy 样本（不填 45 条正式题），确认可理解、按钮正常、可导出 —— 该步骤必须由
   真实人类完成，AI 不得代做；
2. **Holdback 裁定**：RI-02 为生成器级结构 Bug，同一 builder 路径用于 holdback；
   密封期内不得解密验证。在裁定（解封审计或重建）完成前，正式状态为
   **GLOBAL_BENCHMARK_DEFECT_FOUND**，**不得进入 Goal 20**；
3. 两道门禁通过后，HR1（真实人类、gold-blind、Kernel-blind）才能开始 45 题盲审；
   之后才签发 `VALIDATION_GOLD_FREEZE_V2`。
