# Commit manifest

Candidate v2 was built as a sequence of reviewable commits from the immutable Candidate v1 commit, rather than one aggregate change.

| Area | Commits |
|---|---|
| Usage profile and prefixes | `eb06fee` |
| Index manifests and dimensions | `cceb20e`, `6988f00` |
| Assertion/entity serialization and retrieval | `1cdf525`, `117edc9`, `d67d0f4` |
| Human-readable answer evidence | `edb1321` |
| Resumable rebuild and index integrity | `4be667e`, `d1a63e4`, `7a26b72`, `7456b5e`, `0936839` |
| Runtime/test fixture correctness | `6628de6`, `86e08a7`, `293618c`, `c292f19`, `4684f2c` |
| Ablation and fixed sample | `5fee1fe`, `52f12fe`, `92013a3` |
| Snapshots, retry/resume, archival, analysis | `44363e3`, `a532a0e`, `09bb7e0`, `7db7323`, `6c2bd00` |
| Preserved specialist audit | `8ec2c10` |
| Pinned desktop packaging | `0f7d0be`, `d4e25e9` |

The final delivery/evidence commits and their exact HEAD are appended by Git history itself; the Candidate v2 annotated tag, if admitted, points at the final clean delivery commit. Candidate v1 is neither amended nor moved.
