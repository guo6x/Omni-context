use std::path::PathBuf;
use std::sync::Arc;

use crate::execution_broker::{Broker, OutputLimits};

use super::bindings::GitBranchCreateBinding;
use super::inputs::{parse_create_inputs, parse_read_inputs};
use super::readback::GitBranchReadbackBinding;

#[derive(Debug)]
pub struct LocalGitContext {
    git_executable: PathBuf,
    allowed_cwd_roots: Vec<PathBuf>,
    env_allowlist: Vec<String>,
    output_limits: OutputLimits,
}

impl LocalGitContext {
    pub fn new(trusted_git_path: PathBuf, approved_root: PathBuf) -> Result<Self, String> {
        if !trusted_git_path.is_absolute() || trusted_git_path.to_string_lossy().contains('\0') {
            return Err("Git executable must be an absolute path without NUL".to_string());
        }
        #[cfg(windows)]
        if !trusted_git_path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("exe"))
        {
            return Err("Git executable must be a regular .exe on Windows".to_string());
        }
        let canonical_git = std::fs::canonicalize(&trusted_git_path)
            .map_err(|_| "Git executable cannot be canonicalized".to_string())?;
        if !canonical_git.is_file() {
            return Err("Git executable is not a regular file".to_string());
        }
        if !approved_root.is_absolute() || approved_root.to_string_lossy().contains('\0') {
            return Err("approved Git root must be an absolute path without NUL".to_string());
        }
        std::fs::create_dir_all(&approved_root)
            .map_err(|_| "approved Git root could not be created".to_string())?;
        let root = normalize_windows_path(
            std::fs::canonicalize(&approved_root)
                .map_err(|_| "approved Git root could not be canonicalized".to_string())?,
        );
        Ok(Self {
            git_executable: normalize_windows_path(canonical_git),
            allowed_cwd_roots: vec![root],
            // Git branch creation does not need tokens or caller environment.
            env_allowlist: Vec::new(),
            output_limits: OutputLimits::default(),
        })
    }

    pub fn git_executable_candidates(&self) -> &[PathBuf] {
        std::slice::from_ref(&self.git_executable)
    }

    pub fn allowed_cwd_roots(&self) -> &[PathBuf] {
        &self.allowed_cwd_roots
    }

    pub fn env_allowlist(&self) -> &[String] {
        &self.env_allowlist
    }

    pub fn output_limits(&self) -> OutputLimits {
        self.output_limits
    }

    pub fn canonical_repository(&self, raw: &str) -> Result<PathBuf, String> {
        let candidate = PathBuf::from(raw);
        if !candidate.is_absolute() {
            return Err("repository_path must be an absolute path".to_string());
        }
        let canonical = normalize_windows_path(
            std::fs::canonicalize(&candidate)
                .map_err(|_| "repository_path cannot be canonicalized".to_string())?,
        );
        let inside_approved_root = self.allowed_cwd_roots.iter().any(|root| {
            std::fs::canonicalize(root)
                .map(normalize_windows_path)
                .map(|canonical_root| canonical.starts_with(canonical_root))
                .unwrap_or(false)
        });
        if !inside_approved_root {
            return Err("repository_path is outside the approved local Git roots".to_string());
        }
        let git_marker = canonical.join(".git");
        if !(git_marker.is_dir() || git_marker.is_file()) {
            return Err("repository_path is not a Git worktree".to_string());
        }
        Ok(canonical)
    }
}

#[derive(Debug)]
pub struct LocalGitAdapter {
    context: Arc<LocalGitContext>,
}

impl LocalGitAdapter {
    pub fn new(trusted_git_path: PathBuf, approved_root: PathBuf) -> Result<Self, String> {
        Ok(Self {
            context: Arc::new(LocalGitContext::new(trusted_git_path, approved_root)?),
        })
    }

    pub fn register_all(&self, broker: &Broker) {
        broker.register_binding(Box::new(GitBranchCreateBinding::new(self.context.clone())));
        broker
            .register_readback_binding(Box::new(GitBranchReadbackBinding::new(
                self.context.clone(),
            )))
            .expect("git.branch.read read-back binding must be read_only / low / L0");
    }

    pub fn context(&self) -> Arc<LocalGitContext> {
        self.context.clone()
    }

    #[allow(dead_code)]
    pub(crate) fn validate_create_inputs(
        &self,
        inputs: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<(), String> {
        let parsed = parse_create_inputs(inputs)?;
        self.context.canonical_repository(&parsed.repository_path)?;
        Ok(())
    }

    #[allow(dead_code)]
    pub(crate) fn validate_read_inputs(
        &self,
        inputs: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<(), String> {
        let parsed = parse_read_inputs(inputs)?;
        self.context.canonical_repository(&parsed.repository_path)?;
        Ok(())
    }
}

fn normalize_windows_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix("\\\\?\\") {
            let bytes = rest.as_bytes();
            if bytes.len() >= 3 && bytes[1] == b':' && bytes[2] == b'\\' {
                return PathBuf::from(rest);
            }
        }
    }
    path
}
