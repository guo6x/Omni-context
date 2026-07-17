# Sealed external-evaluation scaffold

This directory contains fixture-tested adapters and a phase-separated runner. It contains no official benchmark records. The pinned product is `17dc1d0107b0474de84058205a91b302ba290a74`.

Allowed in this delivery: `--fixture` and `--validate-only`. A future `--formal` invocation requires a custodian authorization file, an external generation projection with no Gold fields, a matching preregistration, and exact build/adapter hashes. `--score-only` is a separate process that receives the locked result and Gold files; it cannot invoke the product or answer provider.

```powershell
node external-eval/runners/sealed-runner.mjs --fixture --benchmark=longmemeval --output-root=<D-drive-path>
node external-eval/runners/sealed-runner.mjs --fixture --benchmark=locomo --output-root=<D-drive-path>
node external-eval/runners/sealed-runner.mjs --validate-only
```

Official datasets belong outside the repository. Do not preview or search them before authorization.

The implemented `--score-only` mode is also sealed: it requires custodian authorization and a separately pinned official scorer module. Its interface and pre-run hash-lock requirements are documented in `scoring/README.md`; it has not been invoked against external data.
