//! Goal24 Checkpoint 4 - pure filesystem GitHub CLI discovery (Lane A).
//!
//! Discovery never spawns a process (`Command::new`, `where`, `gh --version`
//! and friends are all forbidden here). It only enumerates *candidate*
//! absolute paths; the adapter constructor still validates each candidate
//! strictly, and the broker re-resolves and fingerprints the chosen
//! executable before every spawn.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::github_cli::outputs::{GithubCliError, GithubCliErrorCode};

/// Where a candidate path came from. PATH discovery never outranks
/// trusted-bootstrap or standard-install candidates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DiscoverySource {
    TrustedBootstrap,
    StandardInstall,
    PathDiscovery,
}

/// A discovered candidate: a concrete absolute path to a `gh.exe`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiscoveredGh {
    pub path: PathBuf,
    pub source: DiscoverySource,
}

/// Official installer locations (MSI and user-scope installs).
pub fn standard_install_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(v) = std::env::var_os("ProgramFiles") {
        out.push(PathBuf::from(&v).join("GitHub CLI").join("gh.exe"));
    }
    if let Some(v) = std::env::var_os("ProgramFiles(x86)") {
        out.push(PathBuf::from(&v).join("GitHub CLI").join("gh.exe"));
    }
    if let Some(v) = std::env::var_os("LOCALAPPDATA") {
        out.push(
            PathBuf::from(&v)
                .join("Programs")
                .join("GitHub CLI")
                .join("gh.exe"),
        );
        out.push(PathBuf::from(&v).join("GitHub CLI").join("gh.exe"));
    }
    out
}

/// Scan a PATH-like string (`;` separated) into concrete absolute `gh.exe`
/// candidates. Relative entries are skipped; a bare `gh` can never be handed
/// to the broker.
pub fn path_discovery_candidates_from(path_value: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for entry in path_value.split(';') {
        let dir = PathBuf::from(entry);
        if dir.as_os_str().is_empty() || !dir.is_absolute() {
            continue;
        }
        out.push(dir.join("gh.exe"));
    }
    out
}

/// Scan the current process `PATH` (trusted local state only; the child
/// process never inherits `PATH`).
pub fn path_discovery_candidates() -> Vec<PathBuf> {
    match std::env::var_os("PATH") {
        Some(value) => path_discovery_candidates_from(&value.to_string_lossy()),
        None => Vec::new(),
    }
}

/// Ordered candidate list: TRUSTED_BOOTSTRAP, STANDARD_INSTALL, PATH_DISCOVERY.
/// Duplicate canonical locations keep the highest-priority source only.
pub fn discover(trusted_bootstrap: &[PathBuf]) -> Vec<DiscoveredGh> {
    let mut out: Vec<DiscoveredGh> = Vec::new();
    let mut seen: Vec<PathBuf> = Vec::new();

    let mut push = |path: PathBuf, source: DiscoverySource| {
        let identity = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        if !seen.contains(&identity) {
            seen.push(identity);
            out.push(DiscoveredGh { path, source });
        }
    };

    for path in trusted_bootstrap {
        push(path.clone(), DiscoverySource::TrustedBootstrap);
    }
    for path in standard_install_candidates() {
        push(path, DiscoverySource::StandardInstall);
    }
    for path in path_discovery_candidates() {
        push(path, DiscoverySource::PathDiscovery);
    }
    out
}

/// Strict validation of a candidate `gh` executable path. This is the only
/// place a `gh.exe` path enters the adapter, and the source of that path must
/// be trusted compiled bootstrap/discovery code - never a plan, an IPC caller
/// or model output.
pub fn validate_trusted_gh(path: &Path) -> Result<PathBuf, GithubCliError> {
    let reject = |reason: &str| {
        GithubCliError::new(
            GithubCliErrorCode::GhExecutableNotReady,
            format!("gh executable candidate rejected: {reason}"),
        )
    };

    if path.to_string_lossy().contains('\u{0}') {
        return Err(reject("path contains a NUL byte"));
    }
    if !path.is_absolute() {
        return Err(reject("path is not absolute"));
    }

    #[cfg(windows)]
    {
        match path.extension().and_then(|ext| ext.to_str()) {
            Some(ext) if ext.eq_ignore_ascii_case("exe") => {}
            _ => {
                return Err(reject(
                    "extension is not exactly .exe (.cmd/.bat/.ps1 and extension-less paths are rejected)",
                ));
            }
        }
    }

    let canonical = std::fs::canonicalize(path).map_err(|err| {
        GithubCliError::new(
            GithubCliErrorCode::GhExecutableNotReady,
            format!("gh executable candidate cannot be canonicalized: {err}"),
        )
    })?;
    let metadata = std::fs::metadata(&canonical).map_err(|err| {
        GithubCliError::new(
            GithubCliErrorCode::GhExecutableNotReady,
            format!("gh executable candidate cannot be stat-ed: {err}"),
        )
    })?;
    if !metadata.file_type().is_file() {
        return Err(reject("resolved path is not a regular file"));
    }
    Ok(canonical)
}
