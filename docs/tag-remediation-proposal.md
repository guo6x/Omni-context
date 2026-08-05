# Freeze Tag Remediation Proposal (冻结标签修复提案)

> **This is a PROPOSAL only. No remote tag was deleted, moved, or created in this round.**
> **本文件仅为提案。本轮未删除、移动或创建任何远端标签。**

## 1. Background (背景)

The product baseline branch `product/omni-v3-unified-r1` starts at commit
`17dc1d0107b0474de84058205a91b302ba290a74` (`17dc1d0`, "fix(retrieval): prioritize semantic
core evidence"). This commit is an **engineering starting point**, not a frozen experiment
product. The original Targeted-7 gate FAILED and the current selector has no formal
performance proof (see [PRODUCT-BASELINE.md](./PRODUCT-BASELINE.md)).

产品基线分支从 `17dc1d0` 开始，该提交是工程起点而非冻结产品；原 Targeted-7 门禁失败，
当前 selector 无正式性能证明。

## 2. Tag inventory and verdicts (标签清单与判定)

Audited on the product baseline (2026-08-05):

| Tag | Peeled commit | Verdict | Rationale |
|---|---|---|---|
| `omni-context-evaluation-freeze-v1` | `872723b` | **KEEP** | Documented Freeze v1 (`docs/freeze-v1/`); annotated tag binding is part of the freeze record. Do not move. |
| `evaluation-freeze-candidate-v1` | `3bdb6e1` | **KEEP** | Historical candidate v1 manifest. Do not move. |
| `evaluation-freeze-candidate-v2` | `be20db6` | **KEEP** | Historical candidate v2 sealed manifest. Do not move. |
| `evaluation-freeze-candidate-v3.1` | `17dc1d0` | **MISLEADING — remediate** | Message claims "Omni-Context Candidate v3.1 freeze" but `docs/candidate-v3.1-review/13-freeze-recommendation.md` explicitly says this tag "must not be created" and `docs/candidate-v3.1-review/14-final-status.md` records `NOT FROZEN`. The tag mislabels an engineering commit as a freeze. |
| `v0.1.1` | `ad36b3c` | **KEEP** | Version tag, unrelated to evaluation freeze. |
| `v3.0.0` | `9d8d403` | **KEEP** | Version tag, unrelated to evaluation freeze. |

## 3. Problem statement (问题陈述)

`evaluation-freeze-candidate-v3.1` is the only tag whose existence and message contradict
the repository's own evaluation evidence. It creates a false freeze identity for `17dc1d0`
and can mislead:

- release/engineering processes that consult tags for "frozen" markers;
- future benchmark authorization gates that check tag presence;
- users reading the release page or tag list.

`evaluation-freeze-candidate-v3.1` 是唯一一个存在本身及其说明信息与仓库评测证据相矛盾的标签。
它为 `17dc1d0` 制造了错误的冻结身份。

## 4. Remediation options (修复选项)

### Option A (RECOMMENDED): delete the remote tag, keep history intact

1. `git push origin :refs/tags/evaluation-freeze-candidate-v3.1` (delete remote tag only;
   no commit history is rewritten; the commit `17dc1d0` stays untouched).
2. Record the deletion in a manifest (e.g., update `product-baseline-manifest.json` tag audit).
3. If a v3.1 freeze is ever legitimately established, create the tag **only** on the
   authorized freeze commit with a manifest-backed message, per `docs/freeze-v1/04-tag-and-manifest.md`.

Pros: removes the misleading identity; commits are preserved. Cons: requires a force-push
of the tag ref (remote tag deletion); GitHub Release tag listing will lose this entry.

### Option B: rename to a non-freeze name

`git tag evaluation-candidate-v3.1 17dc1d0` then delete `evaluation-freeze-candidate-v3.1`.
Preserves a pointer to the engineering commit under a non-misleading name.

### Option C (minimal): keep the tag, add explicit deprecation records

Keep the tag as-is and rely on this proposal + `docs/PRODUCT-BASELINE.md` to declare it
deprecated. Lowest risk, but the misleading tag remains visible to tooling.

## 5. Recommended procedure and approval gates (建议流程与审批门)

1. **Approval**: repository owner reviews this proposal and confirms one option.
2. **Checklist** before deletion (Option A/B):
   - [ ] Confirm `17dc1d0` is reachable from `product/omni-v3-unified-r1` (it is the branch tip).
   - [ ] Confirm no CI/release workflow reads `evaluation-freeze-candidate-v3.1` for gating.
   - [ ] Confirm GitHub Releases does not point at the tag as an asset source.
   - [ ] Record the action in `product-baseline-manifest.json` tag audit (`remediated_at`).
3. **Post-action verification**: `git ls-remote --tags origin` no longer lists the tag.

## 6. Explicit non-actions in this round (本轮明确不做)

- ❌ No remote tag is deleted in this round (proposal only).
- ❌ No commit history is rewritten.
- ❌ `omni-context-evaluation-freeze-v1`, `evaluation-freeze-candidate-v1`,
  `evaluation-freeze-candidate-v2`, `v0.1.1`, `v3.0.0` are not modified.
- ❌ No new freeze tag is created in this round.
