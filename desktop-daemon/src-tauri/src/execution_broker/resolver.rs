//! Goal24 Checkpoint 3 — executable resolution and identity verification.
//!
//! The broker never accepts an executable path from a plan. It only resolves
//! candidates supplied by a trusted `ExecutionBinding`, requiring:
//! - absolute path,
//! - a `.exe` extension on Windows (`.cmd`/`.bat`/`.ps1` and shell
//!   associations are rejected by default),
//! - canonicalized concrete path that is a regular file,
//! - a recorded metadata fingerprint re-verified immediately before spawn
//!   (residual TOCTOU window documented; full hashing is intentionally not
//!   forced for large binaries in CP3).

use std::path::{Path, PathBuf};

use crate::execution_broker::types::{BrokerError, ErrorCode};

/// Recorded identity of the resolved executable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutableFingerprint {
    /// Path as provided by the binding (after canonicalization).
    pub canonical_path: PathBuf,
    /// File size in bytes at resolution time.
    pub size: u64,
    /// Last modification time in seconds since the Unix epoch at resolution time.
    pub modified_unix_secs: i64,
}

impl ExecutableFingerprint {
    /// Re-stat the file and return `true` when identity is unchanged.
    pub fn verify(&self) -> bool {
        let Ok(meta) = std::fs::metadata(&self.canonical_path) else {
            return false;
        };
        let Ok(modified) = meta.modified() else {
            return false;
        };
        let Ok(modified_unix) = modified.duration_since(std::time::UNIX_EPOCH) else {
            return false;
        };
        meta.is_file()
            && meta.len() == self.size
            && modified_unix.as_secs() as i64 == self.modified_unix_secs
    }
}

impl std::fmt::Display for ExecutableFingerprint {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "path={} size={} mtime={}",
            self.canonical_path.display(),
            self.size,
            self.modified_unix_secs
        )
    }
}

/// Resolve one of the binding's candidates to a concrete, verified executable.
pub fn resolve_executable(
    candidates: &[PathBuf],
) -> Result<(PathBuf, ExecutableFingerprint), BrokerError> {
    let mut last_error: Option<BrokerError> = None;
    for candidate in candidates {
        match resolve_single(candidate) {
            Ok(fp) => return Ok((candidate.clone(), fp)),
            Err(e) => last_error = Some(e),
        }
    }
    Err(last_error.unwrap_or_else(|| {
        BrokerError::new(
            ErrorCode::BrokerBlockedExecutable,
            "no executable candidates provided",
        )
    }))
}

fn resolve_single(candidate: &Path) -> Result<ExecutableFingerprint, BrokerError> {
    if !candidate.is_absolute() {
        return Err(BrokerError::new(
            ErrorCode::BrokerBlockedExecutable,
            format!(
                "executable candidate must be an absolute path: {}",
                candidate.display()
            ),
        ));
    }

    // Windows: only concrete `.exe` files; `.cmd`/`.bat`/`.ps1` are rejected by
    // default and no shell association is ever used.
    #[cfg(windows)]
    {
        let ext = candidate
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if ext != "exe" {
            return Err(BrokerError::new(
                ErrorCode::BrokerBlockedExtension,
                format!(
                    "executable candidate must be a concrete .exe on Windows (got {:?}): {}",
                    candidate
                        .extension()
                        .map(|e| e.to_string_lossy().into_owned()),
                    candidate.display()
                ),
            ));
        }
    }

    let canonical = std::fs::canonicalize(candidate).map_err(|_| {
        BrokerError::new(
            ErrorCode::BrokerBlockedExecutable,
            format!("executable not found: {}", candidate.display()),
        )
    })?;

    // Reject candidates whose canonical on-disk identity differs from the
    // requested path (symlink/junction indirection to another file is
    // fail-closed for broker executables).
    #[cfg(windows)]
    {
        let strip_verbatim = |s: &str| s.trim_start_matches("\\\\?\\").to_lowercase();
        let canon_norm = strip_verbatim(&canonical.to_string_lossy());
        let cand_norm = strip_verbatim(&candidate.to_string_lossy());
        if canon_norm != cand_norm {
            return Err(BrokerError::new(
                ErrorCode::BrokerBlockedExecutable,
                format!(
                    "executable canonical identity differs from candidate: {} -> {}",
                    candidate.display(),
                    canonical.display()
                ),
            ));
        }
    }
    #[cfg(not(windows))]
    {
        if canonical != candidate {
            return Err(BrokerError::new(
                ErrorCode::BrokerBlockedExecutable,
                format!(
                    "executable canonical identity differs from candidate: {} -> {}",
                    candidate.display(),
                    canonical.display()
                ),
            ));
        }
    }

    let meta = std::fs::metadata(&canonical).map_err(|_| {
        BrokerError::new(
            ErrorCode::BrokerBlockedExecutable,
            format!("executable metadata unavailable: {}", canonical.display()),
        )
    })?;

    if !meta.is_file() {
        return Err(BrokerError::new(
            ErrorCode::BrokerBlockedExecutable,
            format!(
                "resolved executable is not a regular file: {}",
                canonical.display()
            ),
        ));
    }

    let modified_unix_secs = meta
        .modified()
        .ok()
        .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    Ok(ExecutableFingerprint {
        canonical_path: canonical,
        size: meta.len(),
        modified_unix_secs,
    })
}
