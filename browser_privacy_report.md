# Browser Privacy Hardening Report

Assessment date: 2026-07-11

Overall status: **PARTIALLY_FIXED**

## Control status

| Requirement | Status | Implementation evidence | Remaining risk |
| --- | --- | --- | --- |
| Automatic capture default | **FIXED** | New installs default to `autoCapture: false`; legacy settings without consent version are migrated to off and their automatic-domain allowlist is cleared | Real Chrome update path has not yet been exercised |
| Explicit first enable | **FIXED** | Enabling auto capture shows a remote-LLM notice and confirmation, then explicitly enables the current domain | Browser UI interaction still needs packaged extension QA |
| Domain allowlist/blocklist | **FIXED** | Central privacy policy; popup allow/block controls; background enforcement | List management is current-domain oriented rather than a full editor |
| Per-domain automatic capture | **FIXED** | Automatic capture requires both a supported AI host and an explicit allowed-domain entry | Additional AI sites require a reviewed manifest and policy change |
| Sensitive-site default denial | **FIXED** | Mail, account/login, payment, banking/health patterns, and password-manager sites are blocked unless explicitly allowed | Pattern lists cannot identify every sensitive private deployment |
| Capture preview | **FIXED** | Popup, floating button, and context-menu flows show redacted text plus send counts before manual capture | Automatic capture relies on the one-time explicit domain authorization rather than per-event confirmation |
| Sensitive-field redaction | **FIXED** | Private keys, bearer/API tokens, password fields, and card-like values are redacted before transport; counts are shown and logged | Heuristic redaction cannot guarantee detection of every secret format |
| Remote LLM notice | **FIXED** | Enable and preview dialogs state that configured remote LLM processing may send content off-device | Brain Server still needs a unified remote-call audit and disable switch |
| Actual send size | **FIXED** | Background returns and audits the exact formatted character count and current payload chunk count | Server-side semantic chunk coverage is not implemented yet; current transport payload is one chunk |
| Pause | **FIXED** | Global pause is enforced by the background policy, not just hidden in UI | Packaged browser QA pending |
| Capture audit log | **FIXED** | Stores up to 200 content-free audit entries with domain, source, automatic/manual, counts, redactions, job state, and result counts | No export UI yet |
| Undo/delete latest capture | **NOT_FIXED** | No safe reverse operation exists because current ingest jobs do not retain all created/updated assertion IDs | Requires transactional ingest provenance and reversible update semantics; must not be faked by deleting guessed entities |
| Browser device token | **PARTIALLY_FIXED** | Popup exchanges a 6-digit short-lived pairing code for a scoped `browser_extension` token; direct admin token paste is removed | Token is stored in `chrome.storage.local`; revocation UI and storage-at-rest hardening need packaged-browser work |
| Content-script permissions | **FIXED** | Removed `<all_urls>` persistent injection; declarative scripts are limited to ChatGPT, Claude, and Gemini. Other pages require an explicit active-tab action | Active-tab manual capture remains intentionally available |
| DOM selector fixtures | **FIXED** | JSDOM fixtures cover ordered ChatGPT, Claude, and Gemini user/assistant turns | Live-site DOM changes can still outpace fixtures |
| Automatic deduplication | **FIXED** | Replaced simple 32-bit hash with Web Crypto SHA-256; failure stops automatic capture visibly | Cross-device semantic duplicate detection remains server-side work |
| Service Worker recovery | **PARTIALLY_FIXED** | Existing persisted pending-job recovery remains; audit IDs now follow recovered jobs | No dedicated mocked Chrome Service Worker lifecycle test yet |

## Modified files

- `browser-extension/privacy.js`
- `browser-extension/privacy.test.js`
- `browser-extension/extractor.js`
- `browser-extension/extractor.test.js`
- `browser-extension/background.js`
- `browser-extension/content.js`
- `browser-extension/popup.js`
- `browser-extension/popup.html`
- `browser-extension/manifest.json`
- `browser-extension/package.json`
- `browser-extension/package-lock.json`
- `brain-server/src/security/auth.ts`
- `brain-server/tests/auth.test.ts`

## Automated verification

- Privacy-policy and consent-migration unit tests: passed.
- ChatGPT/Claude/Gemini fixture and SHA-256 signature tests: passed.
- JavaScript syntax checks: passed after correcting an async callback regression found by the first run.
- Extension Tailwind build: passed; Browserslist emitted an outdated-data warning.
- Brain Server typecheck and auth scope tests: passed.
- Real unpacked Chrome extension test: **NOT_VERIFIED**. Installed Chrome in headless Playwright did not load the MV3 Service Worker; the harness closed cleanly and no runtime claim is made.

## Freeze impact

Browser privacy is not Freeze-ready until safe undo is backed by transactional ingest provenance and the unpacked/package extension is exercised in a real browser. The default-on and broad persistent injection risks are closed in code, but the report deliberately remains `PARTIALLY_FIXED`.
