/**
 * Goal24 distribution security validator.
 *
 * D1B-0 and D1B-1 deliberately have different public-control rules. This
 * validator reads the D1B-0 historical commit for the legacy phase instead
 * of applying an obsolete "no approve route" rule to the later D1B-1 branch.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const D1B0_HISTORICAL_REF = 'a902ac4fc804459f07a09b84494a68c8bd7f618b';
const root = process.cwd();
const phaseFlagIndex = process.argv.indexOf('--phase');
const requestedPhase = process.argv.find((argument) => argument.startsWith('--phase='))?.slice('--phase='.length)
  ?? (phaseFlagIndex >= 0 ? process.argv[phaseFlagIndex + 1] : undefined)
  ?? 'd1b0';
const phase = requestedPhase.toLowerCase();
assert.ok(['d1b0', 'd1b1'].includes(phase), '--phase must be d1b0 or d1b1');

function historicalContents(relativePath) {
  return execFileSync('git', ['show', `${D1B0_HISTORICAL_REF}:${relativePath}`], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function contents(relativePath) {
  return phase === 'd1b0'
    ? historicalContents(relativePath)
    : fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  if (phase === 'd1b0') {
    try {
      execFileSync('git', ['cat-file', '-e', `${D1B0_HISTORICAL_REF}:${relativePath}`], {
        cwd: root,
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  }
  return fs.existsSync(path.join(root, relativePath));
}

function readJson(relativePath) {
  return JSON.parse(contents(relativePath));
}

function validateD1b0HistoricalArtifacts() {
  const required = [
    'docs/goal24/distribution/d1b0/cargo-audit.json',
    'docs/goal24/distribution/d1b0/cargo-tree-windows.txt',
    'docs/goal24/distribution/d1b0/brain-npm-audit.json',
    'docs/goal24/distribution/d1b0/desktop-npm-audit.json',
    'docs/goal24/distribution/d1b0/dependency-audit-classification.json',
    'docs/goal24/distribution/d1b0/trust-boundaries.json',
    'docs/goal24/distribution/d1b0/public-control-attack-surface.json',
    'docs/goal24/distribution/d1b0/d1b0-architecture-decisions.json',
    'docs/goal24/distribution/d1b0/d1b0-readiness-gate.json',
    'docs/goal24/distribution/d1b0/public-control-threat-model.md',
  ];
  for (const file of required) assert.ok(exists(file), `missing ${file} at historical D1B-0 ref`);

  const classification = readJson('docs/goal24/distribution/d1b0/dependency-audit-classification.json');
  assert.equal(classification.unknown_count, 0);
  assert.equal(classification.fix_before_d1b, 0);
  assert.equal(classification.blocks_d1b, 0);
  assert.equal(classification.cargo_audit.completed, true);
  assert.equal(classification.npm_audits.brain.completed, true);
  assert.equal(classification.npm_audits.desktop.completed, true);
  assert.equal(classification.entries.length, 42);
  for (const entry of classification.entries) {
    assert.notEqual(entry.classification, 'UNKNOWN', `${entry.source}:${entry.package || entry.crate}`);
    assert.ok(Array.isArray(entry.dependency_path || entry.dependency_path_evidence));
  }

  const gate = readJson('docs/goal24/distribution/d1b0/d1b0-readiness-gate.json');
  for (const field of [
    'authoritative_base_exact', 'rustsec_db_fresh', 'cargo_audit_completed',
    'brain_npm_audit_completed', 'desktop_npm_audit_completed', 'threat_model_complete',
    'attack_surface_inventory_complete', 'control_transport_selected', 'approval_auth_model_selected',
    'verify_auth_model_selected', 'browser_origin_policy_selected', 'approval_schema_frozen',
    'verify_schema_frozen', 'replay_policy_frozen', 'retry_policy_frozen', 'audit_policy_frozen',
    'rate_limit_policy_frozen', 'same_user_limit_documented', 'd1b1_prerequisites_complete',
    'd1b2_prerequisites_defined',
  ]) assert.equal(gate[field], true, `gate field ${field}`);
  assert.equal(gate.gate_status, 'PASS');

  const omctx = JSON.parse(contents('packages/omctx/package.json'));
  assert.equal(omctx.private, true);
  assert.equal(Object.keys(omctx.dependencies || {}).length, 0);
  assert.equal(omctx.version, '0.1.0-alpha.0');

  const locked = contents('packages/omctx/src/commands/locked.js');
  assert.match(locked, /controlSurfaceLocked/);
  assert.doesNotMatch(locked, /fetch\(|readFile|writeFile|spawn|execFile|sqlite|http/);
  const routes = contents('brain-server/src/api/routes.ts');
  assert.doesNotMatch(routes, /\/api\/control\/(approve|verify)/);
  const client = contents('packages/omctx/src/client/omni-local-client.js');
  assert.match(client, /redirect:\s*'error'/);
  const inventory = readJson('docs/goal24/distribution/d1b0/public-control-attack-surface.json');
  assert.equal(inventory.generic_escape_surfaces_found, 0);
  assert.equal(inventory.blocking_escape_surfaces, 0);
  assert.ok(inventory.items.length >= 10);

  console.log('D1B0_HISTORICAL_REF=' + D1B0_HISTORICAL_REF);
  console.log('D1B0_ARTIFACT_VALIDATION=PASS');
  console.log(`D1B0_DEPENDENCY_ENTRIES=${classification.entries.length}`);
  console.log('D1B0_GATE=GATE_VERIFIED');
}

function scanControlPaths(relativePaths) {
  const found = new Set();
  for (const relativePath of relativePaths) {
    const source = contents(relativePath);
    for (const match of source.matchAll(/\/(?:api\/control|internal\/(?:control|native))\/[A-Za-z0-9_:/.-]+/g)) {
      found.add(match[0]);
    }
  }
  return [...found].sort();
}

function validateD1b1ControlSurface() {
  const routePaths = scanControlPaths([
    'brain-server/src/api/routes.ts',
    'brain-server/src/control/native-bridge.ts',
    'desktop-daemon/src-tauri/src/commands.rs',
    'desktop-daemon/src-tauri/src/execution_broker/native_control.rs',
    'packages/omctx/src/client/omni-local-client.js',
  ]);
  const allowed = [
    '/api/control/approve',
    '/internal/control/session',
    '/internal/control/session/revoke',
    '/internal/native/approve',
    '/internal/native/verify',
  ].sort();
  assert.deepEqual(routePaths, allowed, `unexpected D1B-1 control route(s): ${routePaths.join(', ')}`);

  const routes = contents('brain-server/src/api/routes.ts');
  assert.match(routes, /req\.method === 'POST'.+?pathname === '\/api\/control\/approve'/s);
  assert.doesNotMatch(routes, /\/api\/control\/verify/);
  assert.doesNotMatch(routes, /\/api\/control\/(?:execute|grant|receipt|observation|outcome)/);
  assert.doesNotMatch(routes, /\/api\/control\/(?:[:*][A-Za-z_]|\$\{)/);

  const cli = contents('packages/omctx/src/commands/locked.js');
  assert.match(cli, /cmdVerify[\s\S]*?controlSurfaceLocked/);
  assert.doesNotMatch(cli, /cmdVerify[\s\S]*?(?:fetch\(|OmniLocalClient)/);

  const facade = contents('brain-server/src/control/approval-facade.ts');
  // Ignore descriptive prose such as "approval outcome"; reject only an
  // actual execution/readback/receipt/rollback/retry call or broker escape.
  assert.doesNotMatch(
    facade,
    /Broker\.execute|\bgh\s*\(|(?:\.|\b)(?:receipt|readback|outcome|rollback|retry)\s*\(/i,
  );

  console.log('D1B1_ALLOWED_PUBLIC_CONTROL=POST /api/control/approve');
  console.log('D1B1_ALLOWED_INTERNAL_CONTROL=session-mint,revoke,native-approve,native-verify');
  console.log('D1B1_PHASE_VALIDATOR=PASS');
}

if (phase === 'd1b0') validateD1b0HistoricalArtifacts();
else validateD1b1ControlSurface();
