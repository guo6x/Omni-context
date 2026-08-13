//! Goal24 Checkpoint 4 - GitHub CLI adapter assembly and registration.
//!
//! The adapter owns a trusted execution context (validated absolute `gh.exe`,
//! an adapter-owned work root, a minimal env allowlist, output limits) and
//! registers the five read-only bindings with the existing CP3 `Broker`.
//! Registration happens only from compiled code; nothing here is reachable
//! from IPC.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::execution_broker::{Broker, OutputLimits};
use crate::github_cli::bindings::{Capability, GithubCliBinding};
use crate::github_cli::discovery::{self, validate_trusted_gh};
use crate::github_cli::outputs::{GithubCliError, GithubCliErrorCode};

/// Environment names the GitHub CLI needs to locate its own user config on
/// Windows. Deliberately excludes PATH, HTTP(S)_PROXY and every token/host/
/// repo/config variable. The broker's fail-safe secret strip still runs
/// before the child is spawned.
pub const GH_ENV_ALLOWLIST: [&str; 3] = ["USERPROFILE", "APPDATA", "LOCALAPPDATA"];

/// Adapter-owned execution context shared by all five bindings.
#[derive(Debug)]
pub struct GitHubCliContext {
    gh_executable: PathBuf,
    work_root: PathBuf,
    allowed_cwd_roots: Vec<PathBuf>,
    env_allowlist: Vec<String>,
    output_limits: OutputLimits,
}

impl GitHubCliContext {
    /// Build a context from an already-validated `gh.exe` and a work root.
    /// The work root is created, canonicalized and becomes the only
    /// allowlisted cwd root.
    pub(crate) fn new(validated_gh: PathBuf, work_root: PathBuf) -> Result<Self, GithubCliError> {
        if !work_root.is_absolute() {
            return Err(GithubCliError::new(
                GithubCliErrorCode::GhInputInvalid,
                "github_cli work root must be an absolute path",
            ));
        }
        std::fs::create_dir_all(&work_root).map_err(|err| {
            GithubCliError::new(
                GithubCliErrorCode::GhCliFailed,
                format!("failed to create github_cli work root: {err}"),
            )
        })?;
        let work_root = std::fs::canonicalize(&work_root).map_err(|err| {
            GithubCliError::new(
                GithubCliErrorCode::GhCliFailed,
                format!("failed to canonicalize github_cli work root: {err}"),
            )
        })?;
        Ok(Self {
            gh_executable: validated_gh,
            allowed_cwd_roots: vec![work_root.clone()],
            work_root,
            env_allowlist: GH_ENV_ALLOWLIST
                .iter()
                .map(|name| (*name).to_string())
                .collect(),
            output_limits: OutputLimits::default(),
        })
    }

    /// The single validated absolute `gh.exe` offered to the broker.
    pub fn gh_executable_candidates(&self) -> &[PathBuf] {
        std::slice::from_ref(&self.gh_executable)
    }

    /// Adapter-owned safe working directory (inputs cannot influence it).
    pub fn work_root(&self) -> &Path {
        &self.work_root
    }

    /// The only cwd root the broker will accept for these bindings.
    pub fn allowed_cwd_roots(&self) -> &[PathBuf] {
        &self.allowed_cwd_roots
    }

    /// Minimal env allowlist (broker still strips secrets fail-safe).
    pub fn env_allowlist(&self) -> &[String] {
        &self.env_allowlist
    }

    /// Broker-default output limits (1 MiB per stream).
    pub fn output_limits(&self) -> OutputLimits {
        self.output_limits
    }
}

/// The GitHub CLI adapter: five read-only bindings, no writes, no IPC.
#[derive(Debug)]
pub struct GitHubCliAdapter {
    context: Arc<GitHubCliContext>,
}

impl GitHubCliAdapter {
    /// Build the adapter from a trusted absolute `gh` executable path.
    ///
    /// The path must come from trusted compiled bootstrap/discovery code -
    /// never from an IPC caller, plan inputs or model output. The path is
    /// validated here (absolute, canonicalizable, regular file, exactly
    /// `.exe` on Windows) and re-resolved/fingerprinted by the broker at
    /// spawn time.
    pub fn new(trusted_gh_path: PathBuf, work_root: PathBuf) -> Result<Self, GithubCliError> {
        let gh = validate_trusted_gh(&trusted_gh_path)?;
        let context = GitHubCliContext::new(gh, work_root)?;
        Ok(Self {
            context: Arc::new(context),
        })
    }

    /// Discovery-assisted constructor. Candidates are tried in priority
    /// order TRUSTED_BOOTSTRAP, STANDARD_INSTALL, PATH_DISCOVERY; the first
    /// candidate that passes strict validation wins. A bare `gh` is never
    /// handed to the broker.
    pub fn discover_and_new(
        trusted_bootstrap: &[PathBuf],
        work_root: PathBuf,
    ) -> Result<Self, GithubCliError> {
        for candidate in discovery::discover(trusted_bootstrap) {
            if let Ok(adapter) = Self::new(candidate.path.clone(), work_root.clone()) {
                return Ok(adapter);
            }
        }
        Err(GithubCliError::new(
            GithubCliErrorCode::GhExecutableNotReady,
            "no trusted gh executable could be discovered and validated",
        ))
    }

    /// Register all five read-only bindings with the broker. Compiled code
    /// only; never reachable from IPC.
    pub fn register_all(&self, broker: &Broker) {
        for capability in Capability::ALL {
            broker.register_binding(Box::new(GithubCliBinding::new(
                self.context.clone(),
                capability,
            )));
        }
    }

    /// Shared execution context (used by tests and future integration code).
    pub fn context(&self) -> Arc<GitHubCliContext> {
        self.context.clone()
    }
}
