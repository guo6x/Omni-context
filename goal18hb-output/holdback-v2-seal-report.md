# Goal 18HB · Holdback V2 Seal 报告

- 状态：**SEALED_PRE_VALIDATION**
- 封存时间：2026-08-08（Asia/Shanghai）
- 授权：`holdback-v2-run-auth.json`（显式禁止 run_models / score_holdback / edit_fixtures_after_seal / release_seed_without_two_person_rule）

## 1. Seal 协议（§十四，遵循 Goal 15A + Goal 18HB）

- 加密：AES-256-GCM，key = scrypt(seed)，salt = `sha256("goal18hb-holdback-seal-v2|" + seed_hash)[0:32]`（salt label 与 V1 的 `goal18-holdback-seal-v1|` 严格区分）
- 文件头：`G18HB2`（与 V1 `G18HB1` 区分），format version 1
- 结构：header(6) + version(1) + iv(12) + tag(16) + ciphertext
- 正式 V2 **未执行 test decrypt**（§二十）；解密路径由 dummy round-trip 验证

## 2. Seal 前置门（全部 PASS 后才封存）

| 门 | 结果 |
|---|---|
| Generator 冻结（commit/版本） | PASS（cd53eaea… / v2.1.0） |
| 3× dummy 确定性 | PASS（byte-identical） |
| Schema validation | PASS |
| RI-01..RI-04 | PASS（ERROR=0） |
| Integrity suite pre-seal | 17/18（T15 待 seal，符合预期） |
| Coverage | PASS（180=15×12，plan mismatches 0） |
| Overlap | PASS（exact_overlap=0） |
| Leakage | PASS（gold_leakage_findings=0） |
| Dummy seal/decrypt round-trip | PASS（5/5） |

## 3. 产物与哈希

| 产物 | 路径 | SHA-256 |
|---|---|---|
| Sealed artifact | `goal18hb-output/holdback-v2-sealed.bin` | `4737bc7746825cac27938682f1a82ada28044d8122a5c2b6c35a67efb54adbd3` |
| Public manifest | `goal18hb-output/holdback-v2-public-manifest.json` | `4e4239d4170b56286eb33cd832e66c3aa1c2c2ba3bb7053e050af7c7a4319d7a` |
| Access log | `goal18hb-output/holdback-v2-access-log.jsonl` | `472294af320c20d335366e4f81a6374248d15bed1a09a987c228103d5705818c` |
| Plaintext（离线 custody） | `C:/Users/00/.codex/goal18hb-holdback-custody/holdback-v2-fixtures.jsonl` | `005aa51f1d030dae2019a70f2de705ac2b2a5480a9f2ce043930eef29057050a` |
| Gold projection（离线 custody） | `…/holdback-v2-gold.jsonl` | `80ab80ecb4784f783a4ba38d5511f5f10d16452b130a006a724c39d40209e45b` |
| Seed（离线 custody，raw 永不公开） | `…/seed.txt` | hash `c627039c6930c35cbc62bd256bba89f8daab6278840b4af8ac4f1e8b43a2caa1` |

## 4. Access log 事件（`holdback-v2-access-log.jsonl`）

1. `generate`（180 fixtures = 15×12；确定性 generator v2.1.0）
2. `seal`（plaintext sha256 记录）
3. `custody_transfer`（plaintext 移至离线 custody）
4. `verify`（post-seal 校验：plaintext hash == manifest hash；180 = 15×12）

无任何 model-run / scoring 事件。

## 5. Post-seal 验证

- `verify-seal-v2.mjs`：**34/34 PASS**（manifest 字段、custody plaintext/gold/seed 哈希与 sidecar、sealed 结构与哈希、access log、仓库无 plaintext、正式 V2 未解密）。
- Integrity suite post-seal（读 custody 副本）：**18/18 PASS**。
- 仓库中 `work/holdback-fixtures.jsonl` 已删除；plaintext 仅存在于离线 custody。

## 6. 旧 Holdback

- 保持原样未动（`goal18-output/holdback-sealed.bin` + `holdback-public-manifest.json` + `holdback-access-log.jsonl` 作为历史审计证据保留）；
- 状态 `RETIRED_BEFORE_EVALUATION`（`legacy-holdback-retirement-record.json`）；
- 本 Goal 未解密/未读取 V1 plaintext/custody。