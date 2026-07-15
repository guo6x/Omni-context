# Regression risk

Unresolved P1 risks:

1. Candidate-to-final-context ranking drops relevant evidence even when candidate recall is high.
2. Raw-event assertions increase embedding and database cost and can crowd normalized assertions without evidence-set diversity constraints.
3. Peak memory was not captured by the frozen runner, so desktop memory impact is unquantified.
4. Development-35, pairwise comparison, and ablation remain unrun by design.

No unresolved P0 was found in code, migrations, security scans, benchmark integrity, or fixed Targeted execution infrastructure.
