# 04 — Deleted Branches

Goal 23.5 — Repository Consolidation & Main Promotion
Timestamp: 2026-08-12

19 remote branches deleted via `git push origin --delete <branch>` in 4 batches (max 6 per batch).
Between batches: `git fetch --all --tags --prune` + re-listing + verification.

## Batch 1 (SAFE_DELETE, 6)

pre-evaluation-hardening-v1, pre-evaluation-hardening-v2, pre-evaluation-hardening-v3,
pre-evaluation-hardening-v3.1, pre-evaluation-hardening-v3.2, codex/pre-evaluation-hardening-v3.2.1

## Batch 2 (SAFE_DELETE, 6)

codex/omni-cognitive-benchmark-v1, codex/omni-cognitive-benchmark-v1.1-answer-diagnostics,
codex/omni-cognitive-benchmark-v1.1-pre-run-hardening, codex/omni-context-evaluation-freeze-v1,
codex/omni-evaluation-candidate-v3.1-final, codex/omni-paper-evidence-v1

## Batch 3 (HISTORICAL_TAG_AND_DELETE, 6; tags created + verified BEFORE deletion)

benchmark/decision-v1, codex/omni-evaluation-candidate-v3, codex/omni-external-eval-and-paper-v1,
codex/omni-longmemeval-s-formal-v1, codex/omni-v3.1-strict-ablations, trae/solo-agent-F9HYOB

## Batch 4 (SAFE_DELETE, 1)

codex/omni-paper-manuscript-assets-v1

## Reachability verification

For every deleted branch, `git merge-base --is-ancestor <deleted-tip> <retained ref>` was evaluated
against the retained set (4 branches + 12 tags). Result: **19/19 PASS** — every deleted tip remains
reachable from at least one retained branch or tag. Per-branch covering refs:

| Deleted branch | Deleted tip SHA (12) | Covering retained ref (primary) |
|----------------|----------------------|--------------------------------|
| pre-evaluation-hardening-v1 | ad36b3cb0f0d | product/omni-v3-unified-r1 (also tag v0.1.1) |
| pre-evaluation-hardening-v2 | c05cd310ab5d | product/omni-v3-unified-r1 |
| pre-evaluation-hardening-v3 | cdb3490da499 | product/omni-v3-unified-r1 |
| pre-evaluation-hardening-v3.1 | 3bdb6e106832 | product/omni-v3-unified-r1 (also tag evaluation-freeze-candidate-v1) |
| pre-evaluation-hardening-v3.2 | be20db60bef3 | product/omni-v3-unified-r1 (also tag evaluation-freeze-candidate-v2) |
| codex/pre-evaluation-hardening-v3.2.1 | 249afb39128e | product/omni-v3-unified-r1 |
| codex/omni-cognitive-benchmark-v1 | 71085c46ce5f | archive/omni-external-eval-and-paper-v1 |
| codex/omni-cognitive-benchmark-v1.1-answer-diagnostics | 62b0b20f944f | archive/omni-external-eval-and-paper-v1 |
| codex/omni-cognitive-benchmark-v1.1-pre-run-hardening | 1f4c7c4b77ce | archive/omni-external-eval-and-paper-v1 |
| codex/omni-context-evaluation-freeze-v1 | 872723b10ec4 | product/omni-v3-unified-r1 (also tag omni-context-evaluation-freeze-v1) |
| codex/omni-evaluation-candidate-v3 | 4e73e63ab03f | archive/omni-evaluation-candidate-v3 |
| codex/omni-evaluation-candidate-v3.1-final | 17dc1d0107b0 | product/omni-v3-unified-r1 (also tag evaluation-freeze-candidate-v3.1) |
| codex/omni-external-eval-and-paper-v1 | 27bad22ec139 | archive/omni-external-eval-and-paper-v1 |
| codex/omni-longmemeval-s-formal-v1 | 9316f0dc37b0 | archive/omni-longmemeval-s-formal-v1 |
| codex/omni-paper-evidence-v1 | ad1fe8806255 | archive/omni-external-eval-and-paper-v1 |
| codex/omni-paper-manuscript-assets-v1 | 7cbc54b991c6 | archive/omni-external-eval-and-paper-v1 |
| codex/omni-v3.1-strict-ablations | c02c07394c51 | archive/omni-v3.1-strict-ablations |
| benchmark/decision-v1 | 06f9a10a8a4e | archive/benchmark-decision-v1 |
| trae/solo-agent-F9HYOB | ae0bd1700b6f | archive/trae-solo-agent-F9HYOB |

Notes:
- The archive tags for Batch 3 were created and pushed BEFORE the branches were deleted, and verified
  with `git ls-remote --tags origin` (03-tag-archive-map.md).
- No commit became unreachable: reachability was re-verified against the FINAL retained ref set.
- Local branches and local worktrees were not touched; deleting remote pointers does not affect them.
