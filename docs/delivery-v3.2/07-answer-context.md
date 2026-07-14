# Answer evidence context

Answer input is rendered as labeled human-readable blocks:

```text
Evidence ID: <stable id>
Fact: <readable fact>
Source quote: <source span>
Subject: <name>
Relation: <original predicate when available>
Object: <name or literal>
Time: <event/validity>
Status: current|historical|invalidated
Confidence: <value>
```

UUIDs remain legal reference IDs but cannot become fact prose. Strict JSON answer validation, claim-to-Evidence-ID binding, illegal-ID rejection, `deepseek-v4-flash`, and `thinking=disabled` remain unchanged. The prompt change is limited to the new evidence format and is hash-versioned as `answer-v2` / `answer-evidence-context-v2`.
