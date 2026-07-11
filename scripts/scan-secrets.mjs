import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FORBIDDEN_PATH_RULES = [
  { id: "environment-file", pattern: /(^|\/)\.env(?:\.|$)/i },
  { id: "claude-local-settings", pattern: /(^|\/)\.claude(?:\/|$)/i },
  { id: "private-key-file", pattern: /\.(?:key|pem|p12|pfx|jks|keystore)$/i },
  { id: "local-token-file", pattern: /(^|\/)(?:local-token|pair-code)\.txt$/i },
  { id: "credential-file", pattern: /(^|\/)(?:credentials|service-account[^/]*)\.json$/i },
];

const CONTENT_RULES = [
  { id: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { id: "openai-key", pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g },
  { id: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { id: "github-token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
  { id: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { id: "google-api-key", pattern: /\bAIza[A-Za-z0-9_-]{30,}\b/g },
  { id: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  {
    id: "assigned-secret",
    pattern:
      /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password)\b\s*[:=]\s*["']([^"'\r\n]{16,})["']/gi,
    capture: 1,
  },
];

const TEXT_EXTENSIONS = new Set([
  "", ".c", ".cpp", ".css", ".env", ".go", ".h", ".html", ".java", ".js",
  ".json", ".jsx", ".md", ".mjs", ".ps1", ".py", ".rs", ".sh", ".sql",
  ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
]);

const PLACEHOLDER_MARKERS = [
  "example", "placeholder", "replace-me", "replace_me", "your-", "your_", "test-",
  "test_", "dummy", "fake", "redacted", "<", "${", "process.env", "import.meta.env",
];

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function extensionOf(path) {
  const filename = normalizePath(path).split("/").at(-1) ?? "";
  const dot = filename.lastIndexOf(".");
  return dot <= 0 ? "" : filename.slice(dot).toLowerCase();
}

function isPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker));
}

export function scanPath(path) {
  const normalized = normalizePath(path);
  return FORBIDDEN_PATH_RULES
    .filter((rule) => !(rule.id === "environment-file" && normalized.endsWith(".env.example")))
    .filter((rule) => rule.pattern.test(normalized))
    .map((rule) => ({ rule: rule.id, path: normalized, line: 0 }));
}

export function scanContent(path, content) {
  const findings = [];
  for (const rule of CONTENT_RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of content.matchAll(rule.pattern)) {
      const candidate = rule.capture ? match[rule.capture] : match[0];
      if (isPlaceholder(candidate)) continue;
      const line = content.slice(0, match.index).split("\n").length;
      findings.push({ rule: rule.id, path: normalizePath(path), line });
    }
  }
  return findings;
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function listFiles(staged) {
  const output = staged
    ? git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
    : git(["ls-files", "-z"]);
  return output.split("\0").filter(Boolean);
}

function readFile(path, staged) {
  try {
    return staged
      ? git(["show", `:${path}`])
      : readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to inspect ${path}; secret scan cannot continue`, { cause: error });
  }
}

export function runScan({ staged = false } = {}) {
  const findings = [];
  for (const path of listFiles(staged)) {
    findings.push(...scanPath(path));
    if (!TEXT_EXTENSIONS.has(extensionOf(path))) continue;
    const content = readFile(path, staged);
    if (content.includes("\0")) continue;
    findings.push(...scanContent(path, content));
  }
  return findings;
}

function main() {
  const staged = process.argv.includes("--staged");
  const findings = runScan({ staged });
  if (findings.length === 0) {
    console.log(`Secret scan passed (${staged ? "staged changes" : "tracked tree"}).`);
    return;
  }

  console.error(`Secret scan failed with ${findings.length} finding(s). Values are redacted.`);
  for (const finding of findings) {
    const location = finding.line > 0 ? `${finding.path}:${finding.line}` : finding.path;
    console.error(`- ${finding.rule}: ${location}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
