# Final Freeze Readiness

The freeze payload is ready for exact-commit CI when all local tests and the secret scan pass and the commit contains only the Final Freeze Manifest, held-out authorization guard, Synthetic tests, reports, and necessary test wiring.

The freeze becomes complete only after the exact payload commit is pushed, its GitHub Actions run succeeds 9/9, and the annotated tag binds that commit, Manifest hash, and CI URL without moving Candidate v1 or v2. Until that tag exists, held-out access remains denied.

After the annotated tag is created and pushed, formal Conversation 2–10 execution is permitted only while every runtime gate check still matches. Any changed commit, dirty worktree, missing tag, changed Manifest, config, prompts, Embedding Profile, or model configuration causes fail-fast rejection before held-out data access.
