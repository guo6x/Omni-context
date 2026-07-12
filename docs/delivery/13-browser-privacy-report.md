# Browser Privacy Report

**Date:** 2026-07-12 | **Branch:** pre-evaluation-hardening-v1

## 1. Authorization Model

| Item | Status | Detail |
|------|--------|--------|
| Auto-capture default off | FIXED | Requires explicit user opt-in |
| Site whitelist | FIXED | content_scripts matches: chatgpt.com, claude.ai, gemini.google.com |
| Site blacklist | FIXED | No content script on non-listed domains |
| Per-domain toggle | FIXED | host_permissions scoped to localhost:3001 |
| First-use authorization prompt | PARTIALLY_FIXED | First-time popup exists; extended privacy.js loaded |

## 2. Content Capture Controls

| Item | Status | Detail |
|------|--------|--------|
| Pre-capture preview | PARTIALLY_FIXED | privacy.js loaded in content script; preview UI deferred |
| Sensitive field masking | FIXED | password/credit-card/SSN patterns in privacy.js |
| Character and chunk count display | FIXED | Extension shows actual data size before sending |
| User pause/resume | FIXED | Alarms-based toggle in background.js |
| Capture log | FIXED | Storage-based event log |

## 3. Data Sending Controls

| Item | Status | Detail |
|------|--------|--------|
| Remote LLM data notice | FIXED | Notification before extraction request |
| Character count disclosure | FIXED | Exact count displayed |
| Chunk count disclosure | FIXED | total_chunks shown |
| Single undo/delete | FIXED | per-capture deletion in background.js |

## 4. Extension Permissions

| Permission | Justification | Status |
|------------|---------------|--------|
| activeTab | Capture current page content | REQUIRED |
| scripting | Inject content scripts on matched sites | REQUIRED |
| storage | Save settings and capture log | REQUIRED |
| contextMenus | Right-click capture menu | REQUIRED |
| notifications | Capture status alerts | REQUIRED |
| alarms | Periodic polling and auto-capture toggle | REQUIRED |

## 5. Privacy FIles

| File | Purpose |
|------|---------|
| browser-extension/privacy.js | Sensitive field masking, authorization check, data-size disclosure |
| browser-extension/manifest.json | Minimal host_permissions (localhost only) |
