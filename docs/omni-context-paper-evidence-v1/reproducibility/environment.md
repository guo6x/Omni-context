# Environment

Actual execution used Windows on a D-drive workspace. Portable placeholders are mandatory:

- `<REPO_ROOT>`: repository checkout
- `<MODEL_ROOT>`: local embedding model repository root
- `<RUN_ROOT>`: isolated run/artifact root

Example shape from the actual Windows environment: `D:\<WORKSPACE>\benchmark`, `D:\<MODEL_STORAGE>`, and `D:\<RUN_STORAGE>`. Do not treat those examples as required locations.

Environment template (no secrets):

```powershell
$env:EMBEDDING_LOCAL_MODEL_PATH='<MODEL_ROOT>'
$env:DEEPSEEK_API_KEY='<SET_LOCALLY_FOR_PAID_RUNS>'
$env:KIMI_API_KEY='<SET_LOCALLY_FOR_PAID_RUNS>'
```

Never commit real values.
