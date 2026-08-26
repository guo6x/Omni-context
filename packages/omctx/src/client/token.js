/**
 * Local API token resolution. Priority:
 *   1. OMNI_LOCAL_API_TOKEN environment variable
 *   2. the real Omni Desktop local token file
 *      (Windows: %LOCALAPPDATA%/omni-context/local-token.txt,
 *       Unix:    ~/.omni-context/local-token.txt)
 *
 * The token is NEVER accepted as a CLI argument (shell history leak) and
 * is NEVER copied into any new omctx config file.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function desktopTokenFilePath(env = process.env) {
  if (env.LOCALAPPDATA) {
    return join(env.LOCALAPPDATA, 'omni-context', 'local-token.txt');
  }
  if (env.HOME) return join(env.HOME, '.omni-context', 'local-token.txt');
  return join(homedir(), '.omni-context', 'local-token.txt');
}

export function controlSessionFilePath(env = process.env) {
  if (env.LOCALAPPDATA) return join(env.LOCALAPPDATA, 'omni-context', 'control-session.json');
  if (env.HOME) return join(env.HOME, '.omni-context', 'control-session.json');
  return join(homedir(), '.omni-context', 'control-session.json');
}

export function verificationSessionFilePath(env = process.env) {
  if (env.LOCALAPPDATA) return join(env.LOCALAPPDATA, 'omni-context', 'verification-session.json');
  if (env.HOME) return join(env.HOME, '.omni-context', 'verification-session.json');
  return join(homedir(), '.omni-context', 'verification-session.json');
}

/** Resolve the ephemeral Desktop-minted approve-only session. */
export function resolveControlSession(env = process.env, now = Date.now()) {
  const path = controlSessionFilePath(env);
  if (!existsSync(path)) return null;
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.token !== 'string' || !parsed.token || parsed.scope !== 'control:approve') return null;
  if (typeof parsed.expires_at !== 'string' || !Number.isFinite(Date.parse(parsed.expires_at)) || Date.parse(parsed.expires_at) <= now) return null;
  return { source: 'file', token: parsed.token, expires_at: parsed.expires_at, scope: parsed.scope };
}

/** Resolve the separate, short-lived Desktop-minted verify session. */
export function resolveVerificationSession(env = process.env, now = Date.now()) {
  const path = verificationSessionFilePath(env);
  if (!existsSync(path)) return null;
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.token !== 'string' || !parsed.token || parsed.scope !== 'control:verify') return null;
  if (typeof parsed.expires_at !== 'string' || !Number.isFinite(Date.parse(parsed.expires_at)) || Date.parse(parsed.expires_at) <= now) return null;
  return { source: 'file', token: parsed.token, expires_at: parsed.expires_at, scope: parsed.scope };
}

/**
 * Resolve the token. Returns { source: 'env' | 'file', token } or null.
 * The token value never leaves the caller's local scope and is never
 * printed by any command path.
 */
export function resolveLocalToken(env = process.env) {
  const fromEnv = (env.OMNI_LOCAL_API_TOKEN || '').trim();
  if (fromEnv) return { source: 'env', token: fromEnv };
  const path = desktopTokenFilePath(env);
  if (existsSync(path)) {
    const fromFile = readFileSync(path, 'utf8').trim();
    if (fromFile) return { source: 'file', token: fromFile };
  }
  return null;
}

/**
 * True when the CLI was offered a token as a CLI argument (always a
 * usage error - the parser rejects it before any network call).
 */
export function tokenArgumentPresent(argv) {
  return argv.some((arg) => arg === '--token' || arg.startsWith('--token=') || arg === '--control-token' || arg.startsWith('--control-token='));
}
