# Reproducibility

Repository: https://github.com/guo6x/Omni-context

Product 17dc1d0107b0474de84058205a91b302ba290a74; benchmark 62b0b20f944f7e9a2c58f02ce1c65bb43dfbf841; tag evaluation-freeze-candidate-v3.1 targets the product commit. Build and manifest hashes are in `hashes.md`. Node v22.15.1, npm 10.9.2, Windows 10.0.26200 x64.

The run used `deepseek-v4-flash` for answers (max_tokens 1200, temperature 0, thinking disabled), `kimi-k2.6` for independent judge calls (provider temperature parameter omitted), and local `Xenova/multilingual-e5-large` at revision `a19b072cb4f0cc8bf98b4e46f90a787a61380979`, 1024 dimensions. Concurrency was 1. Each scenario used an isolated database and dynamic loopback port; runtime attestation checked PID/service identity and product/build/selector hashes. The provider policy allowed two retries after the initial attempt; checkpoints retained terminal results and resumed unfinished work.

Paid-provider access is required only to reproduce Answer/Judge/Extraction/Reranker model calls. All committed summaries, CSV tables, hashes, HTML, and validation checks are offline-verifiable. See `environment.md` for placeholders and `commands.md` for repository-backed commands.
