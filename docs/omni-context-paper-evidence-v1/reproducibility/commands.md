# Commands

These commands exist in the frozen repository. The evidence package itself can be checked without provider calls.

```powershell
Set-Location <REPO_ROOT>
node docs/omni-context-paper-evidence-v1/validation/validate_evidence.mjs
npm run security:secrets
npm --prefix benchmark/cognitive test
npm --prefix brain-server test
npm --prefix brain-server run typecheck
npm --prefix brain-server run build
```

The historical evaluation commands and checkpoint/resume protocol are documented in the committed stage READMEs and manifests. Do not rerun paid stages merely to validate this package.
