//! Goal24 Checkpoint 8 (Lane B) - restricted read-back verification tests.
//!
//! A `#[cfg(test)]` synthetic write binding mutates a real fixture state
//! file through the hardened broker (write process), the broker persists a
//! native execution receipt, and a test-only read-back binding observes the
//! fixture (read-back process). Neither binding can ever become a
//! production binding.
//!
//! The read-back child is the test binary itself (`std::env::current_exe()`
//! + a test-only child protocol selected through the env allowlist); no
//!   `cmd.exe`, `powershell.exe`, `sh` or `bash` fixture is used.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};

use crate::execution_broker::approval::{ActorKind, GrantRequest};
use crate::execution_broker::policy::{ExecutionBinding, ExecutionRiskPolicy, OutputLimits};
use crate::execution_broker::tests::{child_test_lock, wait_until, TempDir};
use crate::execution_broker::types::{
    ApprovalReferenceWire, AuthorityLevelWire, ErrorCode, EvidenceCoverageSnapshotWire,
    ExecutionPlanStateWire, ExecutionPlanWire, RiskLevelWire, RiskSnapshotWire,
    SideEffectClassWire, VerificationPlanWire,
};
use crate::execution_broker::Broker;

use super::binding::ReadbackBinding;
use super::parser::parse_marker_json;
use super::receipt::build_accepted_receipt;
use super::runner::ReadbackRunner;
use super::store::ReceiptStore;
use super::types::{ExecutionReceiptState, ReadbackParserStatus, MAX_VERIFICATION_ATTEMPTS};

/// Child protocol test name for both the write and the read-back child.
pub const READBACK_CHILD_TEST_NAME: &str =
    "execution_broker::readback::tests::child_protocol_entry";

/// Env allowlist shared by the synthetic write and read-back bindings.
fn readback_env_allowlist() -> Vec<String> {
    vec![
        "OMNI_READBACK_TEST_MODE".to_string(),
        "OMNI_READBACK_STATE_FILE".to_string(),
    ]
}

// ---------------------------------------------------------------------------
// Test-only synthetic write binding (never a production binding)
// ---------------------------------------------------------------------------

/// `#[cfg(test)]` synthetic write binding: medium, L2, reversible_write.
pub fn write_risk_policy() -> ExecutionRiskPolicy {
    ExecutionRiskPolicy {
        risk_level: RiskLevelWire::Medium,
        side_effect_class: SideEffectClassWire::ReversibleWrite,
        reversible: true,
        required_authority: AuthorityLevelWire::L2,
    }
}

pub struct TestWriteBinding {
    exe: PathBuf,
    cwd_root: PathBuf,
    env_allowlist: Vec<String>,
}

impl TestWriteBinding {
    pub fn new(cwd_root: PathBuf) -> Self {
        Self {
            exe: std::env::current_exe().expect("current_exe"),
            cwd_root,
            env_allowlist: readback_env_allowlist(),
        }
    }
}

impl ExecutionBinding for TestWriteBinding {
    fn binding_id(&self) -> &str {
        "test.cp8.write"
    }

    fn adapter_id(&self) -> &str {
        "test-cp8-adapter"
    }

    fn capability_id(&self) -> &str {
        "test.cp8.write"
    }

    fn capability_version(&self) -> &str {
        "1.0.0"
    }

    fn risk_policy(&self) -> ExecutionRiskPolicy {
        write_risk_policy()
    }

    fn executable_candidates(&self) -> &[PathBuf] {
        std::slice::from_ref(&self.exe)
    }

    fn build_argv(&self, inputs: &Map<String, Value>) -> Result<Vec<OsString>, String> {
        build_harness_argv(READBACK_CHILD_TEST_NAME, inputs)
    }

    fn allowed_cwd_roots(&self) -> &[PathBuf] {
        std::slice::from_ref(&self.cwd_root)
    }

    fn derive_cwd(&self, inputs: &Map<String, Value>) -> Result<PathBuf, String> {
        derive_cwd(&self.cwd_root, inputs)
    }

    fn env_allowlist(&self) -> &[String] {
        &self.env_allowlist
    }

    fn output_limits(&self) -> OutputLimits {
        OutputLimits::default()
    }
}

// ---------------------------------------------------------------------------
// Test-only synthetic read-back binding (read-only verifier, never a
// production binding)
// ---------------------------------------------------------------------------

pub struct TestReadbackBinding {
    exe: PathBuf,
    cwd_root: PathBuf,
    env_allowlist: Vec<String>,
    output_limits: OutputLimits,
}

impl TestReadbackBinding {
    pub fn new(cwd_root: PathBuf) -> Self {
        Self {
            exe: std::env::current_exe().expect("current_exe"),
            cwd_root,
            env_allowlist: readback_env_allowlist(),
            output_limits: OutputLimits::default(),
        }
    }

    pub fn with_output_limits(mut self, output_limits: OutputLimits) -> Self {
        self.output_limits = output_limits;
        self
    }
}

impl ReadbackBinding for TestReadbackBinding {
    fn binding_id(&self) -> &str {
        "test.cp8.readback.binding"
    }

    fn adapter_id(&self) -> &str {
        "test-cp8-adapter"
    }

    fn capability_id(&self) -> &str {
        "test.cp8.readback"
    }

    fn capability_version(&self) -> &str {
        "1.0.0"
    }

    fn risk_policy(&self) -> ExecutionRiskPolicy {
        ExecutionRiskPolicy::read_only_low_l0()
    }

    fn executable_candidates(&self) -> &[PathBuf] {
        std::slice::from_ref(&self.exe)
    }

    fn build_argv(&self, inputs: &Map<String, Value>) -> Result<Vec<OsString>, String> {
        build_harness_argv(READBACK_CHILD_TEST_NAME, inputs)
    }

    fn allowed_cwd_roots(&self) -> &[PathBuf] {
        std::slice::from_ref(&self.cwd_root)
    }

    fn derive_cwd(&self, inputs: &Map<String, Value>) -> Result<PathBuf, String> {
        derive_cwd(&self.cwd_root, inputs)
    }

    fn env_allowlist(&self) -> &[String] {
        &self.env_allowlist
    }

    fn output_limits(&self) -> OutputLimits {
        self.output_limits
    }

    fn subject_key(&self, inputs: &Map<String, Value>) -> Result<String, String> {
        inputs
            .get("state_file")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| "verification inputs must carry a state_file".to_string())
    }

    fn parse(&self, raw: &super::types::ReadbackRawOutput) -> super::types::ReadbackParseResult {
        parse_marker_json(raw)
    }
}

/// A read-back binding that lies about its risk policy: it declares an
/// elevated write policy and must be rejected at registration.
pub struct TestElevatedReadbackBinding {
    inner: TestReadbackBinding,
}

impl TestElevatedReadbackBinding {
    pub fn new(cwd_root: PathBuf) -> Self {
        Self {
            inner: TestReadbackBinding::new(cwd_root),
        }
    }
}

impl ReadbackBinding for TestElevatedReadbackBinding {
    fn binding_id(&self) -> &str {
        "test.cp8.readback.elevated"
    }

    fn adapter_id(&self) -> &str {
        self.inner.adapter_id()
    }

    fn capability_id(&self) -> &str {
        "test.cp8.readback"
    }

    fn capability_version(&self) -> &str {
        self.inner.capability_version()
    }

    fn risk_policy(&self) -> ExecutionRiskPolicy {
        write_risk_policy()
    }

    fn executable_candidates(&self) -> &[PathBuf] {
        self.inner.executable_candidates()
    }

    fn build_argv(&self, inputs: &Map<String, Value>) -> Result<Vec<OsString>, String> {
        self.inner.build_argv(inputs)
    }

    fn allowed_cwd_roots(&self) -> &[PathBuf] {
        self.inner.allowed_cwd_roots()
    }

    fn derive_cwd(&self, inputs: &Map<String, Value>) -> Result<PathBuf, String> {
        self.inner.derive_cwd(inputs)
    }

    fn env_allowlist(&self) -> &[String] {
        self.inner.env_allowlist()
    }

    fn output_limits(&self) -> OutputLimits {
        self.inner.output_limits()
    }

    fn subject_key(&self, inputs: &Map<String, Value>) -> Result<String, String> {
        self.inner.subject_key(inputs)
    }
}

// ---------------------------------------------------------------------------
// Test-only child protocol (the test binary itself)
// ---------------------------------------------------------------------------

#[test]
#[ignore]
fn child_protocol_entry() {
    let mode = std::env::var("OMNI_READBACK_TEST_MODE").unwrap_or_default();
    match mode.as_str() {
        // True positive: mutate the fixture then exit 0.
        "write-new" => {
            write_state("new");
            println!(r#"{{"write":"new"}}"#);
        }
        // False positive: claim success on stdout without mutating state.
        "write-fake" => {
            println!(r#"{{"write":"new"}}"#);
        }
        // Partial effect: mutate the fixture, then exit nonzero.
        "write-then-exit1" => {
            write_state("new");
            println!(r#"{{"write":"new"}}"#);
            std::process::exit(7);
        }
        // Effect happened before a broker timeout killed the process.
        "write-then-sleep" => {
            write_state("new");
            std::thread::sleep(Duration::from_secs(300));
        }
        // Effect happened before the broker cancelled the process.
        "write-then-wait" => {
            write_state("new");
            std::thread::sleep(Duration::from_secs(300));
        }
        // Structured read-back: emit the observed fixture state as strict
        // machine-readable JSON.
        "read-state" => {
            let value = std::fs::read_to_string(state_file().expect("state file"))
                .unwrap_or_else(|_| "old".to_string());
            println!("OMNI_READBACK_JSON_BEGIN");
            println!(
                "{{\"value\":{}}}",
                serde_json::to_string(&value).expect("json")
            );
            println!("OMNI_READBACK_JSON_END");
        }
        // Natural-language stdout must never parse as an observation.
        "read-natural-language" => {
            println!("Success! state looks good");
        }
        // Exceeds the compiled read-back output cap: truncated=true.
        "read-large" => {
            println!("OMNI_READBACK_JSON_BEGIN");
            let mut line = String::from("{");
            for i in 0..4096 {
                line.push_str(&format!("{{\"n\":{i}}},"));
            }
            line.push('}');
            println!("{line}");
            println!("OMNI_READBACK_JSON_END");
        }
        // Read-back child that hangs: the broker timeout must surface as
        // process_timed_out with a malformed payload, never as success.
        "read-hang" => {
            std::thread::sleep(Duration::from_secs(300));
        }
        // Read-back child that exits nonzero without emitting JSON.
        "read-exit7" => {
            std::process::exit(7);
        }
        _ => {
            println!("OMNI_READBACK_CHILD_UNKNOWN_MODE");
        }
    }
}

fn state_file() -> Option<String> {
    std::env::var("OMNI_READBACK_STATE_FILE").ok()
}

fn write_state(value: &str) {
    let path = state_file().expect("OMNI_READBACK_STATE_FILE missing");
    std::fs::write(&path, value).expect("write fixture state");
}

fn build_harness_argv(
    test_name: &str,
    inputs: &Map<String, Value>,
) -> Result<Vec<OsString>, String> {
    let mut argv = vec![
        OsString::from("--exact"),
        OsString::from(test_name),
        OsString::from("--ignored"),
        OsString::from("--nocapture"),
    ];
    if let Some(args) = inputs.get("args").and_then(|v| v.as_array()) {
        for arg in args {
            let s = arg
                .as_str()
                .ok_or_else(|| "args entries must be strings".to_string())?;
            argv.push(OsString::from(s));
        }
    }
    Ok(argv)
}

fn derive_cwd(root: &Path, inputs: &Map<String, Value>) -> Result<PathBuf, String> {
    match inputs.get("cwd").and_then(|v| v.as_str()) {
        Some(cwd) => Ok(PathBuf::from(cwd)),
        None => Ok(root.to_path_buf()),
    }
}

// ---------------------------------------------------------------------------
// Plan / grant / broker helpers
// ---------------------------------------------------------------------------

fn fresh_plan_id() -> String {
    format!(
        "plan-{}",
        &crate::execution_broker::approval::digest::random_hex32().expect("plan id")[..16]
    )
}

/// A write plan carrying the CP8 verification linkage. The verification
/// inputs are bound by the approval digest and copied natively into the
/// execution receipt; a caller can never supply them at read-back time.
pub(crate) fn write_plan(state_file: &str) -> ExecutionPlanWire {
    ExecutionPlanWire {
        plan_id: fresh_plan_id(),
        decision_id: "decision-cp8".to_string(),
        capability_id: "test.cp8.write".to_string(),
        capability_version: "1.0.0".to_string(),
        adapter_id: "test-cp8-adapter".to_string(),
        normalized_inputs: json!({ "write": "fixture" })
            .as_object()
            .expect("object")
            .clone(),
        required_approval: true,
        approval: None,
        risk_snapshot: RiskSnapshotWire {
            risk_level: RiskLevelWire::Medium,
            reversible: true,
            side_effect_class: SideEffectClassWire::ReversibleWrite,
            required_authority: AuthorityLevelWire::L2,
            capability_version: "1.0.0".to_string(),
        },
        evidence_coverage_snapshot: EvidenceCoverageSnapshotWire { entries: vec![] },
        timeout_ms: 10_000,
        verification_plan: Some(VerificationPlanWire {
            verification_capability_id: "test.cp8.readback".to_string(),
            verification_inputs: json!({ "state_file": state_file })
                .as_object()
                .expect("object")
                .clone(),
            description: None,
        }),
        rollback_plan: None,
        state: ExecutionPlanStateWire::Ready,
        created_at: chrono::Utc::now().to_rfc3339(),
        expires_at: None,
        correlation_id: None,
        requested_by: Some("unit-test-cp8".to_string()),
    }
}

pub(crate) fn grant_write(broker: &Broker, plan: &ExecutionPlanWire) -> ApprovalReferenceWire {
    let expires_at = (chrono::Utc::now() + chrono::Duration::minutes(5)).to_rfc3339();
    broker
        .grant_approval(&GrantRequest {
            plan,
            approval_request_id: None,
            actor_id: "owner-cp8".to_string(),
            actor_kind: ActorKind::Owner,
            actor_authority: AuthorityLevelWire::L3,
            expires_at,
            binding_policy: &write_risk_policy(),
        })
        .expect("native write grant")
}

fn broker_with_fixture(root: &Path) -> Broker {
    let broker = Broker::new();
    broker.register_binding(Box::new(TestWriteBinding::new(root.to_path_buf())));
    broker
        .register_readback_binding(Box::new(TestReadbackBinding::new(root.to_path_buf())))
        .expect("read-back binding");
    broker
}

/// Execute an approved write and return its durable receipt id.
fn execute_write(broker: &Broker, state_file: &str, mode: &str) -> String {
    let _guard = child_test_lock();
    std::env::set_var("OMNI_READBACK_TEST_MODE", mode);
    std::env::set_var("OMNI_READBACK_STATE_FILE", state_file);
    let mut plan = write_plan(state_file);
    plan.approval = Some(grant_write(broker, &plan));
    let _result = broker
        .execute(&plan, "test.cp8.write")
        .expect("write execution");
    let receipt = broker
        .receipts_for_plan(&plan.plan_id)
        .expect("receipts")
        .into_iter()
        .next()
        .expect("one receipt");
    receipt.receipt_id
}

// ---------------------------------------------------------------------------
// True positive / false positive / partial effect / timeout / cancel
// ---------------------------------------------------------------------------

#[test]
fn write_then_readback_true_positive() {
    let tmp = TempDir::new("cp8-readback-true");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "old").expect("fixture");
    let broker = broker_with_fixture(tmp.path());

    let receipt_id = execute_write(&broker, state_file.to_str().unwrap(), "write-new");

    let receipt = broker
        .lookup_receipt(&receipt_id)
        .expect("lookup")
        .expect("receipt");
    assert_eq!(receipt.execution_state, ExecutionReceiptState::Completed);
    assert_eq!(receipt.exit_code, Some(0));
    assert!(receipt.spawn_started_at.is_some());
    assert!(receipt.finished_at.is_some());
    assert!(receipt.stdout_digest.is_some());
    assert!(receipt.resolved_executable_fingerprint.is_some());
    assert_eq!(
        std::fs::read_to_string(&state_file).expect("fixture"),
        "new",
        "the synthetic write must mutate the fixture"
    );

    {
        let _guard = child_test_lock();
        std::env::set_var("OMNI_READBACK_TEST_MODE", "read-state");
        std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
        let envelope = broker
            .perform_readback(&receipt_id)
            .expect("read-back observation");
        assert_eq!(
            envelope.payload,
            json!({ "value": "new" }),
            "native observation must reflect real post-state"
        );
        assert_eq!(
            envelope.parser_status,
            ReadbackParserStatus::Parsed,
            "structured parser must parse the machine-readable observation"
        );
        assert!(!envelope.truncated);
        assert_eq!(envelope.origin_plan_id, receipt.plan_id);
        assert_eq!(envelope.origin_execution_receipt_id, receipt_id);
        assert_eq!(envelope.verification_capability_id, "test.cp8.readback");
        assert_eq!(envelope.subject_key, state_file.to_str().unwrap());
    }
}

#[test]
fn false_positive_exit0_stdout_is_not_truth() {
    let tmp = TempDir::new("cp8-readback-false");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "old").expect("fixture");
    let broker = broker_with_fixture(tmp.path());

    let receipt_id = execute_write(&broker, state_file.to_str().unwrap(), "write-fake");

    // The write process exited 0 and printed a fake success message, but the
    // fixture did not change. The native observation must return the real
    // post-state, never the lying stdout.
    assert_eq!(
        std::fs::read_to_string(&state_file).expect("fixture"),
        "old"
    );

    let _guard = child_test_lock();
    std::env::set_var("OMNI_READBACK_TEST_MODE", "read-state");
    std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
    let envelope = broker
        .perform_readback(&receipt_id)
        .expect("read-back observation");
    assert_eq!(
        envelope.payload,
        json!({ "value": "old" }),
        "exit 0 + stdout text must never be treated as post-state verification"
    );
    assert_eq!(envelope.parser_status, ReadbackParserStatus::Parsed);
}

#[test]
fn partial_effect_exit_nonzero_still_readback() {
    let tmp = TempDir::new("cp8-readback-partial");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "old").expect("fixture");
    let broker = broker_with_fixture(tmp.path());

    let receipt_id = execute_write(&broker, state_file.to_str().unwrap(), "write-then-exit1");

    let receipt = broker
        .lookup_receipt(&receipt_id)
        .expect("lookup")
        .expect("receipt");
    assert_eq!(receipt.execution_state, ExecutionReceiptState::Completed);
    assert_eq!(receipt.exit_code, Some(7));

    let _guard = child_test_lock();
    std::env::set_var("OMNI_READBACK_TEST_MODE", "read-state");
    std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
    let envelope = broker
        .perform_readback(&receipt_id)
        .expect("read-back after nonzero exit must still be allowed");
    assert_eq!(
        envelope.payload,
        json!({ "value": "new" }),
        "a partial external effect can exist even when the process exited nonzero"
    );
}

#[test]
fn timeout_after_effect_still_readback() {
    let tmp = TempDir::new("cp8-readback-timeout");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "old").expect("fixture");
    let broker = broker_with_fixture(tmp.path());

    let plan_id = {
        let _guard = child_test_lock();
        std::env::set_var("OMNI_READBACK_TEST_MODE", "write-then-sleep");
        std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
        let mut plan = write_plan(state_file.to_str().unwrap());
        plan.timeout_ms = 1_000;
        let plan_id = plan.plan_id.clone();
        plan.approval = Some(grant_write(&broker, &plan));
        let result = broker
            .execute(&plan, "test.cp8.write")
            .expect("write execution");
        assert!(result.timed_out, "the child must exceed the plan timeout");
        assert!(!result.success);
        plan_id
    };

    let receipt = broker
        .receipts_for_plan(&plan_id)
        .expect("receipts")
        .into_iter()
        .next()
        .expect("one receipt");
    assert_eq!(receipt.execution_state, ExecutionReceiptState::Completed);
    assert!(receipt.timed_out);

    let _guard = child_test_lock();
    std::env::set_var("OMNI_READBACK_TEST_MODE", "read-state");
    std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
    let envelope = broker
        .perform_readback(&receipt.receipt_id)
        .expect("read-back after timeout must still be allowed");
    assert_eq!(
        envelope.payload,
        json!({ "value": "new" }),
        "a timeout must never be assumed to mean no external effect"
    );
}

#[test]
fn cancel_after_effect_still_readback() {
    let tmp = TempDir::new("cp8-readback-cancel");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "old").expect("fixture");
    let broker = std::sync::Arc::new(broker_with_fixture(tmp.path()));

    let plan_id = {
        // The env-var mutations are serialized against every other child-
        // spawning test; the guard is scoped so the read-back below can
        // re-acquire it.
        let _guard = child_test_lock();
        std::env::set_var("OMNI_READBACK_TEST_MODE", "write-then-wait");
        std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
        let mut plan = write_plan(state_file.to_str().unwrap());
        plan.timeout_ms = 120_000;
        let plan_id = plan.plan_id.clone();
        plan.approval = Some(grant_write(&broker, &plan));

        let broker2 = broker.clone();
        let handle = std::thread::spawn(move || broker2.execute(&plan, "test.cp8.write"));

        let deadline = Instant::now() + Duration::from_secs(15);
        assert!(
            wait_until(deadline, || !broker.active_executions().is_empty()),
            "write execution never became active"
        );
        assert!(
            wait_until(deadline, || std::fs::read_to_string(&state_file)
                .is_ok_and(|value| value == "new")),
            "external write effect was not observed before cancellation"
        );
        let execution_id = broker.active_executions()[0].clone();
        broker
            .cancel_execution(&execution_id)
            .expect("cancel known execution");
        let result = handle.join().expect("thread").expect("result");
        assert!(result.cancelled);
        plan_id
    };

    let receipt = broker
        .receipts_for_plan(&plan_id)
        .expect("receipts")
        .into_iter()
        .next()
        .expect("one receipt");
    assert_eq!(receipt.execution_state, ExecutionReceiptState::Completed);
    assert!(receipt.cancelled);

    let _guard = child_test_lock();
    std::env::set_var("OMNI_READBACK_TEST_MODE", "read-state");
    std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
    let envelope = broker
        .perform_readback(&receipt.receipt_id)
        .expect("read-back after cancel must still be allowed");
    assert_eq!(
        envelope.payload,
        json!({ "value": "new" }),
        "a cancellation must never be assumed to mean no external effect"
    );
}

// ---------------------------------------------------------------------------
// Read-back process failure modes (never a default success)
// ---------------------------------------------------------------------------

#[test]
fn readback_timeout_is_never_success() {
    let tmp = TempDir::new("cp8-readback-timeout");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "new").expect("fixture");
    let broker = broker_with_fixture(tmp.path());

    let receipt_id = execute_write(&broker, state_file.to_str().unwrap(), "write-new");

    let _guard = child_test_lock();
    std::env::set_var("OMNI_READBACK_TEST_MODE", "read-hang");
    std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
    // READBACK_TIMEOUT_MS (30s) is the compiled read-back bound; the child
    // hangs for 300s so the broker timeout must win.
    let envelope = broker
        .perform_readback(&receipt_id)
        .expect("a timed-out read-back still produces an observation envelope");
    assert!(
        envelope.process_timed_out,
        "a hanging read-back must be reported as timed out"
    );
    assert_eq!(
        envelope.payload,
        json!({}),
        "a timed-out read-back can never report partial truth"
    );
    assert_eq!(envelope.parser_status, ReadbackParserStatus::Malformed);
    assert!(!envelope.truncated);
    // The envelope carries process metadata only; there is no success /
    // verified field anywhere in the native observation shape.
    let serialized = serde_json::to_value(&envelope).expect("serialize");
    assert!(serialized.get("verified").is_none());
    assert!(serialized.get("success").is_none());
    assert!(serialized.get("business_success").is_none());
}

#[test]
fn readback_nonzero_exit_is_never_success() {
    let tmp = TempDir::new("cp8-readback-exit7");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "new").expect("fixture");
    let broker = broker_with_fixture(tmp.path());

    let receipt_id = execute_write(&broker, state_file.to_str().unwrap(), "write-new");

    let _guard = child_test_lock();
    std::env::set_var("OMNI_READBACK_TEST_MODE", "read-exit7");
    std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
    let envelope = broker
        .perform_readback(&receipt_id)
        .expect("a nonzero-exit read-back still produces an observation envelope");
    assert_eq!(envelope.process_exit_code, Some(7));
    assert_eq!(
        envelope.payload,
        json!({}),
        "a failing read-back can never report partial truth"
    );
    assert_eq!(envelope.parser_status, ReadbackParserStatus::Malformed);
    let serialized = serde_json::to_value(&envelope).expect("serialize");
    assert!(serialized.get("verified").is_none());
}

// ---------------------------------------------------------------------------
// Authority / eligibility / binding rules
// ---------------------------------------------------------------------------

#[test]
fn receipt_store_is_the_only_execution_authority() {
    // There is no API that accepts a caller-constructed result; a read-back
    // request is a bare receipt id resolved against the trusted store.
    let tmp = TempDir::new("cp8-readback-authority");
    let broker = broker_with_fixture(tmp.path());
    let err = broker
        .perform_readback("receipt_does_not_exist")
        .expect_err("unknown receipt id must fail closed");
    assert_eq!(err.code, ErrorCode::ReceiptNotFound);
}

#[test]
fn readback_binding_must_be_read_only() {
    let tmp = TempDir::new("cp8-readback-binding-risk");
    let runner = ReadbackRunner::new();
    let err = runner
        .register(Box::new(TestElevatedReadbackBinding::new(
            tmp.path().to_path_buf(),
        )))
        .expect_err("elevated verification binding must be rejected");
    assert_eq!(err.code, ErrorCode::ReadbackBindingNotReadOnly);

    let broker = Broker::new();
    let err = broker
        .register_readback_binding(Box::new(TestElevatedReadbackBinding::new(
            tmp.path().to_path_buf(),
        )))
        .expect_err("broker must reject elevated read-back bindings");
    assert_eq!(err.code, ErrorCode::ReadbackBindingNotReadOnly);
}

#[test]
fn accepted_and_spawn_failed_receipts_are_not_readback_eligible() {
    let tmp = TempDir::new("cp8-readback-not-eligible");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "old").expect("fixture");
    let store = ReceiptStore::in_memory();
    let runner = ReadbackRunner::new();
    runner
        .register(Box::new(TestReadbackBinding::new(tmp.path().to_path_buf())))
        .expect("binding");

    let plan = write_plan(state_file.to_str().unwrap());
    let receipt =
        build_accepted_receipt(&plan, "test.cp8.write", "2026-08-14T00:00:00Z").expect("receipt");
    store.insert_accepted(receipt.clone()).expect("insert");

    // accepted: no observed spawn, nothing to read back.
    let err = runner
        .perform_readback(&store, &receipt.receipt_id)
        .expect_err("accepted receipt must not be read-back eligible");
    assert_eq!(err.code, ErrorCode::ReadbackNotEligible);

    // spawn_failed: provably no process was created, nothing to read back.
    store
        .mark_spawn_failed(&receipt.receipt_id)
        .expect("transition");
    let err = runner
        .perform_readback(&store, &receipt.receipt_id)
        .expect_err("spawn_failed receipt must not be read-back eligible");
    assert_eq!(err.code, ErrorCode::ReadbackNotEligible);
}

#[test]
fn spawn_started_receipt_is_readback_eligible() {
    let tmp = TempDir::new("cp8-readback-spawn-started");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "new").expect("fixture");
    let store = ReceiptStore::in_memory();
    let runner = ReadbackRunner::new();
    runner
        .register(Box::new(TestReadbackBinding::new(tmp.path().to_path_buf())))
        .expect("binding");

    let plan = write_plan(state_file.to_str().unwrap());
    let receipt =
        build_accepted_receipt(&plan, "test.cp8.write", "2026-08-14T00:00:00Z").expect("receipt");
    store.insert_accepted(receipt.clone()).expect("insert");
    store
        .mark_spawn_started(&receipt.receipt_id, "2026-08-14T00:00:01Z")
        .expect("transition");

    let _guard = child_test_lock();
    std::env::set_var("OMNI_READBACK_TEST_MODE", "read-state");
    std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
    let envelope = runner
        .perform_readback(&store, &receipt.receipt_id)
        .expect("spawn_started receipt must be read-back eligible");
    assert_eq!(envelope.payload, json!({ "value": "new" }));
    assert_eq!(envelope.parser_status, ReadbackParserStatus::Parsed);
}

#[test]
fn missing_verification_linkage_is_not_eligible() {
    let tmp = TempDir::new("cp8-readback-no-linkage");
    let store = ReceiptStore::in_memory();
    let runner = ReadbackRunner::new();
    runner
        .register(Box::new(TestReadbackBinding::new(tmp.path().to_path_buf())))
        .expect("binding");

    let mut plan = write_plan(tmp.path().join("unused.txt").to_str().unwrap());
    plan.verification_plan = None;
    let receipt =
        build_accepted_receipt(&plan, "test.cp8.write", "2026-08-14T00:00:00Z").expect("receipt");
    store.insert_accepted(receipt.clone()).expect("insert");
    store
        .mark_spawn_started(&receipt.receipt_id, "2026-08-14T00:00:01Z")
        .expect("transition");

    let err = runner
        .perform_readback(&store, &receipt.receipt_id)
        .expect_err("receipt without verification linkage must not be eligible");
    assert_eq!(err.code, ErrorCode::ReadbackNotEligible);
}

#[test]
fn unregistered_verification_capability_is_a_mismatch() {
    let tmp = TempDir::new("cp8-readback-cap-mismatch");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "old").expect("fixture");
    let store = ReceiptStore::in_memory();
    let runner = ReadbackRunner::new();
    // Deliberately register NOTHING: the receipt's verification capability
    // has no trusted binding.
    let plan = write_plan(state_file.to_str().unwrap());
    let receipt =
        build_accepted_receipt(&plan, "test.cp8.write", "2026-08-14T00:00:00Z").expect("receipt");
    store.insert_accepted(receipt.clone()).expect("insert");
    store
        .mark_spawn_started(&receipt.receipt_id, "2026-08-14T00:00:01Z")
        .expect("transition");

    let err = runner
        .perform_readback(&store, &receipt.receipt_id)
        .expect_err("no trusted binding for the verification capability");
    assert_eq!(err.code, ErrorCode::ReadbackCapabilityMismatch);
}

// ---------------------------------------------------------------------------
// Attempt single-use / hard bound / envelope contract
// ---------------------------------------------------------------------------

#[test]
fn attempt_ids_are_single_use() {
    let tmp = TempDir::new("cp8-readback-attempt-replay");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "new").expect("fixture");
    let store = ReceiptStore::in_memory();
    let runner = ReadbackRunner::new();
    runner
        .register(Box::new(TestReadbackBinding::new(tmp.path().to_path_buf())))
        .expect("binding");

    let plan = write_plan(state_file.to_str().unwrap());
    let receipt =
        build_accepted_receipt(&plan, "test.cp8.write", "2026-08-14T00:00:00Z").expect("receipt");
    store.insert_accepted(receipt.clone()).expect("insert");
    store
        .mark_spawn_started(&receipt.receipt_id, "2026-08-14T00:00:01Z")
        .expect("transition");

    {
        let _guard = child_test_lock();
        std::env::set_var("OMNI_READBACK_TEST_MODE", "read-state");
        std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
        runner
            .perform_readback_attempt(&store, &receipt.receipt_id, Some("attempt-00000001"))
            .expect("first attempt");
    }
    {
        let _guard = child_test_lock();
        std::env::set_var("OMNI_READBACK_TEST_MODE", "read-state");
        std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
        let err = runner
            .perform_readback_attempt(&store, &receipt.receipt_id, Some("attempt-00000001"))
            .expect_err("the same attempt id must never execute twice");
        assert_eq!(err.code, ErrorCode::ReadbackAttemptReplay);
    }
    assert_eq!(store.attempt_count(&receipt.receipt_id).expect("count"), 1);
}

#[test]
fn verification_attempts_are_hard_bounded_at_five() {
    let tmp = TempDir::new("cp8-readback-max-attempts");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "new").expect("fixture");
    let store = ReceiptStore::in_memory();
    let runner = ReadbackRunner::new();
    runner
        .register(Box::new(TestReadbackBinding::new(tmp.path().to_path_buf())))
        .expect("binding");

    let plan = write_plan(state_file.to_str().unwrap());
    let receipt =
        build_accepted_receipt(&plan, "test.cp8.write", "2026-08-14T00:00:00Z").expect("receipt");
    store.insert_accepted(receipt.clone()).expect("insert");
    store
        .mark_spawn_started(&receipt.receipt_id, "2026-08-14T00:00:01Z")
        .expect("transition");

    let _guard = child_test_lock();
    std::env::set_var("OMNI_READBACK_TEST_MODE", "read-state");
    std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
    for index in 0..MAX_VERIFICATION_ATTEMPTS {
        let attempt_id = format!("attempt-{index:08}");
        runner
            .perform_readback_attempt(&store, &receipt.receipt_id, Some(&attempt_id))
            .expect("attempt within the hard bound");
    }
    assert_eq!(
        store.attempt_count(&receipt.receipt_id).expect("count"),
        MAX_VERIFICATION_ATTEMPTS
    );
    let err = runner
        .perform_readback_attempt(&store, &receipt.receipt_id, Some("attempt-00000005"))
        .expect_err("attempt 6 must exceed the native hard bound");
    assert_eq!(err.code, ErrorCode::ReadbackAttemptLimitExceeded);
}

#[test]
fn envelope_never_carries_a_verified_claim() {
    let tmp = TempDir::new("cp8-readback-no-verified");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "old").expect("fixture");
    let broker = broker_with_fixture(tmp.path());
    let receipt_id = execute_write(&broker, state_file.to_str().unwrap(), "write-new");

    let _guard = child_test_lock();
    std::env::set_var("OMNI_READBACK_TEST_MODE", "read-state");
    std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
    let envelope = broker
        .perform_readback(&receipt_id)
        .expect("read-back observation");
    let value = serde_json::to_value(&envelope).expect("serialize");
    let object = value.as_object().expect("object");
    assert!(
        !object.contains_key("verified") && !object.contains_key("outcome_verified"),
        "the native layer only acquires observations; it never emits a verified claim"
    );
    assert_eq!(envelope.payload_digest.len(), 64);
    assert!(envelope.process_exit_code.is_some());
}

#[test]
fn structured_parser_rejects_natural_language_stdout() {
    let tmp = TempDir::new("cp8-readback-malformed");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "old").expect("fixture");
    let broker = broker_with_fixture(tmp.path());
    let receipt_id = execute_write(&broker, state_file.to_str().unwrap(), "write-new");

    let _guard = child_test_lock();
    std::env::set_var("OMNI_READBACK_TEST_MODE", "read-natural-language");
    std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
    let envelope = broker
        .perform_readback(&receipt_id)
        .expect("read-back observation");
    assert_eq!(
        envelope.parser_status,
        ReadbackParserStatus::Malformed,
        "natural-language stdout must never be parsed into a structured observation"
    );
    // The unified V1 contract keeps the payload a JSON object even for a
    // failed parse: malformed observations report an empty object, never
    // partial truth (Brain rejects malformed on the parser gate anyway).
    assert_eq!(envelope.payload, json!({}));
}

#[test]
fn truncated_output_is_marked_and_never_complete() {
    let tmp = TempDir::new("cp8-readback-truncated");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "old").expect("fixture");
    let broker = Broker::new();
    broker.register_binding(Box::new(TestWriteBinding::new(tmp.path().to_path_buf())));
    broker
        .register_readback_binding(Box::new(
            TestReadbackBinding::new(tmp.path().to_path_buf()).with_output_limits(OutputLimits {
                stdout_max_bytes: 64,
                stderr_max_bytes: 64,
            }),
        ))
        .expect("binding");
    let receipt_id = execute_write(&broker, state_file.to_str().unwrap(), "write-new");

    let _guard = child_test_lock();
    std::env::set_var("OMNI_READBACK_TEST_MODE", "read-large");
    std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
    let envelope = broker
        .perform_readback(&receipt_id)
        .expect("read-back observation");
    assert!(envelope.truncated, "truncation must be surfaced");
    assert_eq!(
        envelope.parser_status,
        ReadbackParserStatus::Truncated,
        "truncated output must never report a complete parse"
    );
}
