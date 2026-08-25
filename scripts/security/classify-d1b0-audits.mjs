import fs from 'node:fs';

const root = new URL('../../', import.meta.url).pathname.replace(/^\//, '').replaceAll('/', '\\');
const outDir = `${root}docs\\goal24\\distribution\\d1b0`;
const readJson = (name) => JSON.parse(fs.readFileSync(`${outDir}\\${name}`, 'utf8'));

const now = new Date().toISOString();
const cargo = readJson('cargo-audit.json');
const brain = readJson('brain-npm-audit.json');
const desktop = readJson('desktop-npm-audit.json');

const cargoMap = {
  'RUSTSEC-2026-0258': {
    classification: 'NOT_CONTROL_SURFACE_REACHABLE',
    action: 'Track for h2 upgrade; current Windows reqwest client is not a public control facade.',
    evidence: ['cargo-tree-windows.txt', 'path-hyper-014-windows.txt', 'public-control-threat-model.md §4']
  },
  'RUSTSEC-2026-0194:quick-xml@0.30.0': {
    classification: 'NOT_RUNTIME_REACHABLE',
    action: 'No Windows target path; retain evidence and re-evaluate for non-Windows builds.',
    evidence: ['path-quick-xml-030.txt', 'path-quick-xml-030-linux.txt', 'cargo-tree-windows.txt']
  },
  'RUSTSEC-2026-0195:quick-xml@0.30.0': {
    classification: 'NOT_RUNTIME_REACHABLE',
    action: 'No Windows target path; retain evidence and re-evaluate for non-Windows builds.',
    evidence: ['path-quick-xml-030.txt', 'path-quick-xml-030-linux.txt', 'cargo-tree-windows.txt']
  },
  'RUSTSEC-2026-0194:quick-xml@0.39.3': {
    classification: 'NOT_RUNTIME_REACHABLE',
    action: 'No Windows target path; retain evidence and re-evaluate for non-Windows builds.',
    evidence: ['path-quick-xml-039.txt', 'path-quick-xml-039-linux.txt', 'cargo-tree-windows.txt']
  },
  'RUSTSEC-2026-0195:quick-xml@0.39.3': {
    classification: 'NOT_RUNTIME_REACHABLE',
    action: 'No Windows target path; retain evidence and re-evaluate for non-Windows builds.',
    evidence: ['path-quick-xml-039.txt', 'path-quick-xml-039-linux.txt', 'cargo-tree-windows.txt']
  }
};

const brainRuntimeNonControl = new Set([
  '@tootallnate/once', '@xenova/transformers', 'body-parser', 'onnx-proto',
  'onnxruntime-web', 'protobufjs', 'qs', 'sharp', 'sqlite3', 'xlsx'
]);
const brainBuildOnly = new Set([
  'cacache', 'http-proxy-agent', 'make-fetch-happen', 'node-gyp', 'tar'
]);
const brainDevOnly = new Set([
  '@typescript-eslint/eslint-plugin', '@typescript-eslint/parser', '@typescript-eslint/type-utils',
  '@typescript-eslint/typescript-estree', '@typescript-eslint/utils', 'brace-expansion',
  'esbuild', 'minimatch', 'nanoid', 'postcss', 'vite', 'vite-node', 'vitest'
]);

const classifyNpm = (name, project) => {
  if (project === 'brain-server') {
    if (brainRuntimeNonControl.has(name)) return {
      classification: 'RUNTIME_REACHABLE_NON_CONTROL',
      action: 'Track separately; package is outside approve/verify control routes.'
    };
    if (brainBuildOnly.has(name)) return {
      classification: 'BUILD_ONLY',
      action: 'Install/build chain only; not loaded by the production control path.'
    };
    if (brainDevOnly.has(name)) return {
      classification: 'DEV_ONLY',
      action: 'Developer/test/tooling dependency; not shipped as a control runtime.'
    };
  }
  return {
    classification: 'BUILD_ONLY',
    action: 'Desktop uses Next output: export; finding is in the build toolchain, not the shipped control runtime.'
  };
};

const cargoEntries = cargo.vulnerabilities.list.map((item) => {
  const id = item.advisory.id;
  const key = `${id}:${item.package.name}@${item.package.version}`;
  const decision = cargoMap[key] ?? cargoMap[id] ?? {
    classification: 'UNKNOWN',
    action: 'Requires manual reachability review.',
    evidence: []
  };
  return {
    source: 'rustsec',
    advisory_id: id,
    crate: item.package.name,
    installed_version: item.package.version,
    patched_versions: item.versions.patched,
    severity: item.advisory.cvss ?? 'low',
    type: item.advisory.categories?.join(',') || 'unspecified',
    dependency_path: decision.evidence,
    runtime_reachable: decision.classification === 'NOT_CONTROL_SURFACE_REACHABLE',
    control_surface_reachable: false,
    classification: decision.classification,
    action: decision.action
  };
});

const npmEntries = (audit, project) => Object.entries(audit.vulnerabilities).map(([name, value]) => {
  const decision = classifyNpm(name, project);
  return {
    source: 'npm',
    project,
    package: name,
    installed_nodes: value.nodes,
    direct: value.isDirect === true,
    severity: value.severity,
    advisories: value.via.filter((via) => typeof via === 'object').map((via) => ({
      source: via.source,
      title: via.title,
      url: via.url,
      severity: via.severity,
      range: via.range
    })),
    dependency_path_evidence: project === 'brain-server'
      ? ['brain-server/package-lock.json parent/dependency path', 'static control-surface search: no approve/verify route']
      : ['desktop-daemon/package-lock.json', 'desktop-daemon/next.config.js output: export'],
    runtime_reachable: decision.classification === 'RUNTIME_REACHABLE_NON_CONTROL',
    control_surface_reachable: false,
    classification: decision.classification,
    action: decision.action
  };
});

const entries = [...cargoEntries, ...npmEntries(brain, 'brain-server'), ...npmEntries(desktop, 'desktop-daemon')];
const counts = entries.reduce((acc, entry) => {
  acc[entry.classification] = (acc[entry.classification] || 0) + 1;
  return acc;
}, {});

const result = {
  schema_version: '1.0',
  generated_at: now,
  tool_versions: { cargo_audit: 'cargo-audit-audit 0.22.2', npm: '10.9.8' },
  rustsec_db: {
    refresh: 'SUCCESS',
    revision: cargo.database['last-commit'],
    updated: cargo.database['last-updated']
  },
  cargo_audit: {
    completed: true,
    exit_code: 1,
    target: 'x86_64-pc-windows-msvc',
    advisory_count: cargo.vulnerabilities.list.length
  },
  npm_audits: {
    brain: { completed: true, exit_code: 1, findings: brain.metadata.vulnerabilities.total },
    desktop: { completed: true, exit_code: 1, findings: desktop.metadata.vulnerabilities.total }
  },
  counts,
  unknown_count: counts.UNKNOWN || 0,
  fix_before_d1b: counts.FIX_BEFORE_D1B || 0,
  blocks_d1b: counts.BLOCKS_D1B || 0,
  entries
};

fs.writeFileSync(`${outDir}\\dependency-audit-classification.json`, `${JSON.stringify(result, null, 2)}\n`);
