//! Goal24 Checkpoint 3 — broker security policy primitives.
//!
//! Everything that decides *what* may run, *where* it runs and *with which
//! environment* comes from trusted compiled broker/adapter code (`ExecutionBinding`),
//! never from the plan or from IPC callers.

use std::path::{Path, PathBuf};

use crate::execution_broker::types::BrokerError;

// ---------------------------------------------------------------------------
// Output limits
// ---------------------------------------------------------------------------

/// Default per-stream output cap (spec: stdout max 1 MiB, stderr max 1 MiB).
pub const DEFAULT_OUTPUT_MAX_BYTES: usize = 1024 * 1024;

/// Output policy for one execution. A binding may tighten these limits; the
/// broker never relaxes them below the compiled defaults.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OutputLimits {
    pub stdout_max_bytes: usize,
    pub stderr_max_bytes: usize,
}

impl Default for OutputLimits {
    fn default() -> Self {
        Self {
            stdout_max_bytes: DEFAULT_OUTPUT_MAX_BYTES,
            stderr_max_bytes: DEFAULT_OUTPUT_MAX_BYTES,
        }
    }
}

impl OutputLimits {
    /// Clamp a binding-provided limit into `[1, DEFAULT_OUTPUT_MAX_BYTES]`.
    /// The broker must never let a binding (or anything else) raise the cap.
    pub fn clamp(stdout: usize, stderr: usize) -> Self {
        Self {
            stdout_max_bytes: stdout.clamp(1, DEFAULT_OUTPUT_MAX_BYTES),
            stderr_max_bytes: stderr.clamp(1, DEFAULT_OUTPUT_MAX_BYTES),
        }
    }
}

// ---------------------------------------------------------------------------
// Environment policy
// ---------------------------------------------------------------------------

/// Minimal trusted base environment variables the broker restores after
/// `env_clear()`. Chosen per Windows runtime needs; deliberately excludes
/// `PATH` on Windows (the resolved executable is a concrete absolute path and
/// the child must not inherit the parent's search-path surface).
#[cfg(windows)]
pub const BASE_ENV_VARS: &[&str] = &["SystemRoot", "TEMP", "TMP"];

/// Non-Windows minimal base (kept small; Windows is the primary platform).
#[cfg(not(windows))]
pub const BASE_ENV_VARS: &[&str] = &["PATH", "HOME"];

/// Environment variable names that must NEVER be inherited, even if a binding
/// lists them in its allowlist (fail-safe stripping).
pub const FORBIDDEN_ENV_NAMES: &[&str] = &[
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "ANTHROPIC_API_KEY",
    "NPM_TOKEN",
];

/// Environment variable name prefixes that must NEVER be inherited.
pub const FORBIDDEN_ENV_PREFIXES: &[&str] = &["AWS_", "AZURE_", "GOOGLE_", "SSH_"];

/// True when `name` is a secret that must never reach a broker child process.
pub fn is_forbidden_env_name(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    if FORBIDDEN_ENV_NAMES.contains(&upper.as_str()) {
        return true;
    }
    FORBIDDEN_ENV_PREFIXES
        .iter()
        .any(|prefix| upper.starts_with(prefix))
}

/// Build the child environment: nothing inherited; only base vars and the
/// binding allowlist, with secret names stripped as a final fail-safe.
pub fn build_child_env(
    base: &[&str],
    allowlist: &[String],
    parent: &std::collections::HashMap<String, String>,
) -> Vec<(std::ffi::OsString, std::ffi::OsString)> {
    let mut out: Vec<(std::ffi::OsString, std::ffi::OsString)> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    let push = |name: &str,
                value: &str,
                out: &mut Vec<(std::ffi::OsString, std::ffi::OsString)>,
                seen: &mut std::collections::HashSet<String>| {
        if is_forbidden_env_name(name) {
            return;
        }
        if seen.insert(name.to_string()) {
            out.push((
                std::ffi::OsString::from(name),
                std::ffi::OsString::from(value),
            ));
        }
    };

    for name in base {
        if let Some(value) = parent.get(*name) {
            push(name, value, &mut out, &mut seen);
        }
    }
    for name in allowlist {
        if let Some(value) = parent.get(name.as_str()) {
            push(name, value, &mut out, &mut seen);
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Cwd policy
// ---------------------------------------------------------------------------

/// Validate that `candidate` is inside one of `roots` after canonicalization.
/// Returns the canonicalized directory to use, or `CWD_NOT_ALLOWED`.
///
/// `..` escapes, symlinks and junctions are handled by canonicalization: the
/// resolved real path must be a directory that exists and must be equal to or
/// a descendant of a canonicalized allowlisted root.
pub fn validate_cwd(candidate: &Path, roots: &[PathBuf]) -> Result<PathBuf, BrokerError> {
    let canonical = std::fs::canonicalize(candidate).map_err(|_| {
        BrokerError::new(
            crate::execution_broker::types::ErrorCode::CwdNotAllowed,
            format!(
                "cwd does not exist or cannot be canonicalized: {}",
                candidate.display()
            ),
        )
    })?;

    if !canonical.is_dir() {
        return Err(BrokerError::new(
            crate::execution_broker::types::ErrorCode::CwdNotAllowed,
            format!("cwd is not a directory: {}", canonical.display()),
        ));
    }

    for root in roots {
        let canonical_root = match std::fs::canonicalize(root) {
            Ok(r) => r,
            Err(_) => continue,
        };
        if canonical.starts_with(&canonical_root) {
            return Ok(canonical);
        }
    }

    Err(BrokerError::new(
        crate::execution_broker::types::ErrorCode::CwdNotAllowed,
        format!("cwd escapes all allowlisted roots: {}", canonical.display()),
    ))
}

// ---------------------------------------------------------------------------
// Execution binding (trusted code only)
// ---------------------------------------------------------------------------

/// A trusted execution binding: the only component that may translate a
/// semantic capability + normalized inputs into a concrete executable and
/// argv. Bindings are registered from compiled code (CP3: none in production);
/// IPC callers can never create or mutate a binding.
pub trait ExecutionBinding: Send + Sync {
    /// Stable identifier used by callers to select this binding.
    fn binding_id(&self) -> &str;
    /// Must equal `ExecutionPlan.adapter_id` (checked by the broker gate).
    fn adapter_id(&self) -> &str;
    /// Must equal `ExecutionPlan.capability_id` (checked by the broker gate).
    fn capability_id(&self) -> &str;

    /// Trusted absolute executable candidates, tried in order. The broker
    /// resolves exactly one of these to a concrete file; plan inputs can never
    /// supply an executable path.
    fn executable_candidates(&self) -> &[PathBuf];

    /// Build argv from validated normalized inputs. The broker never parses
    /// model text; this is the only argv construction path.
    fn build_argv(
        &self,
        inputs: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<Vec<std::ffi::OsString>, String>;

    /// Allowlisted cwd roots (canonicalized at use time).
    fn allowed_cwd_roots(&self) -> &[PathBuf];

    /// Derive the working directory from normalized inputs. The broker
    /// validates the result against `allowed_cwd_roots` before use.
    fn derive_cwd(
        &self,
        inputs: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<PathBuf, String>;

    /// Environment variable allowlist (names looked up in the parent env).
    /// Secret names are stripped by the broker as a fail-safe.
    fn env_allowlist(&self) -> &[String];

    /// Output limits for this binding (broker clamps them).
    fn output_limits(&self) -> OutputLimits;
}
