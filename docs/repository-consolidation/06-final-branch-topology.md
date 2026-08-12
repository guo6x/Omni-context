# 06 — Final Branch Topology

Goal 23.5 — Repository Consolidation & Main Promotion
Timestamp: 2026-08-12

Remote branches AFTER (4):

| Branch | Tip SHA (12) | Role |
|--------|--------------|------|
| main | c3398bc (tip d89675a2) | Stable engineering product baseline (promoted from product/omni-v3-unified-r1) |
| product/omni-v3-unified-r1 | d89675a2e9f6 | Canonical named engineering product baseline (kept; declared authoritative in docs/PRODUCT-BASELINE.md and Goal24 audit; main points to the same commit) |
| dev/goal24-cli-skills | 9b7d60c2ee29 | ACTIVE Goal24 next-development line (CLI/Skill-first capability work; 4 unique doc commits) |
| research/decision-benchmark-holdback-v2 | fd666ba9cd2e | PROTECTED Holdback / formal campaign lineage (16 unique commits; never deleted/modified/merged) |

Branch count: 23 → 4 (83% reduction).

History carrier: 12 remote tags (6 pre-existing + 6 new archive/*) + 4 branches cover 100% of the
commits previously reachable from deleted branches (verified, see 04-deleted-branches.md).

Active topology:
- main = product baseline (what GitHub visitors see)
- dev/goal24-cli-skills = next product development (branches from main/product baseline)
- research/decision-benchmark-holdback-v2 = sealed scientific campaign lineage (Holdback untouched)

No local branches or worktrees were deleted or modified. Local-only branches that have no remote
counterpart (product/decision-kernel-v1, research/experiment-runner-r1, research/ablation-harness-r1,
research/decision-intelligence-spec-v1(.1), security/remediation-7, codex/rc0-independent-acceptance,
product/omni-v3-unified-r1-blocker-fix, benchmark/decision-v1 local mirror) remain untouched.
