# Expo 49 / patched tar compatibility

Expo CLI 0.10.17 compiled its tar consumers with default-import interop. tar 7.5.22 exports a CommonJS namespace marked `__esModule`, without `default`. The security override in PR #15 therefore broke both local npm template extraction and Windows JS archive extraction. Bare `tar.c/x` tests did not cover the callers.

`patch-expo-tar.cjs` changes exactly the two imports to a namespace wrapper. It runs during `npm ci`/install, accepts only the exact audited versions and upstream file hashes, preflights both files before writing, and is idempotent. Unknown changes fail installation; do not loosen the hash to make an upgrade pass. No extraction options or tar security policy are changed. It adds no dependency and does not downgrade tar.

For installations intentionally using `--ignore-scripts`, explicitly run `node scripts/patch-expo-tar.cjs` before using Expo. Then run `npm run test:expo-tar`. The suite tests the real Expo callers with local archives, template name/path transforms, gitignore renaming, binary preservation, and patch failure/idempotence. It performs no downloads or model calls.

Remove this temporary compatibility patch when an independently validated Expo upgrade provides compatible consumers. Re-run native build/runtime checks; consumer tests alone are not Android/iOS device acceptance. The added workflow checks clean installations on Windows, Linux and macOS and compiles the existing Android release task using disposable development signing only. No artifact is uploaded or published.
