# Safety Inheritance Cases (oracle reference)

The capability registry holds the canonical safety posture for each
capability. A skill manifest may only tighten (be equal or stricter), never
loosen. Canonical default for an undefined skill field is the capability
value, and a skill field that conflicts in the loosening direction is
REJECT. Undefined = reject when both sides are undefined.

| capability                    | skill                     | expected |
|-------------------------------|---------------------------|----------|
| conflict_policy undefined     | conflict_policy allow     | REJECT   |
| conflict_policy warn          | conflict_policy allow     | REJECT   |
| conflict_policy warn          | conflict_policy reject    | PASS     |
| verification asserted         | verification undefined    | REJECT   |
| verification asserted         | verification verified     | PASS     |
| freshness 1h                  | freshness 2h              | REJECT   |
| freshness 1h                  | freshness 30m             | PASS     |

These cases are encoded as machine-readable vectors in
cp5-skill-adversarial-vectors.json under category SAFETY_INHERITANCE.