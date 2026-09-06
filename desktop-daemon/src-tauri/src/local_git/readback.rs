use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{Map, Value};

use crate::execution_broker::readback::types::{
    ReadbackParseResult, ReadbackParserStatus, ReadbackRawOutput,
};
use crate::execution_broker::readback::ReadbackBinding;
use crate::execution_broker::{ExecutionRiskPolicy, OutputLimits};

use super::adapter::LocalGitContext;
use super::inputs::{parse_read_inputs, validate_branch_name};
use super::{ADAPTER_ID, GIT_BRANCH_CAPABILITY_VERSION};

pub const GIT_BRANCH_READBACK_BINDING_ID: &str = "git-local.branch.read.readback";

pub fn git_branch_subject_key(inputs: &Map<String, Value>) -> Result<String, String> {
    let input = parse_read_inputs(inputs)?;
    validate_branch_name(&input.branch_name)?;
    Ok(format!("git:branch:{}", input.branch_name))
}

pub struct GitBranchReadbackBinding {
    context: Arc<LocalGitContext>,
}

impl GitBranchReadbackBinding {
    pub fn new(context: Arc<LocalGitContext>) -> Self {
        Self { context }
    }
}

impl ReadbackBinding for GitBranchReadbackBinding {
    fn binding_id(&self) -> &str {
        GIT_BRANCH_READBACK_BINDING_ID
    }

    fn adapter_id(&self) -> &str {
        ADAPTER_ID
    }

    fn capability_id(&self) -> &str {
        "git.branch.read"
    }

    fn capability_version(&self) -> &str {
        GIT_BRANCH_CAPABILITY_VERSION
    }

    fn risk_policy(&self) -> ExecutionRiskPolicy {
        ExecutionRiskPolicy::read_only_low_l0()
    }

    fn executable_candidates(&self) -> &[PathBuf] {
        self.context.git_executable_candidates()
    }

    fn build_argv(&self, inputs: &Map<String, Value>) -> Result<Vec<OsString>, String> {
        let input = parse_read_inputs(inputs)?;
        validate_branch_name(&input.branch_name)?;
        Ok(vec![
            OsString::from("rev-parse"),
            OsString::from("--verify"),
            OsString::from(format!("refs/heads/{}", input.branch_name)),
        ])
    }

    fn allowed_cwd_roots(&self) -> &[PathBuf] {
        self.context.allowed_cwd_roots()
    }

    fn derive_cwd(&self, inputs: &Map<String, Value>) -> Result<PathBuf, String> {
        let input = parse_read_inputs(inputs)?;
        self.context.canonical_repository(&input.repository_path)
    }

    fn env_allowlist(&self) -> &[String] {
        self.context.env_allowlist()
    }

    fn output_limits(&self) -> OutputLimits {
        self.context.output_limits()
    }

    fn subject_key(&self, inputs: &Map<String, Value>) -> Result<String, String> {
        git_branch_subject_key(inputs)
    }

    fn parse(&self, raw: &ReadbackRawOutput) -> ReadbackParseResult {
        let text = raw.stdout.trim();
        let mut lines = text.lines();
        let Some(sha) = lines.next().map(str::trim) else {
            return malformed();
        };
        if lines.next().is_some()
            || sha.len() != 40
            || !sha.bytes().all(|byte| byte.is_ascii_hexdigit())
            || sha.chars().any(|ch| ch.is_ascii_uppercase())
        {
            return malformed();
        }
        ReadbackParseResult {
            payload: serde_json::json!({ "target_sha": sha }),
            status: ReadbackParserStatus::Parsed,
        }
    }
}

fn malformed() -> ReadbackParseResult {
    ReadbackParseResult {
        payload: Value::Null,
        status: ReadbackParserStatus::Malformed,
    }
}
