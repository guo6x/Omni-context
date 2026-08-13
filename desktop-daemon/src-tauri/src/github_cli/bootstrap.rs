//! Goal24 Checkpoint 4 Integration - production GitHub CLI bootstrap.
//!
//! Resolves a concrete absolute `gh.exe` and registers the five read-only
//! bindings with the broker. Candidate order:
//!
//! 1. TRUSTED_CONFIG: `OMNI_GITHUB_CLI_EXE` (absolute path from trusted
//!    operator configuration; this is how the dev machine pins
//!    `D:\environment\github-cli\bin\gh.exe` without hardcoding it in
//!    product source).
//! 2. STANDARD_INSTALL: official GitHub CLI install locations.
//! 3. PATH_DISCOVERY: absolute `gh.exe` entries on the current PATH.
//!
//! A bare `gh`, relative paths, `.cmd/.bat/.ps1` and missing files are never
//! accepted; the broker re-resolves and fingerprints the executable before
//! every spawn. No process is ever spawned here (no `gh --version` probe):
//! version compatibility is recorded from file metadata plus the Lane C
//! compatibility manifest instead.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::execution_broker::Broker;
use crate::github_cli::adapter::GitHubCliAdapter;

/// Trusted operator configuration env var naming an absolute `gh.exe`.
pub const TRUSTED_GH_ENV_VAR: &str = "OMNI_GITHUB_CLI_EXE";

/// Machine-readable bootstrap report (paths only; no tokens).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubCliBootstrapReport {
    /// Canonical absolute `gh.exe` registered with the broker, if any.
    pub resolved_gh: Option<PathBuf>,
    /// Discovery source that won (TRUSTED_CONFIG / STANDARD_INSTALL / PATH).
    pub source: Option<String>,
    /// Number of read-only bindings registered (0 or 5).
    pub registered_bindings: usize,
    /// True: no `gh --version` process probe was performed (task 20).
    pub version_probe_bypassed: bool,
    /// Human-readable bootstrap outcome (no tokens).
    pub message: String,
}

/// Adapter-owned work root: per-user app data, never influenced by inputs.
pub fn local_work_root() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Omni-Context")
        .join("github-cli-work")
}

/// Trusted configuration candidates (absolute paths only).
pub fn trusted_config_candidates() -> Vec<PathBuf> {
    match std::env::var_os(TRUSTED_GH_ENV_VAR) {
        Some(value) => {
            let path = PathBuf::from(value);
            if path.is_absolute() {
                vec![path]
            } else {
                Vec::new()
            }
        }
        None => Vec::new(),
    }
}

/// Best-effort production registration of the five read-only bindings.
///
/// Failure to discover a trusted gh executable never aborts app startup; the
/// broker simply reports zero registered bindings and the status surface
/// stays read-only.
pub fn bootstrap_production(broker: &Broker) -> GithubCliBootstrapReport {
    let adapter =
        GitHubCliAdapter::discover_and_new(&trusted_config_candidates(), local_work_root());
    match adapter {
        Ok(adapter) => {
            let gh = adapter.context().gh_executable_candidates()[0].clone();
            adapter.register_all(broker);
            let registered = broker.status().registered_bindings.len();
            GithubCliBootstrapReport {
                source: Some(
                    "discovery priority: trusted config -> standard install -> PATH".to_string(),
                ),
                resolved_gh: Some(gh),
                registered_bindings: registered,
                version_probe_bypassed: true,
                message: format!(
                    "GitHub CLI adapter ready: {registered} read-only bindings registered"
                ),
            }
        }
        Err(err) => GithubCliBootstrapReport {
            resolved_gh: None,
            source: None,
            registered_bindings: 0,
            version_probe_bypassed: true,
            message: format!("GitHub CLI adapter unavailable: {err}"),
        },
    }
}
