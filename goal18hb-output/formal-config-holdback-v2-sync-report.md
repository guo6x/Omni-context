# Goal 18HB · Formal Experiment Metadata 同步报告（§十七）

- 状态：**SYNCED_TO_HOLDBACK_V2**（12 个 UPDATE 字段全部落地；37 个 NO_CHANGE 字段未触碰）
- 同步时间：2026-08-08（Asia/Shanghai）
- 依据：Goal 18HB §十七 allowlist（只允许 holdback public manifest identity / sample count / schema hash / fixture hash / seal hash / replacement note；不得修改 model / prompts / A0–A5 / scorer / product / evaluator / validation protocol / hypothesis / metrics）

## 1. 新值（post-seal 实测）

| 量 | 值 |
|---|---|
| V2 public manifest | goal18hb-output/holdback-v2-public-manifest.json（schema `holdback-v2-seal-manifest-v1`） |
| Manifest sha256 | f18adcf1d3ade018cc4f9437aa69e4eb0e317a7df2eca00bb7055c905101897c |
| V2 fixture sha256 | 005aa51f1d030dae2019a70f2de705ac2b2a5480a9f2ce043930eef29057050a |
| V2 sealed artifact | goal18hb-output/holdback-v2-sealed.bin（sha256 4737bc7746825cac27938682f1a82ada28044d8122a5c2b6c35a67efb54adbd3） |
| V2 seed hash | c627039c6930c35cbc62bd256bba89f8daab6278840b4af8ac4f1e8b43a2caa1（raw seed 不公开） |
| holdback_sample_count | 180 |

## 2. UPDATE 字段清单（12）

### formal-run-config-v1.json（8 处）
| 路径 | before | after | §17 依据 |
|---|---|---|---|
| goal18_integrity.holdback_public_manifest.file | goal18-output/holdback-public-manifest.json | goal18hb-output/holdback-v2-public-manifest.json | identity-path |
| …schema | holdback-seal-manifest-v2 | holdback-v2-seal-manifest-v1 | identity-schema |
| …holdback_fixture_sha256 | f3a69fcd… | 005aa51f… | fixture hash |
| …sealed_artifact.file | goal18-output/holdback-sealed.bin | goal18hb-output/holdback-v2-sealed.bin | identity-path |
| …sealed_artifact.sha256 | f0d08a12… | 4737bc77… | seal hash |
| …seed_hash | 0f898583… | c627039c… | SPEC_GAP→identity 块内字段（见 §4） |
| …sha256_of_manifest | d433bfa5… | f18adcf1d3ade018cc4f9437aa69e4eb0e317a7df2eca00bb7055c905101897c | SPEC_GAP→identity 块内字段（见 §4） |
| budget_estimates.holdback.samples | "TBD (target 180 per D-08)" | 180 | sample count |

### formal-experiment-freeze-manifest.json（2 处）
| 路径 | before | after | §17 依据 |
|---|---|---|---|
| goal18_integrity.holdback_public_manifest | goal18-output/holdback-public-manifest.json (schema holdback-seal-manifest-v2; fixture sha256 f3a69fcd…; sealed artifact f0d08a12…) | goal18hb-output/holdback-v2-public-manifest.json (schema holdback-v2-seal-manifest-v1; fixture sha256 005aa51f…; sealed artifact 4737bc77…) | identity + fixture/seal hash |
| model_identity.validation_holdback_estimates.holdback | single sealed pass; samples TBD (target 180 per D-08) | single sealed pass; samples 180 (V2 SEALED_PRE_VALIDATION) | sample count |

### model-and-budget-owner-decision.json（1 处）
| 路径 | before | after | §17 依据 |
|---|---|---|---|
| budget_estimates.holdback.samples | "TBD (target 180 per D-08; …counts.total is null pending dataset freeze)" | 180 | sample count |

### unresolved-formal-run-risks.md（1 处）
| 路径 | before | after | §17 依据 |
|---|---|---|---|
| R-BUDGET-1（holdback 句子） | holdback (TBD, target 180) | holdback (180) | sample count |

## 3. NO_CHANGE 确认（37 项）

model / prompts / A0–A5 definitions / scorer（v1.1 @ 5cac8ae）/ product / evaluator / validation protocol / hypothesis / metrics / budget 上限（¥220）与授权模板均未修改；3 个 allowlist 字段因无对应 19F 字段而未变（replacement note 由本报告充当）。逐项清单见 `work/19f-holdback-refs.json`。

## 4. SPEC_GAP 决策（2 项，需要 lead 知悉确认）

- `holdback_public_manifest.seed_hash`、`holdback_public_manifest.sha256_of_manifest` 不在 §17 明示 allowlist 上，但二者都是 `holdback_public_manifest` 块内部的**身份字段**：V2 必然使用新 seed（§四 NEW INDEPENDENT SEED），manifest 文件本身必然变化。
- 本 Goal 决定：按 “holdback public manifest identity” 解释包含这两个字段并完成同步（否则 19F 配置将绑定错误的 V1 身份，形成不一致）。
- 记录为 lead-visible 决策；如 owner 不同意该解释，可在 Goal 20 授权前另行裁决。

## 5. 观察（scope 之外，另行处理）

- `formal-experiment-freeze-manifest.json` 的 `goal18_integrity.validation_fixture_sha256` 仍为旧值 `3ceddb1a…`（Goal 18H-R 已发布 VALIDATION_GOLD_FREEZE_V1.1，validation-set 哈希为 59e92463…）。该字段属于 validation 引用，不在 18HB §十七 allowlist 内；建议由 Goal 18H 的最终 freeze（VALIDATION_GOLD_FREEZE_V2）流程或 owner 另行更新。

## 6. 同步后文件哈希

| 文件 | SHA-256 |
|---|---|
| formal-run-config-v1.json | 897ed7e91875ed0162a62d3df14a184205111fe44ba053f5b2c3bb1cb4e5b02e |
| formal-experiment-freeze-manifest.json | f18adcf1d3ade018cc4f9437aa69e4eb0e317a7df2eca00bb7055c905101897c |
| model-and-budget-owner-decision.json | 653c1c59a9e1a8cb7b2d8c48997792b0158876d011b57a644fb5c961de1ca1b3 |
| unresolved-formal-run-risks.md | ba90adffd16035b96feae83aced45801709c628902a1f3bb63b968586305189a |

## 7. 正式配置新状态

```text
holdback_sample_count = 180
holdback_version = V2
holdback_status = SEALED_PRE_VALIDATION
legacy_holdback = RETIRED_BEFORE_EVALUATION
```