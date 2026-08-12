# 03 — Tag Archive Map

Goal 23.5 — Repository Consolidation & Main Promotion
Timestamp: 2026-08-12

## 3.1 New archive tags created by this task (6)

Annotated tags created locally, pushed to origin, and verified via `git ls-remote --tags origin`
(tag object SHA + dereferenced commit SHA listed). No existing tag was modified or moved.

| Branch archived | Archive tag | Tag object SHA | Target commit SHA |
|-----------------|-------------|----------------|-------------------|
| benchmark/decision-v1 | archive/benchmark-decision-v1 | d1f57ea8cf857dcd919ed069884fc856817f2a29 | 06f9a10a8a4e91ab1f9d28876352676563ebf002 |
| codex/omni-evaluation-candidate-v3 | archive/omni-evaluation-candidate-v3 | 81e8c30dfd5d5f9177ae4504c7ccd9960208dea2 | 4e73e63ab03fda5928f4e9de0f0d12d713c65e62 |
| codex/omni-external-eval-and-paper-v1 | archive/omni-external-eval-and-paper-v1 | 8a879153390c793338d4b9e6adfe62bfaf5ae007 | 27bad22ec13921e0e80428192aedfd8751b8419b |
| codex/omni-longmemeval-s-formal-v1 | archive/omni-longmemeval-s-formal-v1 | bd08d6644380dd8890475cc1fa1aae914fcb6221 | 9316f0dc37b02144b900d2f4612aaf92a0bd8a11 |
| codex/omni-v3.1-strict-ablations | archive/omni-v3.1-strict-ablations | 691ed515fd27a9622c811511ddb1b011f8c06abb | c02c07394c51e95143ba590975bab2f655d7ae57 |
| trae/solo-agent-F9HYOB | archive/trae-solo-agent-F9HYOB | b5f10d8b8325b4bb217bf1bf565c031b7ae52cb6 | ae0bd1700b6ff8c39d17b4eecc81507503239856 |

Verification: `git ls-remote --tags origin` shows each archive tag with `^{}` pointing to the exact
branch tip SHA recorded in the audit. `git tag --contains <SHA>` resolves for every archived commit.

## 3.2 Pre-existing tags (6, unchanged)

| Tag | Tag object SHA | Commit SHA |
|-----|----------------|------------|
| v0.1.1 | 2ed3ee9a2f4e9d9f765b157fdd1c6929815545ff | ad36b3cb0f0d0a4769d443a65283b4bbf11df9dc |
| v3.0.0 | 9d8d40339e66ddcb87d3fa8df69f49a6ad8b1b56 | 9d8d40339e66ddcb87d3fa8df69f49a6ad8b1b56 |
| omni-context-evaluation-freeze-v1 | 2fb2d137b08102710ffdd8360f97d94b4d874971 | 872723b10ec4ae99b8272606a183155837104332 |
| evaluation-freeze-candidate-v1 | 58188929d473b513ba5ad36b9cbdcbe0c52ffab0 | 3bdb6e106832854a9bc94672fc74fafa8f7e221f |
| evaluation-freeze-candidate-v2 | a481d588acede7c25747701dac40ac133f0e6707 | be20db60bef32a886fddde4986013cf40a1e8ec5 |
| evaluation-freeze-candidate-v3.1 | 1bcd4d1a4f1dfdab6c367c8234cea87b151d1cb4 | 17dc1d0107b0474de84058205a91b302ba290a74 |

Scientific freeze tags (omni-context-evaluation-freeze-v1, evaluation-freeze-candidate-*): NOT moved,
NOT modified, NOT re-pointed. Verified by re-reading `git ls-remote --tags origin` before and after
all branch deletions.

## 3.3 History coverage

Every commit reachable from any deleted branch remains reachable from either a retained branch
(main / product/omni-v3-unified-r1 / dev/goal24-cli-skills / research/decision-benchmark-holdback-v2)
or a tag (pre-existing 6 + new archive/* 6). See 04-deleted-branches.md for the per-branch
reachability verification (19/19 PASS).
