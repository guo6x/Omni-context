# Remaining risks

Unresolved P0: none in production code or the accepted run, subject to remote CI completion.

Unresolved P1:

1. Formal-run Recall@10 on the newly extracted graph is 0.5000, below the fixed-extraction offline F value 0.6267. Final Context Recall still passes at 0.5867, showing fusion/expansion recovers evidence after top 10, but first-page ranking needs later work.
2. Open-domain formal accuracy fell from 0.4571 to 0.4286.
3. Formal gold-evidence-present accuracy is 0.5341: above the same-method v1 recomputation (0.4928) but below the older 0.569 audit proxy.
4. Model content grows by about 422.92 MiB and local working-set demand is roughly 1.1 GB.
5. Formal total latency is P50 7.850 s / P95 12.265 s; most retrieval time is the existing mixed-candidate reranker path, not raw ANN.
6. Production dependency audits pass the configured `critical` threshold, but existing transitive high-severity advisories remain in the Brain Server, desktop frontend, and mobile dependency trees. These are release-maintenance P1 items rather than Candidate v2 regressions.
7. Bundling the pinned 552.04 MiB model makes Windows packaging slow and disk-intensive. The verified installers are therefore retained on E: and published as Release assets instead of being committed to Git.

No cross-encoder should be added inside Candidate v2. The next controlled work should examine first-page fusion/reranker behavior, especially open-domain questions, while retaining the now-correct Assertion evidence layer.
