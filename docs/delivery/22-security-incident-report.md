# Security Incident Report

**Date:** 2026-07-12 | **Branch:** pre-evaluation-hardening-v1

## 1. Incident Summary

**Type:** Historical API Key Exposure
**Severity:** HIGH (at time of exposure)
**Current Status:** MITIGATED

API keys were found in the public git history of the Omni-Context repository. The exact commits and files have been identified but are not reproduced here to avoid further exposure.

## 2. Timeline

| Phase | Detail |
|-------|--------|
| Discovery | During pre-evaluation hardening security audit |
| Immediate action | User confirmed keys revoked on provider side (OpenAI, Anthropic, etc.) |
| Code audit | Current working tree confirmed clean |
| Prevention | Secret scanning added at 3 levels |

## 3. Impact Assessment

| Item | Detail |
|------|--------|
| Keys exposed | OpenAI API keys, other provider keys |
| Exposure window | From commit date to revocation date |
| Revocation status | CONFIRMED by user |
| Current risk | ZERO (keys invalid) |
| Residue risk | git history still contains keys (requires git-filter-repo to purge) |

## 4. Remediation

### Immediate (COMPLETED)
1. Keys revoked on provider consoles
2. All .env files added to .gitignore
3. scripts/scan-secrets.mjs created with 8 content rules + 4 path rules

### Short-Term (COMPLETED)
4. Pre-commit scan: scripts/scan-secrets.mjs (4 tests passing)
5. CI scan: .github/workflows/ci.yml includes gitleaks/gitleaks-action
6. .env.example checked: no real keys

### Long-Term (DEFERRED)
7. git-filter-repo to purge history (requires force-push; blocked until post-freeze to avoid disrupting current branch)
8. Repository secret scanning enabled on GitHub

## 5. Preventative Measures Now Active

| Measure | Location |
|---------|----------|
| Pre-commit scan | scripts/scan-secrets.mjs |
| CI secret scan | .github/workflows/ci.yml: gitleaks |
| Path exclusions | .env, .claude, .key, .pem, .p12, .jks, .keystore |
| Content patterns | 8 provider-specific key patterns + generic assignment pattern |
| Placeholder detection | example, placeholder, test-, dummy, fake, redacted |
| ESLint no-unused-vars | Catches accidental config file imports |

## 6. Verification

| Check | Result |
|-------|--------|
| Current working tree | CLEAN (scan-secrets.mjs passes) |
| .gitignore coverage | VERIFIED (.env, .claude, token files) |
| Pre-commit hook | 4 tests pass |
| CI pipeline | gitleaks stage present |

## 7. Remaining Action

- [ ] Run git-filter-repo to purge exposed keys from git history
- [ ] Enable GitHub secret scanning for repository
- [ ] Rotate all remaining keys post-filter-repo
