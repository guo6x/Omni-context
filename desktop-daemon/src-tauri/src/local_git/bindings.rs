use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{Map, Value};

use crate::execution_broker::{
    AuthorityLevelWire, ExecutionBinding, ExecutionRiskPolicy, OutputLimits, RiskLevelWire,
    SideEffectClassWire,
};

use super::adapter::LocalGitContext;
use super::inputs::{parse_create_inputs, validate_branch_name, validate_start_point};
use super::{ADAPTER_ID, GIT_BRANCH_CAPABILITY_VERSION};

pub const GIT_BRANCH_CREATE_BINDING_ID: &str = "git-local.branch.create";

pub fn git_branch_create_risk_policy() -> ExecutionRiskPolicy {
    ExecutionRiskPolicy {
        risk_level: RiskLevelWire::Medium,
        side_effect_class: SideEffectClassWire::ReversibleWrite,
        reversible: true,
        required_authority: AuthorityLevelWire::L1,
    }
}

pub struct GitBranchCreateBinding {
    context: Arc<LocalGitContext>,
}

impl GitBranchCreateBinding {
    pub fn new(context: Arc<LocalGitContext>) -> Self {
        Self { context }
    }
}

impl ExecutionBinding for GitBranchCreateBinding {
    fn binding_id(&self) -> &str {
        GIT_BRANCH_CREATE_BINDING_ID
    }

    fn adapter_id(&self) -> &str {
        ADAPTER_ID
    }

    fn capability_id(&self) -> &str {
        "git.branch.create"
    }

    fn executable_candidates(&self) -> &[PathBuf] {
        self.context.git_executable_candidates()
    }

    fn build_argv(&self, inputs: &Map<String, Value>) -> Result<Vec<OsString>, String> {
        let input = parse_create_inputs(inputs)?;
        validate_branch_name(&input.branch_name)?;
        validate_start_point(&input.start_point)?;
        // The repository path is checked again by derive_cwd and by the
        // broker's canonical cwd gate. It never becomes an argv fragment.
        Ok(vec![
            OsString::from("branch"),
            OsString::from(input.branch_name),
            OsString::from(input.start_point),
        ])
    }

    fn allowed_cwd_roots(&self) -> &[PathBuf] {
        self.context.allowed_cwd_roots()
    }

    fn derive_cwd(&self, inputs: &Map<String, Value>) -> Result<PathBuf, String> {
        let input = parse_create_inputs(inputs)?;
        self.context.canonical_repository(&input.repository_path)
    }

    fn env_allowlist(&self) -> &[String] {
        self.context.env_allowlist()
    }

    fn output_limits(&self) -> OutputLimits {
        self.context.output_limits()
    }

    fn capability_version(&self) -> &str {
        GIT_BRANCH_CAPABILITY_VERSION
    }

    fn risk_policy(&self) -> ExecutionRiskPolicy {
        git_branch_create_risk_policy()
    }
}
