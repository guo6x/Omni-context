# Goal 18HB · Generator Determinism / Reproducibility 报告

- 状态：**PASS**（3/3 dummy 运行 byte-identical）
- 日期：2026-08-08（Asia/Shanghai）
- 对象：`goal18-generator/v2.1.0` @ `cd53eaea538ac2992012e21e94370e918b166dde`

## 1. 方法（§十二）

在不泄露 raw seed 的安全环境中，使用 **non-formal dummy seed** 对正式 generator 做 3 次确定性复现测试：

- dummy seed：`goal18hb-dummy-determinism-seed-0001-abcdef0123456789`（存于 `work/dummy-seed-1.txt`，NON-FORMAL，仅用于本次测试）
- 命令：`node generate.mjs --split holdback --tag holdback --seed-file <dummy seed> --out-dir <run dir>`（3 次独立运行，输出目录 `work/dummy-hb-run1/2/3`）
- 判据：相同 seed + 相同 generator → **byte-identical output**

## 2. 结果

| 运行 | 输出 SHA-256（holdback-fixtures.jsonl） | 是否一致 |
|---|---|---|
| dummy-hb-run1 | `4a1f820ee7b651af8445da5bad967d948ba1136b30818fbd8d7d5da7e1524158` | = |
| dummy-hb-run2 | `4a1f820ee7b651af8445da5bad967d948ba1136b30818fbd8d7d5da7e1524158` | = |
| dummy-hb-run3 | `4a1f820ee7b651af8445da5bad967d948ba1136b30818fbd8d7d5da7e1524158` | = |

**结论：3/3 byte-identical。** generator 满足可复现性要求。

## 3. 正式运行纪律（§十二 / §十九）

- 正式 Holdback V2 仅用正式 seed 生成 **一次**（`seed.txt`，离线 custody，从未打印/入库/入日志；公开记录仅 seed hash `c627039c…`）。
- 未重复生成后挑选“更好的一版”；未做人工质量挑选；未静默删除任何发现。
- 生成过程中发现的唯一问题：TT15 `ev002.supports=["hc1"]`（generator 级 RI-02 缺陷）在正式生成前已修复并冻结（commit `cd53eaea…`，与 VALIDATION_GOLD_FREEZE_V1.1 数据修复一致），随后才进行正式生成。

## 4. 附加：dummy seal/decrypt round-trip（§二十 “seal decrypt-on-dummy test only”）

- `dummy-seal-decrypt-test.mjs`（dummy seed + dummy fixtures）：5/5 PASS（header G18HB2、round-trip byte-identical、wrong-seed 拒绝）。
- 正式 Holdback V2 未做 test decrypt。
- 结果文件：`work/dummy-seal-decrypt-results.json`（SHA-256 `896a5fc3003b5d07a948a4dc9785b7be57fe75f77167309b1651a654a2849490`）。