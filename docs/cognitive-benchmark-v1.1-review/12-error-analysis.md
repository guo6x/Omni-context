# Error Analysis

The original temperature incompatibility is fixed by omitting the field and its three HTTP 400 records are preserved as historical evidence. The current runtime blocker is Kimi structured-output reliability:

- Corrected calls: 26; provider errors: 0; fallbacks: 0.
- Schema failures: 9, primarily truncated JSON plus one fenced JSON response.
- Final sequence: calls 24, 25, and 26 all failed schema parsing.
- Stop condition: three consecutive schema errors during No Memory.

The adapter classifies malformed model JSON as schema failure rather than provider failure and persists every attempt. No replacement judge was used. Full Omni completed only after ordinary bounded retries; the stop condition was then honored during No Memory.
