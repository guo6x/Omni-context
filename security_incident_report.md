# Security Incident Report: Historical API Credential Exposure

Status: **PARTIALLY_FIXED**

Severity: **P0 until provider-side revocation is confirmed**

Assessment date: 2026-07-11

Assessment baseline: `bf211d91322f20be29a2bbf623802b883699dbc1`

## Executive summary

The Git history contains API credential material in `.claude/settings.local.json`. The repository also tracked the Android debug signing key at `mobile-app/android/app/debug.keystore`. Deleting a file in a later commit does not remove it from earlier commits. Any credential that appeared in the Claude settings file must be treated as compromised, and the debug signing key must never be trusted outside local debug builds.

No credential values are reproduced in this report, test output, logs, or commit messages.

## Verified evidence

Gitleaks 8.30.1 scanned 109 commits with redaction enabled. Its Windows x64 release archive was verified against the publisher's SHA-256 checksum before execution.

The scan produced nine `generic-api-key` findings, all in `.claude/settings.local.json`:

| Commit | Finding count |
| --- | ---: |
| `2d123f338fd63ed7e0fff99f27e280540f250915` | 3 |
| `2d7c937720c5ce3ab573cea8c84280c1b016e159` | 3 |
| `67828ee628125cf875f7ddf85bb8cb42c57f9d70` | 1 |
| `ffe2c97deab5e726958b92afbc4156c371603234` | 2 |

The sensitive file was removed in commit `1c09c31e14c461a94281a091ab69a7c65bfc6399`. That removal stopped current-tree exposure but did not sanitize history.

`mobile-app/android/app/debug.keystore` entered history in commit `98bdec9a36b23c2c34012a6544df8ecd5cb3d42b`. The hardening branch removes it from the tracked tree and ignores all keystore files. Android tooling may generate a per-machine debug keystore when needed; no shared debug private key is required in source control.

## Required provider-side response

Only the credential owner can complete these actions:

1. Revoke every credential that was ever stored in the affected file.
2. Review provider audit logs from the first exposed commit through the revocation time.
3. Create replacement credentials with the minimum required scopes.
4. Store replacements only in OS-protected credential storage or environment variables.
5. Confirm revocation before Freeze v1. Until then, this incident remains P0 and Freeze v1 is blocked.

## History rewrite plan

Coordinate this rewrite with every contributor because all existing clones and open branches will contain the old objects.

```powershell
# Work in a fresh mirror clone after provider-side revocation.
git clone --mirror <repository-url> omni-context-clean.git
Set-Location omni-context-clean.git

# Remove the entire sensitive file from every reachable ref without handling
# or embedding any credential value in the command.
git filter-repo `
  --path .claude/settings.local.json `
  --path mobile-app/android/app/debug.keystore `
  --invert-paths `
  --force

# Re-scan all rewritten history before publishing it.
gitleaks git . --redact --no-banner

# Publish only after review and explicit owner approval.
git push --force --mirror
```

After the rewrite, invalidate or delete old forks, cached archives, CI artifacts, and local clones. Contributors must clone again rather than merge from an old clone. GitHub support may be needed to purge cached views or unreachable sensitive objects.

The history rewrite is intentionally **not executed** by this hardening branch: it is a destructive repository-wide operation requiring credential-owner confirmation and coordinated force-push approval.

## Preventive controls added in this hardening branch

- Removed the tracked Android debug keystore and expanded ignore rules for environment files, local Claude settings, package-manager credentials, tokens, private keys, keystores, and service-account files.
- A dependency-free scanner for tracked and staged text files. Findings contain only rule, path, and line number.
- A versioned pre-commit hook at `.githooks/pre-commit`.
- A GitHub Actions workflow that runs the repository scanner and Gitleaks on every push and pull request.
- Unit tests verifying sensitive paths, redacted output data, and placeholder handling.

Install the repository hook once per clone:

```powershell
npm run security:install-hooks
```

## Verification and remaining risk

Implementation commit: `9e15a79cd1feb0af480aa1d4a323128e7591a692`.

Modified files: `.gitignore`, `package.json`, `.githooks/pre-commit`, `scripts/scan-secrets.mjs`, `scripts/scan-secrets.test.mjs`, `.github/workflows/security.yml`, `mobile-app/android/app/debug.keystore`, `security_incident_report.md`.

Automated tests: scanner unit tests, current tracked-tree scan, staged scan, and redacted Gitleaks current/history scans.

Remaining risks: provider revocation is unconfirmed; history has not been rewritten; GitHub-hosted workflow has not yet run; the wider local API authorization model is audited separately.
