//! Goal24 Post-CP8 Real E2E (DRG-2 candidate) - trusted GitHub issue read-back
//! binding.
//!
//! Implements the CP8 ReadbackBinding contract for the existing CP4
//! read-only capability github.issue.read. The binding reuses the exact CP4
//! argv template (gh issue view <number> --repo=<owner/repo>
//! --json=<ISSUE_VIEW_FIELDS>) and parses the bounded machine-readable JSON
//! output into the structured observation payload. Natural-language stdout
//! can never parse here.
//!
//! The binding declares read_only / low / L0 (enforced at registration by the
//! CP8 runner); it can never be used as a write or an execution channel.

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{Map, Value};

use crate::execution_broker::readback::types::{
    ReadbackParseResult, ReadbackParserStatus, ReadbackRawOutput,
};
use crate::execution_broker::readback::ReadbackBinding;
use crate::execution_broker::{ExecutionRiskPolicy, OutputLimits};
use crate::github_cli::adapter::GitHubCliContext;
use crate::github_cli::bindings::GITHUB_READONLY_CAPABILITY_VERSION;
use crate::github_cli::inputs::{parse_inputs, validate_number, validate_owner, validate_repo};
use crate::github_cli::outputs::GithubCliError;
use crate::github_cli::ADAPTER_ID;

/// Read-back subject key shape for github.issue.read (CP6 canonical form):
/// issue:<owner>/<repo>#<number>.
pub fn issue_subject_key(inputs: &Map<String, Value>) -> Result<String, GithubCliError> {
    let input: crate::github_cli::inputs::IssueReadInput = parse_inputs(inputs)?;
    let owner = validate_owner(&input.owner, "owner")?;
    let repo = validate_repo(&input.repo, "repo")?;
    validate_number(input.number, "number")?;
    Ok(format!("issue:{owner}/{repo}#{}", input.number))
}

/// The trusted read-back binding for github.issue.read. Registered only from
/// compiled trusted code.
pub struct GithubIssueReadbackBinding {
    context: Arc<GitHubCliContext>,
}

impl GithubIssueReadbackBinding {
    pub fn new(context: Arc<GitHubCliContext>) -> Self {
        Self { context }
    }
}

impl ReadbackBinding for GithubIssueReadbackBinding {
    fn binding_id(&self) -> &str {
        "github-cli.issue.read.readback"
    }

    fn adapter_id(&self) -> &str {
        ADAPTER_ID
    }

    fn capability_id(&self) -> &str {
        "github.issue.read"
    }

    fn capability_version(&self) -> &str {
        GITHUB_READONLY_CAPABILITY_VERSION
    }

    fn risk_policy(&self) -> ExecutionRiskPolicy {
        ExecutionRiskPolicy::read_only_low_l0()
    }

    fn executable_candidates(&self) -> &[PathBuf] {
        self.context.gh_executable_candidates()
    }

    fn build_argv(&self, inputs: &Map<String, Value>) -> Result<Vec<OsString>, String> {
        let input: crate::github_cli::inputs::IssueReadInput =
            parse_inputs(inputs).map_err(|err| err.to_string())?;
        let owner = validate_owner(&input.owner, "owner").map_err(|err| err.to_string())?;
        let repo = validate_repo(&input.repo, "repo").map_err(|err| err.to_string())?;
        validate_number(input.number, "number").map_err(|err| err.to_string())?;
        Ok(vec![
            OsString::from("issue"),
            OsString::from("view"),
            OsString::from(input.number.to_string()),
            OsString::from(format!("--repo={owner}/{repo}")),
            OsString::from(format!(
                "--json={}",
                crate::github_cli::bindings::ISSUE_VIEW_FIELDS
            )),
        ])
    }

    fn allowed_cwd_roots(&self) -> &[PathBuf] {
        self.context.allowed_cwd_roots()
    }

    fn derive_cwd(&self, _inputs: &Map<String, Value>) -> Result<PathBuf, String> {
        Ok(self.context.work_root().to_path_buf())
    }

    fn env_allowlist(&self) -> &[String] {
        self.context.env_allowlist()
    }

    fn output_limits(&self) -> OutputLimits {
        self.context.output_limits()
    }

    fn subject_key(&self, inputs: &Map<String, Value>) -> Result<String, String> {
        issue_subject_key(inputs).map_err(|err| err.to_string())
    }

    fn parse(&self, raw: &ReadbackRawOutput) -> ReadbackParseResult {
        // Strict single-JSON-document parse of the bounded, redacted gh
        // output. Anything else is Malformed; the runner upgrades truncated
        // output to parser_status=truncated. Natural-language stdout can
        // never become an observation payload.
        match serde_json::from_str::<Value>(raw.stdout.trim()) {
            Ok(value) => ReadbackParseResult {
                payload: value,
                status: ReadbackParserStatus::Parsed,
            },
            Err(_) => ReadbackParseResult {
                payload: Value::Null,
                status: ReadbackParserStatus::Malformed,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn subject_key_is_canonical_cp6_shape() {
        let inputs = json!({ "owner": "guo6x", "repo": "Omni-context", "number": 7 })
            .as_object()
            .unwrap()
            .clone();
        assert_eq!(
            issue_subject_key(&inputs).unwrap(),
            "issue:guo6x/Omni-context#7"
        );
    }

    #[test]
    fn argv_matches_the_cp4_read_template_exactly() {
        let binding_inputs = json!({ "owner": "guo6x", "repo": "r", "number": 3 })
            .as_object()
            .unwrap()
            .clone();
        // Build argv through the same code path the runner uses.
        let binding = GithubIssueReadbackBinding {
            context: Arc::new(
                crate::github_cli::adapter::GitHubCliContext::new(
                    std::path::PathBuf::from("C:\\Windows\\gh.exe"),
                    std::env::temp_dir().join("gh-readback-test"),
                )
                .expect("context"),
            ),
        };
        let argv = binding.build_argv(&binding_inputs).expect("argv");
        let text: Vec<String> = argv
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(text[0], "issue");
        assert_eq!(text[1], "view");
        assert_eq!(text[2], "3");
        assert_eq!(text[3], "--repo=guo6x/r");
        assert!(text[4].starts_with("--json=number,title,body,state"));
    }

    #[test]
    fn readback_risk_is_read_only_low_l0() {
        let policy = ExecutionRiskPolicy::read_only_low_l0();
        assert_eq!(
            policy.side_effect_class,
            crate::execution_broker::SideEffectClassWire::ReadOnly
        );
        assert_eq!(
            policy.risk_level,
            crate::execution_broker::RiskLevelWire::Low
        );
        assert_eq!(
            policy.required_authority,
            crate::execution_broker::AuthorityLevelWire::L0
        );
    }
}
