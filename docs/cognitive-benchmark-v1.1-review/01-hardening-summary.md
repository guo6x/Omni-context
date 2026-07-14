# Cognitive Benchmark v1.1 Hardening Summary

Judge Adapter v2.1 raises the Kimi K2.6 completion cap from 600 to 1200, keeps the temperature field omitted, preserves disabled thinking and JSON Schema preference, constrains diagnostic text, parses only complete JSON, classifies truncation, and separates logical calls from physical attempts. The scoring anchors and `kimi-judge-rubric-v2` are unchanged.

The nine-fixture reliability run completed 9/9 logical calls using 10 physical attempts. It recorded no truncation, no Markdown, no provider error, and one schema-validation retry recovery. Across all final work, Kimi completed 31/31 logical calls in 33 physical attempts; both schema failures recovered and no fallback was used.

Development is complete: Full Omni 35/35, No Memory 21/21, and Retrieval-Only 21/21. Full Omni was not rerun: its 10 saved subjective answers were rejudged from archived results, with old and new scores retained separately. Final-score-based Secondary Agent Review completed 20/20 and is not human review.

Formal Draft remains unfrozen. Formal 250, Comparison 70, and LoCoMo Conversations 2–10 were not run. Final Freeze and Candidate tags were not modified.
