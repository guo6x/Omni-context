# 17 — Remaining risks

Status: `FIXED`

## P0 freeze blockers

None. Unresolved P0 count: 0.

## P1 risks retained in the candidate

- Manual binary review agreed with the same-model Judge on 12/15 stratified official cases. The three disagreements show over-crediting of abstention or unsupported multi-hop inference; Answer and Judge are both `deepseek-v4-flash`.
- Extraction is source-grounded in the five-session manual sample, but provider predicates frequently normalize to `relates_to` and 182 extracted principles show coarse semantic granularity.
- The Windows NSIS installer is not Authenticode signed.
- Production audits report zero critical advisories, but high-severity advisories remain: `xlsx` has no fixed release in the current line; the Desktop Next.js and Mobile Expo graphs require breaking upgrades for full remediation.

These risks do not alter, suppress, or exclude any Conversation 1 result. They remain explicit inputs to the later final Freeze decision.
