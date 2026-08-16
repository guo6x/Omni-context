//! Goal24 Post-CP8 Real E2E (DRG-2 candidate) - restricted GitHub issue close
//! execution binding.
//!
//! The ONLY production semantic write capability of this lane. The binding
//! executes exactly one fixed argv template:
//!
//!   gh issue close <number> --repo=<owner/repo>
//!
//! Caller input can only appear as validated values inside those argv
//! elements; callers can never add flags, subcommands, hostnames,
//! executables, cwd, env or a shell. No shell parsing or joining happens
//! anywhere in this module. The executable comes exclusively from the shared
//! validated GitHub CLI context (same pinned gh.exe as the five CP4 reads).
//!
//! Risk policy (compiled, never caller-supplied): medium / L2 /
//! reversible_write - approval is REQUIRED (CP7 native policy mirror) and is
//! consumed atomically before spawn.

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{Map, Value};

use crate::execution_broker::{
    AuthorityLevelWire, ExecutionBinding, ExecutionRiskPolicy, OutputLimits, RiskLevelWire,
    SideEffectClassWire,
};
use crate::github_cli::adapter::GitHubCliContext;
use crate::github_cli::inputs::{parse_inputs, validate_number, validate_owner, validate_repo};
use crate::github_cli::outputs::GithubCliError;
use crate::github_cli::ADAPTER_ID;

/// Compiled capability version for the production write binding.
pub const GITHUB_ISSUE_CLOSE_CAPABILITY_VERSION: &str = "1.0.0";

/// Compiled risk policy for github.issue.close: medium / L2 / reversible.
/// Mirrors the Brain capability declaration exactly; the broker rejects any
/// plan whose risk snapshot differs from this compiled policy.
pub fn github_issue_close_risk_policy() -> ExecutionRiskPolicy {
    ExecutionRiskPolicy {
        risk_level: RiskLevelWire::Medium,
        side_effect_class: SideEffectClassWire::ReversibleWrite,
        reversible: true,
        required_authority: AuthorityLevelWire::L2,
    }
}

/// Strict inputs for github.issue.close (same canonical shape as
/// github.issue.read; unknown keys are rejected).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IssueCloseInput {
    pub owner: String,
    pub repo: String,
    pub number: u64,
}

/// Build the exact argv for `gh issue close` from validated inputs.
fn issue_close_argv(inputs: &Map<String, Value>) -> Result<Vec<OsString>, GithubCliError> {
    let input: IssueCloseInput = parse_inputs(inputs)?;
    let owner = validate_owner(&input.owner, "owner")?;
    let repo = validate_repo(&input.repo, "repo")?;
    validate_number(input.number, "number")?;
    let fused_repo = OsString::from(format!("--repo={owner}/{repo}"));
    Ok(vec![
        OsString::from("issue"),
        OsString::from("close"),
        OsString::from(input.number.to_string()),
        fused_repo,
    ])
}

/// The compiled production write binding. Registered only from compiled
/// trusted code; never reachable from IPC, skills or the LLM.
pub struct GithubIssueCloseBinding {
    context: Arc<GitHubCliContext>,
}

impl GithubIssueCloseBinding {
    pub fn new(context: Arc<GitHubCliContext>) -> Self {
        Self { context }
    }
}

impl ExecutionBinding for GithubIssueCloseBinding {
    fn binding_id(&self) -> &str {
        "github-cli.issue.close"
    }

    fn adapter_id(&self) -> &str {
        ADAPTER_ID
    }

    fn capability_id(&self) -> &str {
        "github.issue.close"
    }

    fn executable_candidates(&self) -> &[PathBuf] {
        self.context.gh_executable_candidates()
    }

    fn build_argv(&self, inputs: &Map<String, Value>) -> Result<Vec<OsString>, String> {
        issue_close_argv(inputs).map_err(|err| err.to_string())
    }

    fn allowed_cwd_roots(&self) -> &[PathBuf] {
        self.context.allowed_cwd_roots()
    }

    fn derive_cwd(&self, _inputs: &Map<String, Value>) -> Result<PathBuf, String> {
        // Inputs can never influence cwd: the adapter-owned work root wins.
        Ok(self.context.work_root().to_path_buf())
    }

    fn env_allowlist(&self) -> &[String] {
        self.context.env_allowlist()
    }

    fn output_limits(&self) -> OutputLimits {
        self.context.output_limits()
    }

    fn capability_version(&self) -> &str {
        GITHUB_ISSUE_CLOSE_CAPABILITY_VERSION
    }

    fn risk_policy(&self) -> ExecutionRiskPolicy {
        github_issue_close_risk_policy()
    }
}

// ---------------------------------------------------------------------------
// Adversarial input validation tests (no gh process needed)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn inputs(raw: Value) -> Map<String, Value> {
        raw.as_object().expect("object").clone()
    }

    #[test]
    fn valid_inputs_build_exact_fused_argv() {
        let argv = issue_close_argv(&inputs(json!({
            "owner": "guo6x",
            "repo": "Omni-context",
            "number": 12
        })))
        .expect("valid inputs");
        let text: Vec<String> = argv
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            text,
            vec!["issue", "close", "12", "--repo=guo6x/Omni-context"]
        );
    }

    #[test]
    fn rejects_unknown_keys_and_injection_fields() {
        for attack in [
            json!({ "owner": "guo6x", "repo": "r", "number": 1, "argv": ["--force"] }),
            json!({ "owner": "guo6x", "repo": "r", "number": 1, "executable": "cmd.exe" }),
            json!({ "owner": "guo6x", "repo": "r", "number": 1, "cwd": "C:\\windows" }),
            json!({ "owner": "guo6x", "repo": "r", "number": 1, "env": {} }),
            json!({ "owner": "guo6x", "repo": "r", "number": 1, "flags": "--reason not_planned" }),
            json!({ "owner": "guo6x", "repo": "r", "number": 1, "shell": true }),
        ] {
            assert!(
                issue_close_argv(&inputs(attack.clone())).is_err(),
                "attack must be rejected: {attack}"
            );
        }
    }

    #[test]
    fn rejects_option_injection_inside_owner_and_repo() {
        for owner in [
            "--repo",
            "-R",
            "a b",
            "a\nb",
            "a\u{0}b",
            "-lead",
            "guo6x/other",
        ] {
            let result = issue_close_argv(&inputs(json!({
                "owner": owner, "repo": "r", "number": 1
            })));
            assert!(result.is_err(), "owner {owner:?} must be rejected");
        }
        for repo in ["--json", "r z", "r\u{0}z", ".", "..", "a/b"] {
            let result = issue_close_argv(&inputs(json!({
                "owner": "guo6x", "repo": repo, "number": 1
            })));
            assert!(result.is_err(), "repo {repo:?} must be rejected");
        }
    }

    #[test]
    fn rejects_invalid_issue_numbers() {
        // negative / zero / fractional / stringly are all rejected or out of
        // domain before any argv element is built.
        for raw in [
            json!({ "owner": "guo6x", "repo": "r", "number": 0 }),
            json!({ "owner": "guo6x", "repo": "r", "number": -1 }),
            json!({ "owner": "guo6x", "repo": "r", "number": 1.5 }),
            json!({ "owner": "guo6x", "repo": "r", "number": "1" }),
        ] {
            assert!(
                issue_close_argv(&inputs(raw.clone())).is_err(),
                "number {raw} must be rejected"
            );
        }
        // Huge issue number: structurally valid input, fails at the gh
        // process level (never converted into success).
        let argv = issue_close_argv(&inputs(json!({
            "owner": "guo6x", "repo": "r", "number": 18446744073709551615_u64
        })))
        .expect("huge number is structurally valid input");
        assert_eq!(argv.len(), 4);
    }

    #[test]
    fn risk_policy_is_medium_l2_reversible() {
        let policy = github_issue_close_risk_policy();
        assert_eq!(policy.risk_level, RiskLevelWire::Medium);
        assert_eq!(policy.required_authority, AuthorityLevelWire::L2);
        assert_eq!(
            policy.side_effect_class,
            SideEffectClassWire::ReversibleWrite
        );
        assert!(policy.reversible);
    }

    // -----------------------------------------------------------------------
    // Broker gate tests (offline, no spawn): the real binding rejects
    // approval-free, risk-downgraded and unknown-binding plans BEFORE any
    // process can spawn.
    // -----------------------------------------------------------------------

    fn broker_with_close_binding() -> (crate::execution_broker::Broker, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("omni-close-gate-{}", std::process::id()));
        let adapter = crate::github_cli::adapter::GitHubCliAdapter::new(
            std::env::current_exe().expect("current_exe"),
            root.clone(),
        )
        .expect("adapter over test exe");
        let broker = crate::execution_broker::Broker::new();
        adapter.register_issue_close(&broker);
        (broker, root)
    }

    fn close_plan(
        risk: &str,
        required_approval: bool,
        with_approval: bool,
    ) -> crate::execution_broker::ExecutionPlanWire {
        let policy = github_issue_close_risk_policy();
        let risk_snapshot = if risk == "compiled" {
            crate::execution_broker::RiskSnapshotWire {
                risk_level: policy.risk_level,
                reversible: policy.reversible,
                side_effect_class: policy.side_effect_class,
                required_authority: policy.required_authority,
                capability_version: "1.0.0".to_string(),
            }
        } else {
            crate::execution_broker::RiskSnapshotWire {
                risk_level: crate::execution_broker::RiskLevelWire::Low,
                reversible: false,
                side_effect_class: crate::execution_broker::SideEffectClassWire::ReadOnly,
                required_authority: crate::execution_broker::AuthorityLevelWire::L0,
                capability_version: "1.0.0".to_string(),
            }
        };
        let approval = if with_approval {
            Some(crate::execution_broker::ApprovalReferenceWire {
                approval_id: "apr-fake".to_string(),
                plan_id: "plan-close-gate".to_string(),
                granted_by: "guo6x".to_string(),
                granted_at: chrono::Utc::now().to_rfc3339(),
                policy_version: "goal24-approval-policy-v1".to_string(),
                token_reference: "grant_fake".to_string(),
                token_digest: "a".repeat(64),
            })
        } else {
            None
        };
        crate::execution_broker::ExecutionPlanWire {
            plan_id: "plan-close-gate".to_string(),
            decision_id: "decision-close-gate".to_string(),
            capability_id: "github.issue.close".to_string(),
            capability_version: "1.0.0".to_string(),
            adapter_id: "github-cli".to_string(),
            normalized_inputs: json!({ "owner": "guo6x", "repo": "Omni-context", "number": 2 })
                .as_object()
                .unwrap()
                .clone(),
            required_approval,
            approval,
            risk_snapshot,
            evidence_coverage_snapshot: crate::execution_broker::EvidenceCoverageSnapshotWire {
                entries: vec![],
            },
            timeout_ms: 60_000,
            verification_plan: Some(crate::execution_broker::VerificationPlanWire {
                verification_capability_id: "github.issue.read".to_string(),
                verification_inputs:
                    json!({ "owner": "guo6x", "repo": "Omni-context", "number": 2 })
                        .as_object()
                        .unwrap()
                        .clone(),
                description: None,
            }),
            rollback_plan: None,
            state: crate::execution_broker::ExecutionPlanStateWire::Ready,
            created_at: chrono::Utc::now().to_rfc3339(),
            expires_at: None,
            correlation_id: None,
            requested_by: Some("close-gate-test".to_string()),
        }
    }

    #[test]
    fn close_without_approval_is_rejected_before_spawn() {
        let (broker, root) = broker_with_close_binding();
        let plan = close_plan("compiled", true, false);
        let err = broker
            .execute(&plan, "github-cli.issue.close")
            .expect_err("close must require a real grant");
        assert_eq!(
            err.code,
            crate::execution_broker::ErrorCode::PlanRejectedApproval
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn close_risk_downgrade_is_rejected_before_spawn() {
        let (broker, root) = broker_with_close_binding();
        let plan = close_plan("downgraded", true, false);
        let err = broker
            .execute(&plan, "github-cli.issue.close")
            .expect_err("a read_only/low/L0 plan can never drive the close binding");
        assert_eq!(
            err.code,
            crate::execution_broker::ErrorCode::PlanRejectedRiskPolicy
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn close_approval_opt_out_is_rejected_before_spawn() {
        let (broker, root) = broker_with_close_binding();
        let plan = close_plan("compiled", false, false);
        let err = broker
            .execute(&plan, "github-cli.issue.close")
            .expect_err("a write plan can never opt out of approval");
        assert_eq!(
            err.code,
            crate::execution_broker::ErrorCode::PlanRejectedApprovalPolicy
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn close_unknown_binding_is_rejected() {
        let (broker, root) = broker_with_close_binding();
        let plan = close_plan("compiled", true, false);
        let err = broker
            .execute(&plan, "github-cli.issue.none")
            .expect_err("unknown binding id must fail");
        assert_eq!(err.code, crate::execution_broker::ErrorCode::UnknownBinding);
        let _ = std::fs::remove_dir_all(&root);
    }
}
