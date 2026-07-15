# Cross-Agent Generator Fix

Cross-Agent facts now select an `actualAgent` before constructing the event. The same canonical `Agent-X` value supplies `event.agent`, the leading text label, and dynamic `gold.required_sources`.

Easy scenarios correctly deduplicate wrapped sources to Agent-A and Agent-B. Incorrect reports use a real assigned Agent plus low confidence, conflict, and `low_confidence_agent_report` metadata. The invariant suite covers all Smoke, Development, and Formal Cross-Agent scenarios across Easy, Medium, Hard, and conflict cases.
