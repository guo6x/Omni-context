# omctx 0.1.0-alpha.0

This is the first public-alpha candidate for the Omni-Context judgment CLI. Its
publication metadata is materialized (`private: false`, public `alpha` tag),
but it has not been published to npm and remains awaiting explicit Owner
approval.

## Included

- `help`, `version`, and machine-readable `--json` output.
- `doctor` with loopback Brain identity, protocol-version, and authentication
  checks.
- Read-only `ask`, `inspect`, and bounded `history` commands.
- Explicit Desktop-session `approve` and separate `verify` commands. Approval
  never starts execution; verification is trusted read-back and reports
  `VERIFIED`, `MISMATCH`, or `INCONCLUSIVE`.
- `reopen` remains a FUTURE command (exit code 3).

## Prerequisites

Run Omni-Context Desktop with its local Brain Server. Node.js 20 or newer is
required. The CLI accepts only loopback API URLs and resolves the read token
from `OMNI_LOCAL_API_TOKEN` or the Desktop user-scoped token file.

## Security model

The npm tarball has zero runtime dependencies and an explicit allowlist. It has
no shell/subprocess execution, direct database access, arbitrary HTTP paths, or
token command-line flags. Control sessions are short-lived and scope-specific.
Redirects are rejected and compatibility is fail-closed when the Brain health
protocol is missing or unsupported.

## Known limitations

- Desktop and a local Brain are required; remote services are unsupported.
- There is no generic execution gateway and no `reopen` implementation.
- Verification is limited to the Brain's trusted local evidence scope.
- User-scoped Windows `%LOCALAPPDATA%` storage is used, but same-user OS
  compromise and explicit ACL isolation are outside this alpha guarantee.
- Brain and Desktop dependency advisories are tracked as separate-component
  findings and are not included in the zero-dependency npm tarball.
- Unix end-to-end validation is not claimed unless a trusted Unix runtime is
  available and recorded in the release candidate.

## Publication status

`private: false`, `publishConfig.access: public`, `publishConfig.tag: alpha`,
`npm_published: false`. Publication requires a separate, explicit Owner
approval after review of the final tarball and its SHA256.
