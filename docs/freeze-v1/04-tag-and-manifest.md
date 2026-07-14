# Tag and Manifest Binding

The freeze Manifest is `docs/freeze-v1/omni-context-evaluation-freeze-v1.json`. It uses `freeze_commit_pending: true` because writing its own commit SHA into the same Git object is self-referential.

The annotated tag `omni-context-evaluation-freeze-v1` resolves the binding. Its message must record the exact peeled commit, exact Manifest SHA-256, Candidate v2 identity, formal Run identity and provenance, database/results/metrics/config hashes, exact Final Freeze CI URL and 9/9 result, Conversation 1 integrity, pre-freeze held-out access state, human-review state, and unresolved P0 count.

The held-out gate independently verifies that the tag is annotated, HEAD matches its peeled commit, the tag authorization is exact, the tag records the expected Manifest path, and the current Manifest bytes match the tag-recorded hash. Candidate v1 and v2 tags remain unchanged.
