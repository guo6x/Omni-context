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

#[cfg(windows)]
fn reject_windows_reparse_indirection(candidate: &Path) -> Result<(), BrokerError> {
    use std::os::windows::fs::MetadataExt;

    // FILE_ATTRIBUTE_REPARSE_POINT. Symlinks and junctions are represented as
    // reparse points on Windows. We inspect every existing path component so
    // parent-directory junctions cannot hide behind an otherwise regular final
    // `.exe`.
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;

    let mut current = PathBuf::new();
    for component in candidate.components() {
        if matches!(
            component,
            std::path::Component::CurDir | std::path::Component::ParentDir
        ) {
            return Err(BrokerError::new(
                ErrorCode::BrokerBlockedExecutable,
                format!(
                    "executable candidate may not contain relative path components: {}",
                    candidate.display()
                ),
            ));
        }

        current.push(component.as_os_str());
        if matches!(
            component,
            std::path::Component::Prefix(_) | std::path::Component::RootDir
        ) {
            continue;
        }

        let metadata = std::fs::symlink_metadata(&current).map_err(|_| {
            BrokerError::new(
                ErrorCode::BrokerBlockedExecutable,
                format!(
                    "executable path component metadata unavailable: {}",
                    current.display()
                ),
            )
        })?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(BrokerError::new(
                ErrorCode::BrokerBlockedExecutable,
                format!(
                    "executable candidate contains symlink/junction indirection: {}",
                    current.display()
                ),
            ));
        }
    }

    Ok(())
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

        // Reject the security-relevant indirection explicitly instead of
        // comparing path strings. Windows may legitimately canonicalize the
        // same physical path from an 8.3 alias (RUNNER~1), different casing, or
        // a non-verbatim form into a long `\\?\` path. Those representation
        // changes are not symlink/junction escapes.
        reject_windows_reparse_indirection(candidate)?;
    }

    let canonical = std::fs::canonicalize(candidate).map_err(|_| {
        BrokerError::new(
            ErrorCode::BrokerBlockedExecutable,
            format!("executable not found: {}", candidate.display()),
        )
    })?;

    // On Unix, retain the existing strict path identity check. On Windows the
    // equivalent security property is enforced above by rejecting every
    // reparse-point component before canonicalization; literal path equality is
    // not a valid identity test because 8.3 aliases and verbatim prefixes can
    // name the same file.
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
