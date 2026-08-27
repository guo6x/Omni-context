//! Goal24 Post-CP8 Real E2E (DRG-2 candidate) - native operator harness
//! (dev-only, #[ignore] test).
//!
//! Run ONLY via:
//!   cargo test --bin omni-context-desktop \
//!     goal24_real_e2e_native_phase -- --ignored --nocapture
//! with the following environment:
//!   OMNI_REAL_E2E_RUN=1
//!   OMNI_REAL_E2E_BRIDGE=<abs bridge dir>       (default: <crate>/../../.tmp/real-e2e)
//!   OMNI_REAL_E2E_APPROVAL_FILE=<abs file>      (human approval artifact)
//!   OMNI_GITHUB_CLI_EXE=<abs validated gh.exe>  (trusted operator config, same as prod)
//!
//! The harness NEVER auto-approves, NEVER accepts arbitrary capability ids,
//! argv, receipt JSON, observation JSON or outcome verdicts. It rebuilds the
//! plan from the compiled capability + canonical inputs, proves the CP7
//! binding digest matches the Brain-approved plan, requires the one-time
//! human approval artifact, executes the write exactly once through the
//! restricted broker, persists the receipt and performs exactly one trusted
//! read-back. Outcome authority stays with the Brain evaluator.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::execution_broker::approval::digest::approval_binding_digest;
use crate::execution_broker::approval::{ActorKind, GrantRequest};
use crate::execution_broker::{
    ApprovalReferenceWire, AuthorityLevelWire, Broker, EvidenceCoverageSnapshotWire,
    ExecutionPlanStateWire, ExecutionPlanWire, RiskSnapshotWire, VerificationPlanWire,
};
use crate::github_cli::adapter::GitHubCliAdapter;
use crate::github_cli::close_binding::github_issue_close_risk_policy;

pub(crate) const REAL_E2E_POLICY_VERSION: &str = "goal24-approval-policy-v1";

fn env_or(key: &str, default: String) -> String {
    std::env::var(key).unwrap_or(default)
}

fn bridge_dir() -> PathBuf {
    PathBuf::from(env_or(
        "OMNI_REAL_E2E_BRIDGE",
        format!("{}\\..\\..\\.tmp\\real-e2e", env!("CARGO_MANIFEST_DIR")),
    ))
}

fn read_json(path: &Path) -> Value {
    let text = std::fs::read_to_string(path)
        .unwrap_or_else(|err| panic!("bridge file {} unreadable: {err}", path.display()));
    serde_json::from_str(&text).expect("bridge JSON")
}

fn write_json(path: &Path, value: &Value) {
    std::fs::write(
        path,
        format!("{}\n", serde_json::to_string_pretty(value).unwrap()),
    )
    .expect("write bridge");
}

/// The exact one-time human approval artifact.
fn approval_line(owner: &str, repo: &str, number: u64) -> String {
    format!("APPROVE {owner}/{repo}#{number}")
}

fn risk_snapshot_wire() -> RiskSnapshotWire {
    let policy = github_issue_close_risk_policy();
    RiskSnapshotWire {
        risk_level: policy.risk_level,
        reversible: policy.reversible,
        side_effect_class: policy.side_effect_class,
        required_authority: policy.required_authority,
        capability_version: "1.0.0".to_string(),
    }
}

fn parse_verification_plan(value: Option<&Value>) -> Option<VerificationPlanWire> {
    match value {
        Some(v) => serde_json::from_value(v.clone()).expect("verification_plan shape"),
        None => None,
    }
}

fn parse_coverage(value: &Value) -> EvidenceCoverageSnapshotWire {
    serde_json::from_value(value.clone()).expect("evidence coverage shape")
}

/// Rebuild the plan from the compiled capability + the Brain-approved bridge
/// values. Every authority field (risk, capability identity, inputs schema)
/// comes from compiled trusted code; the bridge supplies only the
/// server-owned identities/timestamps/coverage the Brain decision bound.
fn rebuild_plan(brain: &Value) -> ExecutionPlanWire {
    let inputs = brain["normalized_inputs"]
        .as_object()
        .expect("normalized_inputs");
    let owner = inputs["owner"].as_str().expect("owner");
    let repo = inputs["repo"].as_str().expect("repo");
    let number = inputs["number"].as_u64().expect("number");
    if owner.is_empty() || repo.is_empty() || number == 0 {
        panic!("canonical inputs must carry owner/repo/positive number");
    }
    let capability_id = brain["capability_id"].as_str().expect("capability_id");
    assert_eq!(
        capability_id, "github.issue.close",
        "harness supports exactly one write"
    );
    let adapter_id = brain["adapter_id"].as_str().expect("adapter_id");
    assert_eq!(
        adapter_id, "github-cli",
        "harness supports exactly one adapter"
    );
    let version = brain["capability_version"]
        .as_str()
        .expect("capability_version");
    assert_eq!(
        version, "1.0.0",
        "harness supports exactly one capability version"
    );

    ExecutionPlanWire {
        plan_id: brain["plan_id"].as_str().expect("plan_id").to_string(),
        decision_id: brain["decision_id"]
            .as_str()
            .expect("decision_id")
            .to_string(),
        capability_id: capability_id.to_string(),
        capability_version: version.to_string(),
        adapter_id: adapter_id.to_string(),
        normalized_inputs: inputs.clone(),
        required_approval: true,
        approval: None,
        risk_snapshot: risk_snapshot_wire(),
        evidence_coverage_snapshot: parse_coverage(&brain["evidence_coverage_snapshot"]),
        timeout_ms: brain["timeout_ms"].as_u64().expect("timeout_ms"),
        verification_plan: parse_verification_plan(brain.get("verification_plan")),
        rollback_plan: None,
        state: ExecutionPlanStateWire::Ready,
        created_at: brain["created_at"]
            .as_str()
            .expect("created_at")
            .to_string(),
        expires_at: brain
            .get("expires_at")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        correlation_id: brain
            .get("correlation_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        requested_by: brain
            .get("requested_by")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    }
}

/// The native phase of the real E2E. Returns the machine-readable run record
/// (also written to the bridge for the Brain verify phase).
#[test]
#[ignore]
fn goal24_real_e2e_native_phase() {
    if std::env::var("OMNI_REAL_E2E_RUN").as_deref() != Ok("1") {
        eprintln!("[real-e2e] skipping: set OMNI_REAL_E2E_RUN=1 to run the native phase");
        return;
    }
    let bridge = bridge_dir();
    std::fs::create_dir_all(&bridge).expect("bridge dir");

    // 1. Load the Brain-approved decision output (server-owned identities only).
    let brain = read_json(&bridge.join("brain-before.json"));
    let plan = rebuild_plan(&brain);
    let inputs = plan.normalized_inputs.clone();
    let owner = inputs["owner"].as_str().unwrap().to_string();
    let repo = inputs["repo"].as_str().unwrap().to_string();
    let number = inputs["number"].as_u64().unwrap();
    println!(
        "[real-e2e] STEP 1-4: Brain decision/plan loaded: plan={} decision={}",
        plan.plan_id, plan.decision_id
    );

    // 2. Cross-side binding proof: the native recomputed CP7 binding digest
    // must equal the digest the Brain decision bound.
    let native_binding = approval_binding_digest(&plan, REAL_E2E_POLICY_VERSION).expect("binding");
    let brain_binding = brain["approval_binding_digest"]
        .as_str()
        .expect("approval_binding_digest");
    assert_eq!(
        &native_binding, brain_binding,
        "plan content must be byte-identical to the Brain-approved decision"
    );
    println!(
        "[real-e2e] STEP 2-3: evidence-bound plan identity matches (binding digest {})",
        &native_binding[..16]
    );

    // 3. Trusted gh discovery via the SAME production adapter bootstrap.
    let gh_path = PathBuf::from(
        std::env::var("OMNI_GITHUB_CLI_EXE")
            .expect("OMNI_GITHUB_CLI_EXE must name an absolute validated gh.exe"),
    );
    let adapter =
        GitHubCliAdapter::new(gh_path, bridge.join("gh-work")).expect("trusted gh adapter");
    let broker = Broker::with_receipt_persistence(
        &bridge.join("approvals.json"),
        &bridge.join("ledger.json"),
        &bridge.join("receipts.json"),
    );
    adapter.register_all(&broker);
    adapter.register_issue_close(&broker);
    adapter.register_issue_readback(&broker);
    println!(
        "[real-e2e] native broker ready: {} execution bindings + read-back registered",
        broker.status().registered_bindings.len()
    );

    // 4. Human approval artifact (single-use; never auto-approved).
    let approval_file = PathBuf::from(
        std::env::var("OMNI_REAL_E2E_APPROVAL_FILE").expect("OMNI_REAL_E2E_APPROVAL_FILE"),
    );
    let expected_line = approval_line(&owner, &repo, number);
    let granted_line = std::fs::read_to_string(&approval_file)
        .map(|text| text.trim().to_string())
        .unwrap_or_default();
    assert_eq!(granted_line, expected_line, "human approval artifact missing or mismatched - the write is BLOCKED (REAL_E2E_EXTERNAL_RUN=BLOCKED_HUMAN_APPROVAL without exact approval)");
    std::fs::remove_file(&approval_file).expect("single-use approval artifact consumed");
    println!("[real-e2e] STEP 4-5: APPROVAL REQUIRED -> human operator granted: {expected_line}");

    // 5. Native CP7 grant (consume-before-spawn, single-use, bound to the plan).
    let expires_at = plan
        .expires_at
        .clone()
        .unwrap_or_else(|| (chrono::Utc::now() + chrono::Duration::minutes(15)).to_rfc3339());
    let grant_reference: ApprovalReferenceWire = broker
        .grant_approval(&GrantRequest {
            plan: &plan,
            approval_request_id: brain
                .get("approval_request_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            actor_id: "guo6x".to_string(),
            actor_kind: ActorKind::Owner,
            actor_authority: AuthorityLevelWire::L3,
            expires_at: expires_at.clone(),
            binding_policy: &github_issue_close_risk_policy(),
        })
        .expect("native grant");
    println!("[real-e2e] STEP 5: native grant issued and stored (single-use, plan-bound)");

    // 6. Restricted broker execution.
    let mut ready_plan = plan.clone();
    ready_plan.approval = Some(grant_reference.clone());
    let result = broker
        .execute(&ready_plan, "github-cli.issue.close")
        .expect("restricted broker execution");
    println!("[real-e2e] STEP 6: RESTRICTED BROKER spawned gh issue close {number} --repo={owner}/{repo}");
    println!(
        "[real-e2e] STEP 7: PROCESS EXIT = {} (success={}) - this is process_succeeded ONLY",
        result
            .exit_code
            .map(|c| c.to_string())
            .unwrap_or_else(|| "none".to_string()),
        result.success
    );
    println!("[real-e2e] STEP 7: OUTCOME = PENDING (exit 0 can NEVER verify an external effect)");

    // 7. Persistent native receipt.
    let receipt = broker
        .receipts_for_plan(&plan.plan_id)
        .expect("receipts")
        .into_iter()
        .next()
        .expect("exactly one receipt per plan");
    println!(
        "[real-e2e] STEP 7: native receipt {} persisted (state {:?})",
        receipt.receipt_id, receipt.execution_state
    );

    // 8. Independent read-back through the trusted read-back runner.
    let envelope = broker
        .perform_readback(&receipt.receipt_id)
        .expect("trusted read-back");
    let readback_state = envelope
        .payload
        .get("state")
        .and_then(|s| s.as_str())
        .unwrap_or("?");
    let readback_number = envelope
        .payload
        .get("number")
        .and_then(|n| n.as_u64())
        .unwrap_or(0);
    println!("[real-e2e] STEP 8: INDEPENDENT READ-BACK github.issue.read -> state={readback_state} number={readback_number}");
    println!(
        "[real-e2e] STEP 8: native observation id {} (no verified field - Brain decides)",
        envelope.observation_id
    );

    // 9. Export the trusted bridge payload for the Brain verify phase.
    let export = json!({
        "grant": {
            "approval_id": grant_reference.approval_id,
            "plan_id": grant_reference.plan_id,
            "granted_by": grant_reference.granted_by,
            "granted_at": grant_reference.granted_at,
            "expires_at": expires_at,
            "policy_version": grant_reference.policy_version,
            "token_reference": grant_reference.token_reference,
            "token_digest": grant_reference.token_digest,
            "actor_id": "guo6x",
            "actor_kind": "owner",
            "actor_authority": "L3"
        },
        "receipt": serde_json::to_value(&receipt).expect("receipt serialize"),
        "receipt_id": receipt.receipt_id,
        "observation": serde_json::to_value(&envelope).expect("envelope serialize"),
        "observation_id": envelope.observation_id,
        "attempt_id": envelope.verification_attempt_id,
        "process": {
            "exit_code": result.exit_code,
            "success": result.success,
            "timed_out": result.timed_out,
            "cancelled": result.cancelled
        }
    });
    write_json(&bridge.join("native-after.json"), &export);
    println!("[real-e2e] native phase complete; bridge written to native-after.json");
    println!(
        "[real-e2e] OUTCOME AUTHORITY: NONE on this side - awaiting the Brain trusted evaluator"
    );
}

/// Goal26 controlled local closed-loop proof. This is deliberately ignored:
/// it starts a real Brain process and a real native Broker, but uses a
/// disposable `cmd.exe` resolver instead of GitHub so no external mutation is
/// possible. Run after building Brain with:
/// `cargo test --bin omni-context-desktop goal26_controlled_local_loop -- --ignored --nocapture`.
#[cfg(test)]
mod goal26_controlled_local_loop {
    use crate::execution_broker::readback::types::{
        ReadbackParseResult, ReadbackParserStatus, ReadbackRawOutput,
    };
    use crate::execution_broker::readback::ReadbackBinding;
    use crate::execution_broker::{
        ExecutionBinding, ExecutionRiskPolicy, OutputLimits, RiskLevelWire, SideEffectClassWire,
    };
    use serde_json::{json, Map, Value};
    use std::ffi::OsString;
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::Once;

    const OWNER: &str = "fixture-owner";
    const REPO: &str = "fixture-repo";
    const NUMBER: u64 = 1;

    #[derive(Debug)]
    struct ControlledCloseBinding {
        executable: PathBuf,
        root: PathBuf,
        env: Vec<String>,
    }

    impl ExecutionBinding for ControlledCloseBinding {
        fn binding_id(&self) -> &str {
            "github-cli.issue.close"
        }
        fn adapter_id(&self) -> &str {
            "github-cli"
        }
        fn capability_id(&self) -> &str {
            "github.issue.close"
        }
        fn executable_candidates(&self) -> &[PathBuf] {
            std::slice::from_ref(&self.executable)
        }
        fn build_argv(&self, _inputs: &Map<String, Value>) -> Result<Vec<OsString>, String> {
            Ok(vec![
                OsString::from("/C"),
                OsString::from("exit"),
                OsString::from("0"),
            ])
        }
        fn allowed_cwd_roots(&self) -> &[PathBuf] {
            std::slice::from_ref(&self.root)
        }
        fn derive_cwd(&self, _inputs: &Map<String, Value>) -> Result<PathBuf, String> {
            Ok(self.root.clone())
        }
        fn env_allowlist(&self) -> &[String] {
            &self.env
        }
        fn output_limits(&self) -> OutputLimits {
            OutputLimits::default()
        }
        fn capability_version(&self) -> &str {
            "1.0.0"
        }
        fn risk_policy(&self) -> ExecutionRiskPolicy {
            ExecutionRiskPolicy {
                // Match the production github.issue.close declaration exactly;
                // the native broker intentionally rejects risk downgrades or
                // policy substitutions even in a controlled fixture.
                risk_level: RiskLevelWire::Medium,
                side_effect_class: SideEffectClassWire::ReversibleWrite,
                reversible: true,
                required_authority: crate::execution_broker::AuthorityLevelWire::L2,
            }
        }
    }

    #[derive(Debug)]
    struct ControlledReadbackBinding {
        executable: PathBuf,
        root: PathBuf,
        env: Vec<String>,
    }

    impl ReadbackBinding for ControlledReadbackBinding {
        fn binding_id(&self) -> &str {
            "github-cli.issue.read.readback"
        }
        fn adapter_id(&self) -> &str {
            "github-cli"
        }
        fn capability_id(&self) -> &str {
            "github.issue.read"
        }
        fn capability_version(&self) -> &str {
            "1.0.0"
        }
        fn risk_policy(&self) -> ExecutionRiskPolicy {
            ExecutionRiskPolicy::read_only_low_l0()
        }
        fn executable_candidates(&self) -> &[PathBuf] {
            std::slice::from_ref(&self.executable)
        }
        fn build_argv(&self, inputs: &Map<String, Value>) -> Result<Vec<OsString>, String> {
            let number = inputs
                .get("number")
                .and_then(Value::as_u64)
                .ok_or("number")?;
            let payload = format!(r#"{{"number":{number},"state":"CLOSED"}}"#);
            Ok(vec![
                OsString::from("/C"),
                OsString::from("echo"),
                OsString::from(payload),
            ])
        }
        fn allowed_cwd_roots(&self) -> &[PathBuf] {
            std::slice::from_ref(&self.root)
        }
        fn derive_cwd(&self, _inputs: &Map<String, Value>) -> Result<PathBuf, String> {
            Ok(self.root.clone())
        }
        fn env_allowlist(&self) -> &[String] {
            &self.env
        }
        fn output_limits(&self) -> OutputLimits {
            OutputLimits::default()
        }
        fn subject_key(&self, inputs: &Map<String, Value>) -> Result<String, String> {
            let owner = inputs.get("owner").and_then(Value::as_str).ok_or("owner")?;
            let repo = inputs.get("repo").and_then(Value::as_str).ok_or("repo")?;
            let number = inputs
                .get("number")
                .and_then(Value::as_u64)
                .ok_or("number")?;
            Ok(format!("issue:{owner}/{repo}#{number}"))
        }
        fn parse(&self, raw: &ReadbackRawOutput) -> ReadbackParseResult {
            let text = raw.stdout.trim();
            // `cmd.exe` receives an argument vector through the Windows C
            // quoting rules and may echo embedded JSON quotes with a leading
            // backslash (or as one quoted JSON string).  Normalize only
            // those two deterministic fixture forms before strict parsing;
            // arbitrary text remains malformed and can never be VERIFIED.
            let candidates = [
                text.to_string(),
                serde_json::from_str::<String>(text).unwrap_or_default(),
                text.replace("\\\"", "\""),
            ];
            for candidate in candidates {
                if candidate.is_empty() {
                    continue;
                }
                if let Ok(value) = serde_json::from_str::<Value>(&candidate) {
                    if value.is_object() {
                        return ReadbackParseResult {
                            payload: value,
                            status: ReadbackParserStatus::Parsed,
                        };
                    }
                }
            }
            ReadbackParseResult {
                payload: Value::Null,
                status: ReadbackParserStatus::Malformed,
            }
        }
    }

    fn free_port() -> u16 {
        TcpListener::bind(("127.0.0.1", 0))
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    async fn request(
        client: &reqwest::Client,
        method: reqwest::Method,
        url: String,
        token: Option<&str>,
        body: Option<Value>,
    ) -> (u16, Value) {
        let mut builder = client.request(method, url);
        if let Some(token) = token {
            builder = builder.bearer_auth(token);
        }
        if let Some(body) = body {
            builder = builder.json(&body);
        }
        let response = builder.send().await.expect("HTTP request");
        let status = response.status().as_u16();
        let payload = response.json::<Value>().await.expect("JSON response");
        (status, payload)
    }

    fn mcp_tool_payload(response: &Value) -> Value {
        let text = response["result"]["content"][0]["text"]
            .as_str()
            .expect("MCP tool text payload");
        serde_json::from_str(text).expect("MCP tool JSON payload")
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore]
    async fn goal26_controlled_local_loop() {
        static ENV_LOCK: Once = Once::new();
        let _ = &ENV_LOCK;
        let root =
            std::env::temp_dir().join(format!("omctx-goal26-controlled-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("controlled root");
        let bridge_port = free_port();
        let brain_port = free_port();
        let local_appdata = root.join("localappdata");
        std::fs::create_dir_all(&local_appdata).expect("local appdata");
        std::env::set_var("LOCALAPPDATA", &local_appdata);
        std::env::set_var("OMNI_BRAIN_PORT", brain_port.to_string());
        std::env::set_var("OMNI_D1B1_E2E_FIXTURE", "1");
        let fixture_path = root.join("fixture.json");
        std::env::set_var("OMNI_D1B1_E2E_FIXTURE_OUTPUT", &fixture_path);
        std::env::set_var("OMNI_EVALUATION_MODE", "1");
        std::env::set_var("NATIVE_BRIDGE_PORT", bridge_port.to_string());
        let broker_dir = root.join("broker");
        std::fs::create_dir_all(&broker_dir).unwrap();
        crate::execution_broker::configure_global_broker_with_persistence(
            &broker_dir.join("approvals.json"),
            &broker_dir.join("ledger.json"),
            &broker_dir.join("receipts.json"),
        );
        let broker = crate::execution_broker::global_broker();
        let comspec = PathBuf::from(
            std::env::var("COMSPEC")
                .unwrap_or_else(|_| "C:\\Windows\\System32\\cmd.exe".to_string()),
        );
        assert!(
            comspec.is_absolute() && comspec.exists(),
            "COMSPEC must be an absolute executable"
        );
        broker.register_binding(Box::new(ControlledCloseBinding {
            executable: comspec.clone(),
            root: root.clone(),
            env: Vec::new(),
        }));
        broker
            .register_readback_binding(Box::new(ControlledReadbackBinding {
                executable: comspec,
                root: root.clone(),
                env: Vec::new(),
            }))
            .expect("readback registration");
        let native = crate::execution_broker::native_control::start();
        std::env::set_var("NATIVE_BRIDGE_SECRET", &native.secret);
        std::env::set_var(
            "NATIVE_BRIDGE_URL",
            format!("http://127.0.0.1:{}", native.port),
        );
        // Start the same Brain process manager used by Desktop commands. This
        // makes the controlled loop exercise the real `is_ready()` gate and
        // the native command session-file flow.
        crate::brain_server::start().expect("start Brain through Desktop manager");
        let client = reqwest::Client::new();
        let base = format!("http://127.0.0.1:{brain_port}");
        let pair_code_path = local_appdata.join("omni-context").join("pair-code.txt");
        let pair_code =
            std::fs::read_to_string(&pair_code_path).expect("Desktop-generated pairing code");
        let (status, pair) = request(
            &client,
            reqwest::Method::POST,
            format!("{base}/api/auth/pair/exchange"),
            Some(pair_code.trim()),
            Some(json!({"device_id":"agent-pilot-goal26","device_type":"agent_pilot"})),
        )
        .await;
        assert_eq!(status, 201, "pair exchange: {pair}");
        let agent_token = pair["device_token"].as_str().unwrap().to_string();
        let ask = json!({
            "question":"Given the controlled evidence, is closing the disposable issue eligible?",
            "capability_id":"github.issue.close","capability_version":"1.0.0",
            "normalized_inputs":{"owner":OWNER,"repo":REPO,"number":NUMBER},
            "create_plan":true,"adapter_id":"github-cli","timeout_ms":5000,
            "verification_plan":{"verification_capability_id":"github.issue.read","verification_inputs":{"owner":OWNER,"repo":REPO,"number":NUMBER}},
            "rollback_plan":null
        });
        let (status, asked) = request(
            &client,
            reqwest::Method::POST,
            format!("{base}/api/agent/ask"),
            Some(&agent_token),
            Some(ask),
        )
        .await;
        assert_eq!(status, 200, "agent ask: {asked}");
        assert_eq!(asked["disposition"], "DECIDE");
        let plan_id = asked["plan"]["plan"]["plan_id"]
            .as_str()
            .unwrap()
            .to_string();
        let decision_id = asked["decision_id"].as_str().unwrap().to_string();

        let (status, _denied) = request(
            &client,
            reqwest::Method::POST,
            format!("{base}/api/control/approve"),
            Some(&agent_token),
            Some(json!({"plan_id":plan_id})),
        )
        .await;
        assert_eq!(status, 403, "agent must not approve");
        let (status, _denied) = request(
            &client,
            reqwest::Method::POST,
            format!("{base}/api/control/verify"),
            Some(&agent_token),
            Some(json!({"plan_id":plan_id})),
        )
        .await;
        assert_eq!(status, 403, "agent must not control verification");
        let (status, _denied) = request(
            &client,
            reqwest::Method::POST,
            format!("{base}/api/control/execute"),
            Some(&agent_token),
            Some(json!({"plan_id":plan_id})),
        )
        .await;
        assert_eq!(status, 403, "agent must not reach an execution route");
        let (status, _denied) = request(
            &client,
            reqwest::Method::GET,
            format!("{base}/internal/control/plan/{plan_id}"),
            Some(&agent_token),
            None,
        )
        .await;
        assert!(
            matches!(status, 401 | 403),
            "agent must not inspect native plan internals"
        );
        let (status, _denied) = request(
            &client,
            reqwest::Method::POST,
            format!("{base}/internal/control/session"),
            Some(&agent_token),
            Some(json!({})),
        )
        .await;
        assert!(
            matches!(status, 401 | 403),
            "agent must not mint a control session"
        );
        let (status, denied_write) = request(&client, reqwest::Method::POST, format!("{base}/mcp"), Some(&agent_token), Some(json!({"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"add_entity","arguments":{"name":"forbidden","type":"concept"}}}))).await;
        assert_eq!(status, 200);
        assert!(denied_write["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("allowlist"));
        // The human Desktop command mints the short-lived approval session
        // into its protected native file and then calls the canonical
        // approval authority.  Approval must not execute anything.
        crate::commands::enable_cli_approvals()
            .await
            .expect("enable Desktop approvals");
        let approved = crate::commands::approve_pending_plan(plan_id.clone())
            .await
            .expect("Desktop approval command");
        assert_eq!(approved["data"]["execution_started"], false);

        let (status, internal) = request(
            &client,
            reqwest::Method::GET,
            format!("{base}/internal/control/plan/{plan_id}"),
            Some(&native.secret),
            None,
        )
        .await;
        assert_eq!(status, 200, "plan lookup: {internal}");
        let ready: crate::execution_broker::ExecutionPlanWire =
            serde_json::from_value(internal["data"]["plan"].clone()).expect("ready plan");
        assert_eq!(
            ready.state,
            crate::execution_broker::ExecutionPlanStateWire::Ready
        );
        let executed = crate::commands::execute_ready_plan(plan_id.clone())
            .await
            .expect("Desktop execute command");
        assert_eq!(executed["execution"]["success"], true);
        assert_eq!(executed["execution"]["exit_code"], 0);
        let receipt = broker
            .receipts_for_plan(&plan_id)
            .expect("receipt lookup")
            .into_iter()
            .next()
            .expect("one receipt");
        let (status, pending) = request(&client, reqwest::Method::POST, format!("{base}/mcp"), Some(&agent_token), Some(json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"agent_outcome","arguments":{"plan_id":plan_id}}}))).await;
        assert_eq!(status, 200);
        let pending_payload = mcp_tool_payload(&pending);
        assert_eq!(pending_payload["status"], "PENDING");

        crate::commands::enable_cli_verification()
            .await
            .expect("enable Desktop verification");
        let completed = crate::commands::verify_pending_plan(plan_id.clone())
            .await
            .expect("Desktop verify command");
        assert_eq!(completed["data"]["status"], "VERIFIED");
        let verified_receipt = broker
            .receipts_for_plan(&plan_id)
            .expect("verified receipt lookup")
            .into_iter()
            .next()
            .expect("verified receipt");
        assert_eq!(
            verified_receipt.verification_attempts.len(),
            1,
            "one native readback attempt"
        );
        let (status, final_outcome) = request(&client, reqwest::Method::POST, format!("{base}/mcp"), Some(&agent_token), Some(json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"agent_outcome","arguments":{"plan_id":plan_id}}}))).await;
        assert_eq!(status, 200);
        let final_payload = mcp_tool_payload(&final_outcome);
        assert_eq!(final_payload["status"], "VERIFIED");
        let duplicate = broker
            .execute(&ready, "github-cli.issue.close")
            .expect_err("duplicate execution must be blocked");
        // A required-approval replay is rejected at the consumed-grant gate
        // before the ledger replay gate.  Either native error is fail-closed;
        // the durable reserved phase proves this plan can never spawn again.
        assert!(matches!(
            duplicate.code,
            crate::execution_broker::ErrorCode::ApprovalConsumed
                | crate::execution_broker::ErrorCode::PlanRejectedSingleUse
        ));
        assert_eq!(
            broker.plan_ledger().phase(&plan_id),
            Some(crate::execution_broker::approval::ledger::LedgerPhase::Reserved)
        );

        let proof = json!({
            "status":"PASS","verification_level":"CONTROLLED_LOCAL",
            "agent_runtime":"protocol-real-mcp-client-harness","agent_identity_scope":["agent:ask","agent:inspect","agent:history","agent:outcome:read"],
            "decision_id":decision_id,"plan_id":plan_id,"evidence_status":asked["evidence_status"],"human_approval":true,
            "execution_trigger_source":"desktop_controlled_native_path","adapter":"github-cli","receipt":{"receipt_id":receipt.receipt_id,"source":"native_broker","execution_state":format!("{:?}",receipt.execution_state),"exit_code":receipt.exit_code},
            "readback":{"attempts":verified_receipt.verification_attempts.len(),"state":"CLOSED"},"outcome":"VERIFIED","revisit_required":false,
            "authority_invariants":{"agent_approval_authority":"NONE","agent_execution_authority":"NONE","agent_outcome_authority":"NONE","approve_executions":0,"desktop_explicit_execution":1,"process_success_direct_verified":false},
            "negative_authority_attempts":{"approve":"BLOCKED","verify":"BLOCKED","execute":"BLOCKED","control_session":"BLOCKED","native_plan_lookup":"BLOCKED","arbitrary_mcp_write":"BLOCKED"},
            "write_counts":{"github.issue.close":1},"duplicate_execution":"BLOCKED","notes":["CODEX_RUNTIME_E2E_NOT_EXECUTED","CODEX_RUNTIME_DETECTED_AUTH_REQUIRED","CONTROLLED_LOCAL_EXTERNAL_STATE_RESOLVER"]
        });
        let proof_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../docs/goal26/pilot/first-agent-control-loop-proof.json");
        std::fs::write(
            &proof_path,
            format!("{}\n", serde_json::to_string_pretty(&proof).unwrap()),
        )
        .expect("write Goal26 proof");
        crate::brain_server::stop().expect("stop Brain");
        println!(
            "GOAL26_CONTROLLED_LOCAL_LOOP_PASS plan={plan_id} receipt={} outcome=VERIFIED",
            receipt.receipt_id
        );
    }
}
