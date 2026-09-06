//! Goal28 Lite - bounded local Git adapter.
//!
//! This module adds one semantic write (`git.branch.create`) and its trusted
//! read-back binding.  The adapter is compiled and registered by the native
//! application; plans can supply only the semantic repository/branch/SHA
//! inputs.  No shell, command string, executable, cwd or environment values
//! cross the broker boundary.

mod adapter;
mod bindings;
mod bootstrap;
mod inputs;
mod readback;

pub use bootstrap::bootstrap_production;

pub const ADAPTER_ID: &str = "git.local";
pub const GIT_BRANCH_CAPABILITY_VERSION: &str = "1.0.0";

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use chrono::{Duration, Utc};
    use serde_json::json;

    use crate::execution_broker::approval::{ActorKind, GrantRequest};
    use crate::execution_broker::readback::types::ExecutionReceiptState;
    use crate::execution_broker::{
        AuthorityLevelWire, Broker, EvidenceCoverageSnapshotWire, ExecutionPlanStateWire,
        ExecutionPlanWire, RiskSnapshotWire, VerificationPlanWire,
    };

    use super::adapter::LocalGitAdapter;
    use super::bindings::{git_branch_create_risk_policy, GitBranchCreateBinding};
    use super::inputs::{parse_create_inputs, parse_read_inputs, validate_branch_name};
    use super::readback::GitBranchReadbackBinding;

    struct Fixture {
        root: PathBuf,
        repo: PathBuf,
        git: PathBuf,
        head: String,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn git_executable() -> PathBuf {
        if let Some(path) = std::env::var_os("OMNI_GIT_EXECUTABLE") {
            let path = PathBuf::from(path);
            if path.is_absolute() && path.is_file() {
                return path;
            }
        }
        #[cfg(windows)]
        let locator = ("where.exe", "git");
        #[cfg(not(windows))]
        let locator = ("which", "git");
        let output = Command::new(locator.0)
            .arg(locator.1)
            .output()
            .expect("the workstation must provide a Git executable for the Goal28 E2E");
        assert!(output.status.success(), "Git locator failed: {:?}", output);
        let path = String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .map(PathBuf::from)
            .find(|candidate| candidate.is_absolute() && candidate.is_file())
            .expect("Git locator returned no absolute executable");
        path
    }

    fn run_git(git: &Path, cwd: &Path, args: &[&str]) -> String {
        let output = Command::new(git)
            .args(args)
            .current_dir(cwd)
            .output()
            .unwrap_or_else(|err| panic!("failed to spawn git {:?}: {err}", args));
        assert!(
            output.status.success(),
            "git {:?} failed with {}: {}",
            args,
            output.status,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn fixture() -> Fixture {
        let root = std::env::temp_dir().join(format!(
            "omni-goal28-git-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let repo = root.join("disposable-repository");
        std::fs::create_dir_all(&repo).expect("fixture repo");
        let git = git_executable();
        run_git(&git, &repo, &["init"]);
        run_git(
            &git,
            &repo,
            &["config", "user.email", "goal28@example.invalid"],
        );
        run_git(&git, &repo, &["config", "user.name", "Goal28 Fixture"]);
        std::fs::write(repo.join("README.md"), "Goal28 disposable fixture\n")
            .expect("fixture file");
        run_git(&git, &repo, &["add", "--", "README.md"]);
        run_git(&git, &repo, &["commit", "-m", "fixture baseline"]);
        let head = run_git(&git, &repo, &["rev-parse", "HEAD"]);
        Fixture {
            root,
            repo,
            git,
            head,
        }
    }

    fn create_plan(fixture: &Fixture) -> ExecutionPlanWire {
        let now = Utc::now();
        let expires_at = (now + Duration::minutes(10)).to_rfc3339();
        let inputs = json!({
            "repository_path": fixture.repo.to_string_lossy(),
            "branch_name": "goal28-fixture/verified",
            "start_point": fixture.head,
        });
        let verification_inputs = json!({
            "repository_path": fixture.repo.to_string_lossy(),
            "branch_name": "goal28-fixture/verified",
        });
        let policy = git_branch_create_risk_policy();
        ExecutionPlanWire {
            plan_id: "plan-goal28-git-golden-0001".to_string(),
            decision_id: "decision-goal28-git-golden-0001".to_string(),
            capability_id: "git.branch.create".to_string(),
            capability_version: "1.0.0".to_string(),
            adapter_id: "git.local".to_string(),
            normalized_inputs: inputs.as_object().unwrap().clone(),
            required_approval: true,
            approval: None,
            risk_snapshot: RiskSnapshotWire {
                risk_level: policy.risk_level,
                reversible: policy.reversible,
                side_effect_class: policy.side_effect_class,
                required_authority: policy.required_authority,
                capability_version: "1.0.0".to_string(),
            },
            evidence_coverage_snapshot: EvidenceCoverageSnapshotWire { entries: vec![] },
            timeout_ms: 30_000,
            verification_plan: Some(VerificationPlanWire {
                verification_capability_id: "git.branch.read".to_string(),
                verification_inputs: verification_inputs.as_object().unwrap().clone(),
                description: Some("Goal28 trusted local Git branch read-back".to_string()),
            }),
            rollback_plan: None,
            state: ExecutionPlanStateWire::Ready,
            created_at: now.to_rfc3339(),
            expires_at: Some(expires_at),
            correlation_id: Some("goal28-git-golden".to_string()),
            requested_by: Some("goal28-controlled-owner".to_string()),
        }
    }

    #[test]
    fn semantic_inputs_reject_shell_and_option_injection() {
        let valid = json!({
            "repository_path": "C:\\fixture",
            "branch_name": "feature/one",
            "start_point": "a".repeat(40),
        });
        assert!(parse_create_inputs(valid.as_object().unwrap()).is_ok());
        for attack in [
            json!({ "repository_path": "C:\\fixture", "branch_name": "feature", "start_point": "a".repeat(40), "command": "git branch" }),
            json!({ "repository_path": "C:\\fixture", "branch_name": "feature", "start_point": "a".repeat(40), "args": ["--force"] }),
        ] {
            assert!(
                parse_create_inputs(attack.as_object().unwrap()).is_err(),
                "attack accepted: {attack}"
            );
        }
        for branch in ["--force", "feature;del"] {
            let parsed = parse_create_inputs(
                json!({
                    "repository_path": "C:\\fixture",
                    "branch_name": branch,
                    "start_point": "a".repeat(40)
                })
                .as_object()
                .unwrap(),
            )
            .expect("semantic fields remain structurally parseable before binding validation");
            assert!(
                validate_branch_name(&parsed.branch_name).is_err(),
                "branch accepted: {branch}"
            );
        }
        assert!(validate_branch_name("feature/one").is_ok());
        assert!(validate_branch_name("--force").is_err());
        assert!(parse_read_inputs(
            json!({
                "repository_path": "C:\\fixture",
                "branch_name": "feature/one"
            })
            .as_object()
            .unwrap()
        )
        .is_ok());
    }

    #[test]
    fn compiled_policy_requires_explicit_approval() {
        let policy = git_branch_create_risk_policy();
        assert_eq!(
            policy.risk_level,
            crate::execution_broker::RiskLevelWire::Medium
        );
        assert_eq!(policy.required_authority, AuthorityLevelWire::L1);
        assert_eq!(
            policy.side_effect_class,
            crate::execution_broker::SideEffectClassWire::ReversibleWrite
        );
        assert!(policy.reversible);
        assert!(policy.native_minimum_approval_required());
        let _ = GitBranchCreateBinding::new;
    }

    #[test]
    fn goal28_git_branch_golden_e2e_uses_approval_receipt_and_readback() {
        let fixture = fixture();
        let adapter = LocalGitAdapter::new(fixture.git.clone(), fixture.root.clone())
            .expect("local Git adapter");
        let broker = Broker::new();
        adapter.register_all(&broker);
        let plan = create_plan(&fixture);

        // The command is expected to fail for a missing branch. Verify the
        // absence without treating its stderr as product evidence.
        let missing = Command::new(&fixture.git)
            .args([
                "show-ref",
                "--verify",
                "--quiet",
                "refs/heads/goal28-fixture/verified",
            ])
            .current_dir(&fixture.repo)
            .status()
            .expect("git show-ref");
        assert!(!missing.success(), "fixture branch unexpectedly exists");
        assert!(broker.receipts_for_plan(&plan.plan_id).unwrap().is_empty());

        let expires_at = plan.expires_at.clone().unwrap();
        let grant = broker
            .grant_approval(&GrantRequest {
                plan: &plan,
                approval_request_id: Some("approval-request-goal28-git-0001".to_string()),
                actor_id: "local-owner".to_string(),
                actor_kind: ActorKind::Owner,
                actor_authority: AuthorityLevelWire::L1,
                expires_at,
                binding_policy: &git_branch_create_risk_policy(),
            })
            .expect("owner approval");
        // Approval alone never invokes the adapter and therefore cannot create
        // the branch or a native receipt.
        assert!(broker.receipts_for_plan(&plan.plan_id).unwrap().is_empty());
        let _ = GitBranchReadbackBinding::new;

        let mut approved_plan = plan.clone();
        approved_plan.approval = Some(grant.clone());
        let result = broker
            .execute(&approved_plan, "git-local.branch.create")
            .expect("restricted local Git execution");
        assert!(result.success);
        assert_eq!(result.exit_code, Some(0));

        let receipt = broker
            .receipts_for_plan(&plan.plan_id)
            .expect("receipt lookup")
            .into_iter()
            .next()
            .expect("one native receipt");
        assert_eq!(receipt.execution_state, ExecutionReceiptState::Completed);
        let readback = broker
            .perform_readback(&receipt.receipt_id)
            .expect("trusted read-back");
        assert_eq!(readback.verification_capability_id, "git.branch.read");
        assert_eq!(readback.subject_key, "git:branch:goal28-fixture/verified");
        assert_eq!(
            readback.payload["target_sha"].as_str(),
            Some(fixture.head.as_str())
        );
        assert_eq!(
            run_git(
                &fixture.git,
                &fixture.repo,
                &["rev-parse", "refs/heads/goal28-fixture/verified"]
            ),
            fixture.head
        );

        let completed_receipt = broker
            .receipts_for_plan(&plan.plan_id)
            .expect("updated receipt lookup")
            .into_iter()
            .next()
            .expect("updated native receipt");
        assert_eq!(completed_receipt.verification_attempts.len(), 1);
        assert_eq!(broker.receipts_for_plan(&plan.plan_id).unwrap().len(), 1);

        let replay = broker.execute(&approved_plan, "git-local.branch.create");
        assert!(
            replay.is_err(),
            "single-use approval/plan replay must be blocked"
        );

        if std::env::var("OMNI_GOAL28_EMIT_NATIVE_PROOF").as_deref() == Ok("1") {
            println!(
                "GOAL28_NATIVE_PROOF {}",
                serde_json::to_string(&json!({
                    "status": "PASS",
                    "test": "goal28_git_branch_golden_e2e_uses_approval_receipt_and_readback",
                    "decision_id": plan.decision_id,
                    "plan_id": plan.plan_id,
                    "receipt_id": receipt.receipt_id,
                    "execution_state": "completed",
                    "readback_capability": "git.branch.read",
                    "branch": "goal28-fixture/verified",
                    "target_sha": fixture.head,
                    "approval_execution_count": 0,
                    "explicit_execute_count": 1,
                    "readback_attempts": 1,
                    "external_write_count": 0,
                }))
                .unwrap()
            );
        }
    }
}
