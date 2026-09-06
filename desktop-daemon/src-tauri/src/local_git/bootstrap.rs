use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::execution_broker::Broker;

use super::adapter::LocalGitAdapter;

pub const TRUSTED_GIT_ENV_VAR: &str = "OMNI_GIT_EXECUTABLE";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalGitBootstrapReport {
    pub resolved_git: Option<PathBuf>,
    pub approved_root: PathBuf,
    pub registered_bindings: usize,
    pub message: String,
}

pub fn trusted_config_candidates() -> Vec<PathBuf> {
    std::env::var_os(TRUSTED_GIT_ENV_VAR)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .into_iter()
        .collect()
}

fn standard_candidates() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let mut paths = Vec::new();
        for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(root) = std::env::var_os(variable) {
                paths.push(PathBuf::from(root).join("Git").join("cmd").join("git.exe"));
            }
        }
        if let Some(root) = std::env::var_os("LOCALAPPDATA") {
            paths.push(
                PathBuf::from(root)
                    .join("Programs")
                    .join("Git")
                    .join("cmd")
                    .join("git.exe"),
            );
        }
        paths
    }
    #[cfg(not(windows))]
    {
        vec![
            PathBuf::from("/usr/bin/git"),
            PathBuf::from("/usr/local/bin/git"),
        ]
    }
}

fn path_candidates() -> Vec<PathBuf> {
    let Some(path) = std::env::var_os("PATH") else {
        return Vec::new();
    };
    std::env::split_paths(&path)
        .map(|dir| {
            #[cfg(windows)]
            {
                dir.join("git.exe")
            }
            #[cfg(not(windows))]
            {
                dir.join("git")
            }
        })
        .collect()
}

fn candidates() -> Vec<PathBuf> {
    let mut all = trusted_config_candidates();
    all.extend(standard_candidates());
    all.extend(path_candidates());
    all
}

pub fn bootstrap_production(broker: &Broker, approved_root: PathBuf) -> LocalGitBootstrapReport {
    for candidate in candidates() {
        if let Ok(adapter) = LocalGitAdapter::new(candidate.clone(), approved_root.clone()) {
            adapter.register_all(broker);
            return LocalGitBootstrapReport {
                resolved_git: Some(adapter.context().git_executable_candidates()[0].clone()),
                approved_root,
                registered_bindings: 2,
                message: "local Git adapter ready: branch create + trusted branch read-back"
                    .to_string(),
            };
        }
    }
    LocalGitBootstrapReport {
        resolved_git: None,
        approved_root,
        registered_bindings: 0,
        message: "local Git adapter unavailable: no trusted Git executable was discovered"
            .to_string(),
    }
}
