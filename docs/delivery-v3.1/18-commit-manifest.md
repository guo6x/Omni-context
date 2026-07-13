# 18 — Commit manifest

Status: `FIXED`

Branch: `pre-evaluation-hardening-v3.1`

Implementation and evidence commits from the v3 baseline, oldest first:

- `89857b5b971dd9cffaa96d08a89574161bd337a1` — deterministic official datetime parser.
- `330efb3995c528d4865dc9fbb8cf63eb9dc08ebf` — datetime evidence.
- `568c9a1acb596e2110d1f8b11e899bc89e35c7a6` — isolated conversation runtime.
- `1bc46bc4067090fa81bf698379717f57f0e995cb` — isolation evidence.
- `b0c061932d95a8c35611b9d5b0b8e358eb82a69f` — extraction diagnostics and collapse repair.
- `2a46de0b5c9a44837c46ef8674b5e39076e2b8ac` — extraction diagnosis evidence.
- `469dea3e669cd28b5a3a4ece351c5c6b3e23a02e` — resume/retry state correctness.
- `1581cf9b1cc991a53087fd7321c78dcf925005fa` — resume/retry evidence.
- `4980d8bbe33be69ed62350688c1dac1e872089db` — structured evidence and deterministic metrics.
- `eeca7944cdaa7b188e1a3725328675aa4d77d333` — grounded evaluation evidence.
- `85c3627e279b6d084b5fb5cf782a8abd3705676a` — initial AgentLoop and merge hardening.
- `f99014bebe0b0d59f6c3ec381d94120aac954799` — timeout/merge evidence.
- `f2fc1ba2ccaee169c22ddc0ab131d1f9164887b7` — strict AgentLoop lock lifetime.
- `9b07790cdaa483dd4b5fd0219efceb151f45b075` — complete reversible merge journal.
- `ab8ca1dd8be766c70cb3b80cabc7159637673cc2` — await production AgentLoop shutdown.
- `7f5504849069a7352653eb4faf8eceefcb535204` — serialize shared SQLite transaction scopes.
- `43392f9c2839ac873c446b277f5ac8cf80f66d69` — long browser capture delivery and true browser E2E harness.
- `964417932dd721070b45656ea07a1a6f9d287563` — authenticated ESP32 UDP round trips.
- `a45e993e4af64b52d173e5e64458c1606922a7aa` — lockfile/native CI gates and D-drive-aware packaging.
- `c586866c19bade85c8fea49ceae7e2f072c6e528` — installed Windows application acceptance harness.
- `4ea445a89410b33ad67e8e729d888128bbeb80af` — readable browser fixture evidence without machine-local paths.
- `66d2bbae9c90a8eaa3723521e7dde4792ffbf177` — consolidated v3.1 delivery reports and raw client evidence.
- `1a6f163cc5ab2bb1f401c8542f60a2828787c1f0` — official-registry benchmark cache configuration for CI.
- `e78cb21f5a4ee3350a625d8da84fb1485d29ef7d` — tracked benchmark npm lockfile for reproducible CI installs.
- `0432e10ee24004b2fc317303543ecd46d6dce72e` — valid Tauri resource glob in a clean checkout.
- `12ed8b578153df538c31544cca85a41605f82acb` — frontend prerequisite before full Rust gates; implementation HEAD CI 9/9.
- `1dd8cac0205d0f5a7869e3090582bc58d22c2a71` — records the first green v3.1 documentation handoff CI.
- `98eaa780e56c723e049c92a55334f285600028f7` — hardens real provider-backed extraction and acceptance control.
- `960fa91c8f938e104f79ed37c305a4592bc309a4` — seals formal run provenance only from a clean repository.
- `c5d43c121cd5b7550fc33ea6c11febbacadab9f1` — persists interrupted statistics.
- `ae72a1a08c711ca003996c3e8819dc3ce7f5c3c8` — freezes non-thinking strict-JSON inference and token budgets.
- `2337a3bb75beac32adfa2198869d23a5f5ed1c05` — makes evidence finalization portable on Windows SQLite.
- `cb82745a74c254e7fe93614d0a9da6703aecb92e` — preserves the complete official Conversation 1 run and manual review evidence.
- `d5a667a318bb39446b472dd885a73e497334ab02` — fixes the CI-only fire-and-forget retry test race; current qualification CI 9/9.

The final candidate manifest/report commit is the child containing this file. Its exact SHA and current-HEAD CI URL are recorded in the annotated `evaluation-freeze-candidate-v1` tag after its nine jobs succeed, avoiding a self-referential commit field.
