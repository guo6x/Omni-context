# Holdback V2 覆盖矩阵分析报告

- 生成时间: 2026-08-07T17:18:12.227Z
- fixtures 数据源: `D:\ai_code\Omni-context\goal18hb-output\work\holdback-fixtures.jsonl`
- gold: fixtures 已内嵌 expected_action 等 gold 字段
- 预登记计划: `plans.mjs` (planFor splitTag=`hb`)
- 样本总数: 180（预期 180 = 15 task types x 12）→ PASS

## 1. 总体校验（15 × 12 = 180）

| task_type | 样本数 | 预期 | 状态 | 缺失 idx |
|---|---|---|---|---|
| TT01 | 12 | 12 | PASS | - |
| TT02 | 12 | 12 | PASS | - |
| TT03 | 12 | 12 | PASS | - |
| TT04 | 12 | 12 | PASS | - |
| TT05 | 12 | 12 | PASS | - |
| TT06 | 12 | 12 | PASS | - |
| TT07 | 12 | 12 | PASS | - |
| TT08 | 12 | 12 | PASS | - |
| TT09 | 12 | 12 | PASS | - |
| TT10 | 12 | 12 | PASS | - |
| TT11 | 12 | 12 | PASS | - |
| TT12 | 12 | 12 | PASS | - |
| TT13 | 12 | 12 | PASS | - |
| TT14 | 12 | 12 | PASS | - |
| TT15 | 12 | 12 | PASS | - |
| **合计** | **180** | **180** | PASS | |

## 2. 因子分布总览

| 因子 | 取值分布 |
|---|---|
| risk_level（风险等级） | critical: 4; high: 8; low: 33; medium: 107; negligible: 28 |
| reversibility（可逆性） | conditionally_reversible: 77; irreversible: 8; reversible: 95 |
| authority（权限等级） | L0: 1; L1: 3; L2: 8; L3: 70; L4: 56; L5: 42 |
| history（历史决策） | absent: 96; present: 84 |
| approval_required（审批要求） | no: 162; yes: 18 |
| evidence_sufficient（证据充分） | yes: 180 |
| expired_count（过期证据数） | 0: 154; 1: 26 |
| conflicting_count（冲突证据数） | 0: 153; 1: 27 |
| revision_type（修订类型） | keep_family: 32; n/a: 108; revise_family: 40 |
| user_override（用户覆盖） | no: 168; yes: 12 |

### 2.1 覆盖维度核对（规范第 9 节要求至少分析）

| 规范要求维度 | 对应因子 | 本批观测 |
|---|---|---|
| sufficient / insufficient evidence（可用性判定） | evidence_sufficient | sufficient: 180 |
| sufficient / insufficient evidence（gold action 约定） | gold.action ∈ CLARIFY/REJECT/DEFER | insufficient: 27; sufficient: 153 |
| history / no history | history | absent: 96; present: 84 |
| approval / no approval | approval_required | approval: 18; no_approval: 162 |
| stale / current / conflicting evidence | expired_count, conflicting_count | conflicting_present: 27; current: 129; stale_present: 24 |
| revision / no revision | revision_type | keep_family: 32; n/a: 108; revise_family: 40 |
| reversible / less reversible | reversibility | conditionally_reversible: 77; irreversible: 8; reversible: 95 |
| low / higher risk | risk_level | higher: 12; low: 33; medium: 107; negligible: 28 |
| authority variation | authority | L0: 1; L1: 3; L2: 8; L3: 70; L4: 56; L5: 42 |
| user override（适用处） | user_override | no: 168; yes: 12 |

## 3. 各任务类型因子汇总

| task_type | n | sufficient | history | approval | stale | conflicting | revise | keep | override | risk_levels | reversibility | authority |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TT01 | 12 | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | low;medium | conditionally_reversible;reversible | L3;L4;L5 |
| TT02 | 12 | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | medium;negligible | conditionally_reversible;reversible | L3;L4;L5 |
| TT03 | 12 | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | low;medium;negligible | conditionally_reversible;reversible | L0;L1;L3;L4 |
| TT04 | 12 | 12 | 0 | 0 | 12 | 0 | 0 | 0 | 0 | low;medium | conditionally_reversible;reversible | L3;L4;L5 |
| TT05 | 12 | 12 | 0 | 0 | 2 | 12 | 0 | 0 | 0 | low;medium;negligible | conditionally_reversible;reversible | L3;L4;L5 |
| TT06 | 12 | 12 | 12 | 0 | 0 | 1 | 12 | 0 | 0 | medium | conditionally_reversible;reversible | L3;L4;L5 |
| TT07 | 12 | 12 | 12 | 0 | 0 | 0 | 0 | 12 | 0 | medium;negligible | conditionally_reversible;reversible | L3;L4;L5 |
| TT08 | 12 | 12 | 0 | 6 | 0 | 0 | 0 | 0 | 0 | low | reversible | L2;L3;L4;L5 |
| TT09 | 12 | 12 | 0 | 12 | 0 | 0 | 0 | 0 | 0 | critical;high | conditionally_reversible;irreversible | L1;L2;L3;L4;L5 |
| TT10 | 12 | 12 | 12 | 0 | 0 | 2 | 12 | 0 | 0 | medium | conditionally_reversible;reversible | L3;L4;L5 |
| TT11 | 12 | 12 | 12 | 0 | 0 | 0 | 0 | 12 | 0 | medium;negligible | conditionally_reversible;reversible | L3;L4;L5 |
| TT12 | 12 | 12 | 0 | 0 | 0 | 12 | 0 | 0 | 0 | low;medium;negligible | conditionally_reversible;reversible | L3;L4;L5 |
| TT13 | 12 | 12 | 12 | 0 | 0 | 0 | 0 | 0 | 12 | medium;negligible | conditionally_reversible;reversible | L3;L4;L5 |
| TT14 | 12 | 12 | 12 | 0 | 0 | 0 | 4 | 8 | 0 | medium | conditionally_reversible;reversible | L3;L4;L5 |
| TT15 | 12 | 12 | 12 | 0 | 12 | 0 | 12 | 0 | 0 | medium;negligible | conditionally_reversible;reversible | L3;L4;L5 |

## 4. 预登记组合 vs 实际（plan vs actual，逐 TT）

按 `planFor(tt, 'hb', idx)`（idx 越界时按 `idx % 数组长度` 回绕）对比每个样本的 risk / reversibility / authority。

### TT01

| idx | plan_risk | plan_reversibility | plan_authority | actual_risk | actual_reversibility | actual_authority | 匹配 |
|---|---|---|---|---|---|---|---|
| 0 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 1 | low | reversible | L3 | low | reversible | L3 | 是 |
| 2 | medium | reversible | L5 | medium | reversible | L5 | 是 |
| 3 | low | reversible | L4 | low | reversible | L4 | 是 |
| 4 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 5 | low | reversible | L5 | low | reversible | L5 | 是 |
| 6 | low | reversible | L3 | low | reversible | L3 | 是 |
| 7 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 8 | low | reversible | L5 | low | reversible | L5 | 是 |
| 9 | medium | reversible | L3 | medium | reversible | L3 | 是 |
| 10 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 11 | low | reversible | L5 | low | reversible | L5 | 是 |

### TT02

| idx | plan_risk | plan_reversibility | plan_authority | actual_risk | actual_reversibility | actual_authority | 匹配 |
|---|---|---|---|---|---|---|---|
| 0 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 1 | negligible | reversible | L3 | negligible | reversible | L3 | 是 |
| 2 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |
| 3 | medium | reversible | L4 | medium | reversible | L4 | 是 |
| 4 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 5 | negligible | reversible | L5 | negligible | reversible | L5 | 是 |
| 6 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 7 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 8 | negligible | reversible | L5 | negligible | reversible | L5 | 是 |
| 9 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 10 | medium | reversible | L4 | medium | reversible | L4 | 是 |
| 11 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |

### TT03

| idx | plan_risk | plan_reversibility | plan_authority | actual_risk | actual_reversibility | actual_authority | 匹配 |
|---|---|---|---|---|---|---|---|
| 0 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 1 | low | reversible | L3 | low | reversible | L3 | 是 |
| 2 | negligible | reversible | L1 | negligible | reversible | L1 | 是 |
| 3 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 4 | low | reversible | L4 | low | reversible | L4 | 是 |
| 5 | medium | reversible | L3 | medium | reversible | L3 | 是 |
| 6 | negligible | reversible | L0 | negligible | reversible | L0 | 是 |
| 7 | low | reversible | L3 | low | reversible | L3 | 是 |
| 8 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 9 | low | reversible | L3 | low | reversible | L3 | 是 |
| 10 | negligible | reversible | L1 | negligible | reversible | L1 | 是 |
| 11 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |

### TT04

| idx | plan_risk | plan_reversibility | plan_authority | actual_risk | actual_reversibility | actual_authority | 匹配 |
|---|---|---|---|---|---|---|---|
| 0 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 1 | low | reversible | L3 | low | reversible | L3 | 是 |
| 2 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |
| 3 | low | reversible | L4 | low | reversible | L4 | 是 |
| 4 | medium | reversible | L3 | medium | reversible | L3 | 是 |
| 5 | low | reversible | L5 | low | reversible | L5 | 是 |
| 6 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 7 | low | reversible | L4 | low | reversible | L4 | 是 |
| 8 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |
| 9 | low | reversible | L3 | low | reversible | L3 | 是 |
| 10 | medium | reversible | L4 | medium | reversible | L4 | 是 |
| 11 | low | reversible | L5 | low | reversible | L5 | 是 |

### TT05

| idx | plan_risk | plan_reversibility | plan_authority | actual_risk | actual_reversibility | actual_authority | 匹配 |
|---|---|---|---|---|---|---|---|
| 0 | low | reversible | L4 | low | reversible | L4 | 是 |
| 1 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 2 | negligible | reversible | L5 | negligible | reversible | L5 | 是 |
| 3 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 4 | low | reversible | L4 | low | reversible | L4 | 是 |
| 5 | medium | reversible | L3 | medium | reversible | L3 | 是 |
| 6 | negligible | reversible | L5 | negligible | reversible | L5 | 是 |
| 7 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 8 | low | reversible | L3 | low | reversible | L3 | 是 |
| 9 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |
| 10 | negligible | reversible | L4 | negligible | reversible | L4 | 是 |
| 11 | medium | reversible | L3 | medium | reversible | L3 | 是 |

### TT06

| idx | plan_risk | plan_reversibility | plan_authority | actual_risk | actual_reversibility | actual_authority | 匹配 |
|---|---|---|---|---|---|---|---|
| 0 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 1 | medium | reversible | L3 | medium | reversible | L3 | 是 |
| 2 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |
| 3 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 4 | medium | reversible | L4 | medium | reversible | L4 | 是 |
| 5 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 6 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |
| 7 | medium | reversible | L4 | medium | reversible | L4 | 是 |
| 8 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 9 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |
| 10 | medium | reversible | L4 | medium | reversible | L4 | 是 |
| 11 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |

### TT07

| idx | plan_risk | plan_reversibility | plan_authority | actual_risk | actual_reversibility | actual_authority | 匹配 |
|---|---|---|---|---|---|---|---|
| 0 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 1 | negligible | reversible | L3 | negligible | reversible | L3 | 是 |
| 2 | medium | reversible | L5 | medium | reversible | L5 | 是 |
| 3 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 4 | negligible | reversible | L4 | negligible | reversible | L4 | 是 |
| 5 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |
| 6 | medium | reversible | L3 | medium | reversible | L3 | 是 |
| 7 | negligible | reversible | L4 | negligible | reversible | L4 | 是 |
| 8 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 9 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |
| 10 | negligible | reversible | L4 | negligible | reversible | L4 | 是 |
| 11 | medium | reversible | L3 | medium | reversible | L3 | 是 |

### TT08

| idx | plan_risk | plan_reversibility | plan_authority | actual_risk | actual_reversibility | actual_authority | 匹配 |
|---|---|---|---|---|---|---|---|
| 0 | low | reversible | L2 | low | reversible | L2 | 是 |
| 1 | low | reversible | L3 | low | reversible | L3 | 是 |
| 2 | low | reversible | L2 | low | reversible | L2 | 是 |
| 3 | low | reversible | L4 | low | reversible | L4 | 是 |
| 4 | low | reversible | L2 | low | reversible | L2 | 是 |
| 5 | low | reversible | L3 | low | reversible | L3 | 是 |
| 6 | low | reversible | L2 | low | reversible | L2 | 是 |
| 7 | low | reversible | L5 | low | reversible | L5 | 是 |
| 8 | low | reversible | L2 | low | reversible | L2 | 是 |
| 9 | low | reversible | L3 | low | reversible | L3 | 是 |
| 10 | low | reversible | L2 | low | reversible | L2 | 是 |
| 11 | low | reversible | L4 | low | reversible | L4 | 是 |

### TT09

| idx | plan_risk | plan_reversibility | plan_authority | actual_risk | actual_reversibility | actual_authority | 匹配 |
|---|---|---|---|---|---|---|---|
| 0 | critical | irreversible | L4 | critical | irreversible | L4 | 是 |
| 1 | high | irreversible | L3 | high | irreversible | L3 | 是 |
| 2 | high | conditionally_reversible | L2 | high | conditionally_reversible | L2 | 是 |
| 3 | critical | irreversible | L3 | critical | irreversible | L3 | 是 |
| 4 | high | irreversible | L5 | high | irreversible | L5 | 是 |
| 5 | high | conditionally_reversible | L4 | high | conditionally_reversible | L4 | 是 |
| 6 | critical | irreversible | L1 | critical | irreversible | L1 | 是 |
| 7 | high | irreversible | L3 | high | irreversible | L3 | 是 |
| 8 | high | conditionally_reversible | L5 | high | conditionally_reversible | L5 | 是 |
| 9 | critical | irreversible | L3 | critical | irreversible | L3 | 是 |
| 10 | high | irreversible | L4 | high | irreversible | L4 | 是 |
| 11 | high | conditionally_reversible | L2 | high | conditionally_reversible | L2 | 是 |

### TT10

| idx | plan_risk | plan_reversibility | plan_authority | actual_risk | actual_reversibility | actual_authority | 匹配 |
|---|---|---|---|---|---|---|---|
| 0 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 1 | medium | reversible | L3 | medium | reversible | L3 | 是 |
| 2 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |
| 3 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 4 | medium | reversible | L4 | medium | reversible | L4 | 是 |
| 5 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 6 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |
| 7 | medium | reversible | L4 | medium | reversible | L4 | 是 |
| 8 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 9 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |
| 10 | medium | reversible | L4 | medium | reversible | L4 | 是 |
| 11 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |

### TT11

| idx | plan_risk | plan_reversibility | plan_authority | actual_risk | actual_reversibility | actual_authority | 匹配 |
|---|---|---|---|---|---|---|---|
| 0 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 1 | negligible | reversible | L3 | negligible | reversible | L3 | 是 |
| 2 | medium | reversible | L5 | medium | reversible | L5 | 是 |
| 3 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 4 | negligible | reversible | L4 | negligible | reversible | L4 | 是 |
| 5 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |
| 6 | medium | reversible | L3 | medium | reversible | L3 | 是 |
| 7 | negligible | reversible | L4 | negligible | reversible | L4 | 是 |
| 8 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 9 | medium | reversible | L5 | medium | reversible | L5 | 是 |
| 10 | negligible | reversible | L4 | negligible | reversible | L4 | 是 |
| 11 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |

### TT12

| idx | plan_risk | plan_reversibility | plan_authority | actual_risk | actual_reversibility | actual_authority | 匹配 |
|---|---|---|---|---|---|---|---|
| 0 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 1 | low | reversible | L3 | low | reversible | L3 | 是 |
| 2 | negligible | reversible | L5 | negligible | reversible | L5 | 是 |
| 3 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 4 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 5 | medium | reversible | L5 | medium | reversible | L5 | 是 |
| 6 | negligible | reversible | L3 | negligible | reversible | L3 | 是 |
| 7 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 8 | low | reversible | L3 | low | reversible | L3 | 是 |
| 9 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |
| 10 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 11 | negligible | reversible | L3 | negligible | reversible | L3 | 是 |

### TT13

| idx | plan_risk | plan_reversibility | plan_authority | actual_risk | actual_reversibility | actual_authority | 匹配 |
|---|---|---|---|---|---|---|---|
| 0 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 1 | negligible | reversible | L3 | negligible | reversible | L3 | 是 |
| 2 | medium | reversible | L5 | medium | reversible | L5 | 是 |
| 3 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 4 | negligible | reversible | L4 | negligible | reversible | L4 | 是 |
| 5 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |
| 6 | medium | reversible | L3 | medium | reversible | L3 | 是 |
| 7 | negligible | reversible | L4 | negligible | reversible | L4 | 是 |
| 8 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 9 | medium | reversible | L5 | medium | reversible | L5 | 是 |
| 10 | negligible | reversible | L4 | negligible | reversible | L4 | 是 |
| 11 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |

### TT14

| idx | plan_risk | plan_reversibility | plan_authority | actual_risk | actual_reversibility | actual_authority | 匹配 |
|---|---|---|---|---|---|---|---|
| 0 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 1 | medium | reversible | L3 | medium | reversible | L3 | 是 |
| 2 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |
| 3 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 4 | medium | reversible | L4 | medium | reversible | L4 | 是 |
| 5 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 6 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |
| 7 | medium | reversible | L4 | medium | reversible | L4 | 是 |
| 8 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 9 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |
| 10 | medium | reversible | L4 | medium | reversible | L4 | 是 |
| 11 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |

### TT15

| idx | plan_risk | plan_reversibility | plan_authority | actual_risk | actual_reversibility | actual_authority | 匹配 |
|---|---|---|---|---|---|---|---|
| 0 | medium | conditionally_reversible | L4 | medium | conditionally_reversible | L4 | 是 |
| 1 | negligible | reversible | L3 | negligible | reversible | L3 | 是 |
| 2 | medium | reversible | L5 | medium | reversible | L5 | 是 |
| 3 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 4 | negligible | reversible | L4 | negligible | reversible | L4 | 是 |
| 5 | medium | conditionally_reversible | L5 | medium | conditionally_reversible | L5 | 是 |
| 6 | medium | reversible | L3 | medium | reversible | L3 | 是 |
| 7 | negligible | reversible | L4 | negligible | reversible | L4 | 是 |
| 8 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |
| 9 | medium | reversible | L5 | medium | reversible | L5 | 是 |
| 10 | negligible | reversible | L4 | negligible | reversible | L4 | 是 |
| 11 | medium | conditionally_reversible | L3 | medium | conditionally_reversible | L3 | 是 |

## 5. 预登记计划与实际不符清单

无。全部样本的 risk / reversibility / authority 均与预登记计划一致。

## 6. 预登记分布保持说明

- 本脚本为只读分析：不修改、不重排、不删除、不新增任何样本，也不调整任何因子分布。
- 覆盖矩阵仅如实报告实际分布；预登记分布由已冻结 generator 的 `plans.mjs` hb 数组（risk / reversibility / authority）及各 TT 构造规则决定。
- 按 Goal 18HB 规范第 9 节：**禁止为了追求完美均衡而破坏预登记分布**。本报告不执行任何平衡性调整；若分布与预登记计划存在差异，仅在上文列出，不进行修补。

## 7. 数据异常清单

无异常。

## 附：输出文件

- `D:\ai_code\Omni-context\goal18hb-output\holdback-v2-coverage-matrix.csv`
- `D:\ai_code\Omni-context\goal18hb-output\holdback-v2-coverage-report.md`
