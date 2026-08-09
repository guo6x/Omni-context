# Validation V2 Change Log (Goal 18H-E)

Date: 2026-08-09T10:50:20.101Z
Repository: D:\ai_code\Omni-context
Branch: research/decision-benchmark-holdback-v2
Base HEAD (pre-repair): fcbf9d22518798decf36623a5dc12f159d87c547
Generator repair commit: a17864b931fbcbd8761dd46a94fc06054f1f981e

## What changed

Validation V2 is the frozen input set for Goal 20. The pre-repair authoritative
files were:

- fixture: `goal18-output/validation-set.jsonl` (120 lines, CRLF)
- gold: `goal18-output/validation-gold.jsonl` (120 lines)
- manifest: `goal18-output/validation-manifest.json`

The post-repair frozen files are:

- `goal18he-output/validation-v2-fixture.jsonl`
- `goal18he-output/validation-v2-gold.jsonl`
- `goal18he-output/validation-v2-manifest.json`

## Old -> new hashes

| Artifact | Old SHA-256 | New SHA-256 |
| --- | --- | --- |
| fixture | 59e924631934a8712f05daedc269c4f27791bf86b97ed11fa5f1af0bdb3cbf34 | e884bf7d4e95d4ae805e0daaba22614959bf17b4f14da4f28d237a65e57ec08b |
| gold | 763da3c34446e269c9735545c8ba427910ca33d687c8fb3ed7e0ea3f7e18baed | 7bb38f4bd224f6729cf8f8761ecacefae35c1740b754abd9d65543682fd29440 |
| manifest | 01e5efed8b5a1fd9062672157060cfaf2aa903d5fe8bd98fe6518df3b4353af7 | e0a56ef0337502ba803cb45bf0f6e1f2e22ea7518786ce1dc81b190c490a4f8d |

## Changed samples (9 = 1 TT03 + 8 TT15)

- decision-bench-v2-val-tt03-002 (HREV-052): L0 authority slot repaired from
  DECIDE to REJECT/no_feasible_option. All candidates now violate a hard
  constraint; gold REJECT, acceptable_actions [REJECT], coded_reason
  no_feasible_option, lineage none.
- decision-bench-v2-val-tt15-000..007 (HREV-088/089/090 + full-audit extension):
  qualified ev001 re-expressed as evidence of the delete event e004
  (source_ref=e004, at=e004.at, supports=[]). ex001 remains source_deleted and
  prohibited; ev002 cascade-invalidation principle preserved; gold unchanged
  (INVALIDATE, lineage invalidate(parent=decision-d1)).

## Reasons (deterministic, frozen-contract grounded)

1. HREV-052: frozen authority contract gives no AI decision right at L0/L1
   (can_decide=false, decision_right=user; DECIDE gate requires "authority
   allows"). A TT03 slot at L0/L1 has no legal compliant branch, so the
   generator's deterministic rule produces the REJECT path.
2. TT15: frozen source-lifecycle contract forbids current qualified evidence
   sourced from an explicitly deleted event (RI-06; G:94-99). The generator
   defect was systemic across all 8 TT15 samples and is fixed in the generator
   source, not by patching JSON output.

## Invariants preserved

- Round 1/2 raw, agreement, agreement report, rubric, crosswalk, scorer v1.1,
  Decision Kernel, prompts, model config, budgets, statistical policy:
  byte-unchanged.
- Holdback V2: sealed SHA unchanged (4737bc7746825cac27938682f1a82ada28044d8122a5c2b6c35a67efb54adbd3);
  plaintext never read/decrypted.
- No HR1 answer and no model output was used to choose any gold.
- No A0-A5 formal run; no formal Validation output exists.
- Validation V2 remains exactly 120 = 15 x 8 samples with controlled IDs.
