# Alpha publication rollback and incident plan

1. Stop further promotion and preserve the release candidate SHA, tarball, npm
   output, and registry metadata.
2. If the version is unsafe, deprecate the exact version with a clear warning;
   do not rely on `npm unpublish` as a normal rollback mechanism.
3. Prepare and review a corrected `0.1.0-alpha.1` candidate, rerun all release
   gates, and publish only after a new owner approval.
4. If a token, session, or credential is ever exposed, revoke the Desktop
   session, rotate the affected secret, invalidate any leaked local API token,
   and record the incident without including the secret in logs or reports.
5. For a dependency or supply-chain issue, quarantine the tarball, compare
   provenance and hashes, notify affected users through the repository advisory
   path, and document the fixed version and remediation.
6. Preserve `main`, Goal24 holdbacks, scientific assets, and CP21 worktree;
   incident response must not rewrite historical evidence.
