# 15 — Client and hardware E2E report

Status: `FIXED`

## Windows installed application

- Current source was built as an NSIS installer with the complete embedded Brain runtime and native SQLite module.
- Installer: 201,167,666 bytes; SHA-256 `25E460D576E1768EF97E87CBE3D881DF654707C4F1D72E90207920789FE0504B`; Authenticode status `NotSigned`.
- A prior test installation was silently uninstalled, the new installer was installed into a clean test directory, and 13,674 installed files were observed.
- The installed application started its embedded Brain and passed actual UI configuration, onboarding, file import, graph search, grounded question answering, Decision A save, Decision B save, explicit B `revises` A lineage, lineage review, application restart, persistence search, JSON export, and JSON restore.
- The restored export is 341,805 bytes with SHA-256 `DAB80F1E8DCD624AECB062E842DD8F09E3A6E433C40CAE1E16C4BD1F1D7E7FF3`.
- Silent uninstall returned 0, removed the install directory, and left zero matching application/child processes.
- This run found and fixed a real shared-SQLite transaction race triggered by concurrent onboarding and file ingestion. The installed package was rebuilt after the fix and the same path then passed.

Evidence: `evidence/15-windows-build.log`, `evidence/15-windows-installed-e2e.log`, `evidence/15-windows-install-uninstall.log`, `evidence/15-windows-*.png`, `evidence/15-windows-export.json`.

## Browser extension

- A real unpacked extension loaded in Chromium with automatic capture off by default.
- The popup paired through the one-time code and received a scoped extension token.
- A routed ChatGPT fixture was authorized and captured through the real content script/service worker path.
- A 25k+ character conversation was split into two 12k transport chunks, both Brain jobs were received, and a secret-shaped field was redacted.
- An unauthorized origin was rejected; token revocation caused capture failure and cleared the cached token; re-pair restored capture.
- Browser restart preserved settings and the newly captured content was deleted through the real admin import/replace path.
- Unit/contract suite: 14/14.

Evidence: `evidence/15-browser-extension-e2e.log`, `evidence/15-browser-extension-tests.log`, `evidence/15-browser-brain-server.log`, `evidence/15-browser-*.png`.

## ESP32 simulator

- A test device was registered with generated test-only credentials and the registry was reloaded to prove persistence without exposing credentials.
- The real UDP listener accepted signed heartbeat, precipitate, decision, and reset packets. Precipitate completed a verifiable mock ingest business action; decision opened the decision assistant; reset explicitly left user memory untouched.
- Replay, bad signature, unknown device, expired timestamp, and revoked device packets were all rejected with receipts.
- Rust suite: 10/10.

Evidence: `evidence/15-hardware-rust-tests.log`, `evidence/16-rust-full-regression.log`.
