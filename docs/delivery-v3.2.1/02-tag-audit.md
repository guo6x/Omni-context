# Candidate Tag Audit

Remote audit confirms Candidate v1 and v2 remain immutable and correctly targeted.

| Candidate | Tag object | Peeled commit | Status |
| --- | --- | --- | --- |
| v1 | `58188929d473b513ba5ad36b9cbdcbe0c52ffab0` | `3bdb6e106832854a9bc94672fc74fafa8f7e221f` | Not moved |
| v2 | `a481d588acede7c25747701dac40ac133f0e6707` | `be20db60bef32a886fddde4986013cf40a1e8ec5` | Not force-updated |

Remote branch `pre-evaluation-hardening-v3.2` points to the v2 commit. This sealing work is isolated on `codex/pre-evaluation-hardening-v3.2.1`, based on v2, and does not move either tag.

The formal run did not execute the later archive/report commit itself. Its accepted question-phase runtime tree matches Candidate v2's Benchmark runtime scope and complete Brain Server tree. Machine evidence: `evidence/tag-audit.json` and `evidence/source-tree-provenance.json`.
