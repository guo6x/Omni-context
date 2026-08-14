//! Goal24 Checkpoint 3 — broker security and lifecycle tests.
//!
//! Real process lifecycle is exercised by spawning the test binary itself as
//! the child (`std::env::current_exe()` + a test-only child protocol selected
//! through the binding's env allowlist). No `cmd.exe`, `powershell.exe`,
//! `sh` or `bash` fixtures are used. Test-only code lives entirely under
//! `#[cfg(test)]` and can never become a production binding.
//!
//! All tests that spawn a child share a lock because the child protocol is
//! selected through a process-global env var.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::execution_broker::policy::{ExecutionRiskPolicy, OutputLimits};
use crate::execution_broker::types::{
    ApprovalReferenceWire, AuthorityLevelWire, ErrorCode, EvidenceCoverageSnapshotWire,
    RiskLevelWire, RiskSnapshotWire, SideEffectClassWire,
};
use crate::execution_broker::{
    Broker, ExecutionBinding, ExecutionPlanStateWire, ExecutionPlanWire,
};

/// Serializes every test that spawns a broker child (shared env-var protocol).
static CHILD_TEST_LOCK: Mutex<()> = Mutex::new(());

/// Acquire the child-test lock, recovering from a panic so one failed test
/// cannot cascade `PoisonError` into every other spawn test.
pub(crate) fn child_test_lock() -> std::sync::MutexGuard<'static, ()> {
    CHILD_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

// ---------------------------------------------------------------------------
// Test-only binding
// ---------------------------------------------------------------------------

/// Test-only trusted binding: runs the current test executable through the
/// broker with a `#[cfg(test)]` child protocol. `#[cfg(test)]` only — never
/// registered in production code.
pub struct TestSelfBinding {
    exe: PathBuf,
    cwd_root: PathBuf,
    env_allowlist: Vec<String>,
    output_limits: OutputLimits,
}

pub const TEST_CHILD_TEST_NAME: &str = "execution_broker::tests::child_protocol_entry";

impl TestSelfBinding {
    pub fn new(cwd_root: PathBuf) -> Self {
        Self {
            exe: std::env::current_exe().expect("current_exe"),
            cwd_root,
            env_allowlist: vec![
                "OMNI_BROKER_TEST_MODE".to_string(),
                "OMNI_BROKER_TEST_EXIT_CODE".to_string(),
                "OMNI_BROKER_TEST_SLEEP_MS".to_string(),
                "OMNI_BROKER_TEST_STDOUT_BYTES".to_string(),
                "OMNI_BROKER_TEST_GRANDCHILD_PID_FILE".to_string(),
                "OMNI_BROKER_TEST_ALLOWED".to_string(),
                "OMNI_BROKER_TEST_MARKER_FILE".to_string(),
            ],
            output_limits: OutputLimits::default(),
        }
    }

    pub fn with_candidate(mut self, exe: PathBuf) -> Self {
        self.exe = exe;
        self
    }
}

impl ExecutionBinding for TestSelfBinding {
    fn binding_id(&self) -> &str {
        "test.self.run"
    }

    fn adapter_id(&self) -> &str {
        "test-adapter"
    }

    fn capability_id(&self) -> &str {
        "test.self.run"
    }

    fn executable_candidates(&self) -> &[PathBuf] {
        std::slice::from_ref(&self.exe)
    }

    fn build_argv(
        &self,
        inputs: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<Vec<OsString>, String> {
        let mut argv = vec![
            OsString::from("--exact"),
            OsString::from(TEST_CHILD_TEST_NAME),
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

    fn allowed_cwd_roots(&self) -> &[PathBuf] {
        std::slice::from_ref(&self.cwd_root)
    }

    fn derive_cwd(
        &self,
        inputs: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<PathBuf, String> {
        match inputs.get("cwd").and_then(|v| v.as_str()) {
            Some(cwd) => Ok(PathBuf::from(cwd)),
            None => Ok(self.cwd_root.clone()),
        }
    }

    fn env_allowlist(&self) -> &[String] {
        &self.env_allowlist
    }

    fn output_limits(&self) -> OutputLimits {
        self.output_limits
    }

    fn capability_version(&self) -> &str {
        "1.0.0"
    }

    fn risk_policy(&self) -> ExecutionRiskPolicy {
        ExecutionRiskPolicy::read_only_low_l0()
    }
}

// ---------------------------------------------------------------------------
// Test-only child protocol (runs inside the spawned test binary)
// ---------------------------------------------------------------------------

/// Child entry: `--exact <TEST_CHILD_TEST_NAME> --ignored --nocapture`.
/// Behavior is selected through `OMNI_BROKER_TEST_MODE` (broker env allowlist).
#[test]
#[ignore]
fn child_protocol_entry() {
    let mode = std::env::var("OMNI_BROKER_TEST_MODE").unwrap_or_default();
    match mode.as_str() {
        "echo" => {
            // argv after: exe, --exact, <name>, --ignored, --nocapture
            let args: Vec<String> = std::env::args().skip(5).collect();
            println!("OMNI_CHILD_BEGIN");
            for arg in &args {
                println!("ARG={arg:?}");
            }
            println!("OMNI_CHILD_END");
        }
        "stderr" => {
            eprintln!("OMNI_CHILD_STDERR_LINE");
        }
        "exit-code" => {
            let code: i32 = std::env::var("OMNI_BROKER_TEST_EXIT_CODE")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            std::process::exit(code);
        }
        "sleep" => {
            println!("OMNI_CHILD_BEGIN");
            let ms: u64 = std::env::var("OMNI_BROKER_TEST_SLEEP_MS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(60_000);
            std::thread::sleep(Duration::from_millis(ms));
            println!("OMNI_CHILD_END");
        }
        "large-output" => {
            let bytes: usize = std::env::var("OMNI_BROKER_TEST_STDOUT_BYTES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(2 * 1024 * 1024);
            let chunk = vec![b'x'; 64 * 1024];
            let mut stdout = std::io::stdout();
            let mut stderr = std::io::stderr();
            use std::io::Write;
            let mut remaining = bytes;
            while remaining > 0 {
                let n = remaining.min(chunk.len());
                let _ = stdout.write_all(&chunk[..n]);
                let _ = stderr.write_all(&chunk[..n]);
                remaining -= n;
            }
            let _ = stdout.flush();
            let _ = stderr.flush();
        }
        "print-env" => {
            for name in [
                "OMNI_BROKER_TEST_ALLOWED",
                "GH_TOKEN",
                "GITHUB_TOKEN",
                "OPENAI_API_KEY",
                "AWS_SECRET_ACCESS_KEY",
                "SystemRoot",
            ] {
                let present = std::env::var_os(name).is_some();
                println!("ENV:{name}={present}");
            }
        }
        "print-cwd" => {
            println!("CWD={:?}", std::env::current_dir().unwrap_or_default());
        }
        "spawn-grandchild" => {
            let pid_file = std::env::var("OMNI_BROKER_TEST_GRANDCHILD_PID_FILE")
                .expect("grandchild pid file env missing");
            let mut cmd = std::process::Command::new(std::env::current_exe().expect("current_exe"));
            cmd.args(["--exact", TEST_CHILD_TEST_NAME, "--ignored", "--nocapture"])
                .env("OMNI_BROKER_TEST_MODE", "grandchild")
                .env("OMNI_BROKER_TEST_GRANDCHILD_PID_FILE", &pid_file)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            let grandchild = cmd.spawn().expect("spawn grandchild");
            let _ = grandchild;
            // Keep the child (and therefore the job) alive until terminated.
            std::thread::sleep(Duration::from_secs(300));
        }
        "print-token" => {
            println!("auth token: ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCD");
        }
        "secret-output" => {
            println!("credential ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd");
        }
        "bearer-output" => {
            println!("Authorization: Bearer ghp_bearertokenvalue12345678901234567890");
        }
        "credential-url-output" => {
            println!("https://user:pass123@example.com/repo");
        }
        "control-chars-output" => {
            println!("normal\u{1b}[31mRED\u{1b}[0m tail\u{07}");
        }
        "write-marker" => {
            let marker = std::env::var("OMNI_BROKER_TEST_MARKER_FILE").unwrap_or_default();
            if !marker.is_empty() {
                let _ = std::fs::write(marker, "ran");
            }
            std::process::exit(0);
        }
        "spawn-grandchild-exit-first" => {
            let pid_file = std::env::var("OMNI_BROKER_TEST_GRANDCHILD_PID_FILE")
                .expect("grandchild pid file env missing");
            let mut cmd = std::process::Command::new(std::env::current_exe().expect("current_exe"));
            cmd.args(["--exact", TEST_CHILD_TEST_NAME, "--ignored", "--nocapture"])
                .env("OMNI_BROKER_TEST_MODE", "grandchild")
                .env("OMNI_BROKER_TEST_GRANDCHILD_PID_FILE", &pid_file)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            let _ = cmd.spawn().expect("spawn grandchild");
            std::process::exit(0);
        }
        "breakaway-attempt" => {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let pid_file = std::env::var("OMNI_BROKER_TEST_GRANDCHILD_PID_FILE")
                    .expect("grandchild pid file env missing");
                const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
                let mut cmd =
                    std::process::Command::new(std::env::current_exe().expect("current_exe"));
                cmd.args(["--exact", TEST_CHILD_TEST_NAME, "--ignored", "--nocapture"])
                    .env("OMNI_BROKER_TEST_MODE", "grandchild")
                    .env("OMNI_BROKER_TEST_GRANDCHILD_PID_FILE", &pid_file)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .creation_flags(CREATE_BREAKAWAY_FROM_JOB);
                match cmd.spawn() {
                    Ok(_child) => println!("BREAKAWAY_UNEXPECTEDLY_ALLOWED"),
                    Err(e) => println!("BREAKAWAY_BLOCKED:{e}"),
                }
            }
            #[cfg(not(windows))]
            {
                println!("BREAKAWAY_NOT_APPLICABLE");
            }
        }
        "job-holder" => {
            #[cfg(windows)]
            {
                use std::os::windows::io::AsRawHandle;
                use windows::Win32::Foundation::HANDLE;
                use windows::Win32::System::JobObjects::{
                    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                };
                let job = unsafe { CreateJobObjectW(None, None) }.expect("create job");
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                unsafe {
                    SetInformationJobObject(
                        job,
                        JobObjectExtendedLimitInformation,
                        &info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION
                            as *const core::ffi::c_void,
                        std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                    )
                }
                .expect("set job info");
                let pid_file = std::env::var("OMNI_BROKER_TEST_GRANDCHILD_PID_FILE")
                    .expect("grandchild pid file env missing");
                let mut cmd =
                    std::process::Command::new(std::env::current_exe().expect("current_exe"));
                cmd.args(["--exact", TEST_CHILD_TEST_NAME, "--ignored", "--nocapture"])
                    .env("OMNI_BROKER_TEST_MODE", "grandchild")
                    .env("OMNI_BROKER_TEST_GRANDCHILD_PID_FILE", &pid_file)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());
                let child = cmd.spawn().expect("spawn grandchild");
                unsafe {
                    AssignProcessToJobObject(job, HANDLE(child.as_raw_handle() as isize))
                        .expect("assign to job");
                }
                // Wait until the grandchild records its pid, then exit. The
                // process exit closes the job handle and KILL_ON_JOB_CLOSE
                // must terminate the grandchild.
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
                while std::time::Instant::now() < deadline {
                    if std::path::Path::new(&pid_file).exists() {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
                std::process::exit(0);
            }
            #[cfg(not(windows))]
            {
                std::process::exit(0);
            }
        }
        "exit-immediately" => {
            std::thread::sleep(Duration::from_millis(150));
            std::process::exit(0);
        }
        "grandchild" => {
            let pid_file = std::env::var("OMNI_BROKER_TEST_GRANDCHILD_PID_FILE")
                .expect("grandchild pid file env missing");
            std::fs::write(&pid_file, std::process::id().to_string()).expect("write pid file");
            std::thread::sleep(Duration::from_secs(300));
        }
        _ => {
            println!("OMNI_CHILD_UNKNOWN_MODE");
        }
    }
}

// ---------------------------------------------------------------------------
// Plan construction helpers
// ---------------------------------------------------------------------------

pub(crate) fn plan(state: ExecutionPlanStateWire) -> ExecutionPlanWire {
    plan_with(state, |_| {})
}

pub(crate) fn plan_with(
    state: ExecutionPlanStateWire,
    mutate: impl FnOnce(&mut ExecutionPlanWire),
) -> ExecutionPlanWire {
    let mut plan = ExecutionPlanWire {
        plan_id: "plan-00000001".to_string(),
        decision_id: "decision-1".to_string(),
        capability_id: "test.self.run".to_string(),
        capability_version: "1.0.0".to_string(),
        adapter_id: "test-adapter".to_string(),
        normalized_inputs: serde_json::json!({"mode": "echo"})
            .as_object()
            .unwrap()
            .clone(),
        required_approval: false,
        approval: None,
        risk_snapshot: RiskSnapshotWire {
            risk_level: RiskLevelWire::Low,
            reversible: false,
            side_effect_class: SideEffectClassWire::ReadOnly,
            required_authority: AuthorityLevelWire::L0,
            capability_version: "1.0.0".to_string(),
        },
        evidence_coverage_snapshot: EvidenceCoverageSnapshotWire { entries: vec![] },
        timeout_ms: 10_000,
        verification_plan: None,
        rollback_plan: None,
        state,
        created_at: chrono::Utc::now().to_rfc3339(),
        expires_at: None,
        correlation_id: None,
        requested_by: Some("unit-test".to_string()),
    };
    mutate(&mut plan);
    plan
}

pub(crate) fn set_inputs(plan: &mut ExecutionPlanWire, value: serde_json::Value) {
    plan.normalized_inputs = value.as_object().expect("inputs must be an object").clone();
}

/// Build a broker with the test binding rooted at `root`.
pub(crate) fn broker_with_root(root: &Path) -> Broker {
    let broker = Broker::new();
    broker.register_binding(Box::new(TestSelfBinding::new(root.to_path_buf())));
    broker
}

/// Temp dir helper that also cleans up on drop.
pub(crate) struct TempDir(PathBuf);

impl TempDir {
    pub(crate) fn new(tag: &str) -> Self {
        let base = std::env::temp_dir().join(format!(
            "omni-cp3-broker-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&base).expect("create temp dir");
        Self(base)
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(crate) fn wait_until(deadline: Instant, mut check: impl FnMut() -> bool) -> bool {
    while Instant::now() < deadline {
        if check() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

fn extract_echoed_args(stdout: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut capturing = false;
    for line in stdout.lines() {
        if line == "OMNI_CHILD_BEGIN" {
            capturing = true;
            continue;
        }
        if line == "OMNI_CHILD_END" {
            break;
        }
        if capturing && line.starts_with("ARG=") {
            let inner = line.trim_start_matches("ARG=");
            args.push(parse_debug_string(inner));
        }
    }
    args
}

/// Minimal parser for the `{:?}`-formatted strings the child echoes, covering
/// the controlled payloads used in these tests (quotes, backslashes, \n, \t,
/// \r, \u{...}).
fn parse_debug_string(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    if chars.peek() == Some(&'"') {
        chars.next();
    }
    while let Some(c) = chars.next() {
        if c == '"' {
            break;
        }
        if c == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('\\') => out.push('\\'),
                Some('"') => out.push('"'),
                Some('0') => out.push('\0'),
                Some('u') => {
                    let mut hex = String::new();
                    if chars.next() == Some('{') {
                        for h in chars.by_ref() {
                            if h == '}' {
                                break;
                            }
                            hex.push(h);
                        }
                    }
                    if let Ok(cp) = u32::from_str_radix(&hex, 16) {
                        if let Some(ch) = char::from_u32(cp) {
                            out.push(ch);
                        }
                    }
                }
                other => {
                    if let Some(o) = other {
                        out.push(o);
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

#[cfg(windows)]
pub(super) fn process_running(pid: u32) -> bool {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    const STILL_ACTIVE: u32 = 259;
    let Ok(handle) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }) else {
        return false;
    };
    let mut code: u32 = 0;
    let ok = unsafe { GetExitCodeProcess(handle, &mut code) }.is_ok();
    unsafe { CloseHandle(handle) }.ok();
    ok && code == STILL_ACTIVE
}

// ---------------------------------------------------------------------------
// A. Plan gate
// ---------------------------------------------------------------------------

#[test]
fn gate_ready_accepted_and_executes() {
    let _guard = child_test_lock();
    std::env::set_var("OMNI_BROKER_TEST_MODE", "echo");
    let tmp = TempDir::new("gate");
    let broker = broker_with_root(tmp.path());
    let result = broker
        .execute(&plan(ExecutionPlanStateWire::Ready), "test.self.run")
        .expect("ready plan accepted");
    assert!(result.success, "echo child should succeed");
    assert!(result.stdout.contains("OMNI_CHILD_BEGIN"));
}

#[test]
fn gate_rejects_non_ready_states() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("gate");
    let broker = broker_with_root(tmp.path());
    for (state, code) in [
        (ExecutionPlanStateWire::Draft, ErrorCode::PlanRejectedState),
        (
            ExecutionPlanStateWire::AwaitingApproval,
            ErrorCode::PlanRejectedState,
        ),
        (
            ExecutionPlanStateWire::Executing,
            ErrorCode::PlanRejectedState,
        ),
        (
            ExecutionPlanStateWire::Succeeded,
            ErrorCode::PlanRejectedState,
        ),
        (ExecutionPlanStateWire::Failed, ErrorCode::PlanRejectedState),
        (
            ExecutionPlanStateWire::Blocked,
            ErrorCode::PlanRejectedState,
        ),
        (
            ExecutionPlanStateWire::Cancelled,
            ErrorCode::PlanRejectedState,
        ),
    ] {
        let err = broker
            .execute(&plan(state), "test.self.run")
            .expect_err("non-ready states must be rejected");
        assert_eq!(err.code, code, "state {state:?}");
    }
}

#[test]
fn gate_executing_is_replay_guard() {
    let tmp = TempDir::new("gate");
    let broker = broker_with_root(tmp.path());
    let err = broker
        .execute(&plan(ExecutionPlanStateWire::Executing), "test.self.run")
        .expect_err("executing must be rejected as replay");
    assert_eq!(err.code, ErrorCode::PlanRejectedState);
    assert!(err.message.contains("replay"), "message: {}", err.message);
}

#[test]
fn gate_expired_plan_rejected() {
    let tmp = TempDir::new("gate");
    let broker = broker_with_root(tmp.path());
    let past = (chrono::Utc::now() - chrono::Duration::hours(1)).to_rfc3339();
    let err = broker
        .execute(
            &plan_with(ExecutionPlanStateWire::Ready, |p| p.expires_at = Some(past)),
            "test.self.run",
        )
        .expect_err("expired plan must be rejected");
    assert_eq!(err.code, ErrorCode::PlanRejectedExpired);
}

#[test]
fn gate_required_approval_with_fake_reference_rejected() {
    let tmp = TempDir::new("gate");
    let broker = broker_with_root(tmp.path());
    let err = broker
        .execute(
            &plan_with(ExecutionPlanStateWire::Ready, |p| {
                p.required_approval = true;
                p.approval = Some(ApprovalReferenceWire {
                    approval_id: "approval-1".to_string(),
                    plan_id: p.plan_id.clone(),
                    granted_by: "user".to_string(),
                    granted_at: chrono::Utc::now().to_rfc3339(),
                    policy_version: "1.0.0".to_string(),
                    token_reference: "ref-1".to_string(),
                    token_digest: "digest-1".to_string(),
                });
            }),
            "test.self.run",
        )
        .expect_err("a fabricated approval reference must never validate");
    assert_eq!(err.code, ErrorCode::ApprovalRecordNotFound);
}

#[test]
fn gate_unknown_binding_rejected() {
    let tmp = TempDir::new("gate");
    let broker = broker_with_root(tmp.path());
    let err = broker
        .execute(&plan(ExecutionPlanStateWire::Ready), "no.such.binding")
        .expect_err("unknown binding must be rejected");
    assert_eq!(err.code, ErrorCode::UnknownBinding);
}

#[test]
fn gate_binding_mismatches_rejected() {
    let tmp = TempDir::new("gate");
    let broker = broker_with_root(tmp.path());
    let adapter_err = broker
        .execute(
            &plan_with(ExecutionPlanStateWire::Ready, |p| {
                p.adapter_id = "other-adapter".to_string()
            }),
            "test.self.run",
        )
        .expect_err("adapter mismatch must be rejected");
    assert_eq!(adapter_err.code, ErrorCode::PlanRejectedAdapter);

    let capability_err = broker
        .execute(
            &plan_with(ExecutionPlanStateWire::Ready, |p| {
                p.capability_id = "other.cap.run".to_string()
            }),
            "test.self.run",
        )
        .expect_err("capability mismatch must be rejected");
    assert_eq!(capability_err.code, ErrorCode::PlanRejectedCapability);
}

#[test]
fn gate_forbidden_input_keys_rejected() {
    let tmp = TempDir::new("gate");
    let broker = broker_with_root(tmp.path());
    for key in [
        "shell",
        "command",
        "exec",
        "bash",
        "powershell",
        "cmd",
        "cmdline",
        "script",
    ] {
        let err = broker
            .execute(
                &plan_with(ExecutionPlanStateWire::Ready, |p| {
                    set_inputs(p, serde_json::json!({ "mode": "echo", key: "anything" }));
                }),
                "test.self.run",
            )
            .expect_err("forbidden input key must be rejected");
        assert_eq!(err.code, ErrorCode::PlanRejectedInvalid, "key {key}");
    }
}

#[test]
fn gate_invalid_plan_identity_rejected() {
    let tmp = TempDir::new("gate");
    let broker = broker_with_root(tmp.path());

    let bad_id = broker
        .execute(
            &plan_with(ExecutionPlanStateWire::Ready, |p| {
                p.plan_id = "short".to_string()
            }),
            "test.self.run",
        )
        .expect_err("invalid plan_id must be rejected");
    assert_eq!(bad_id.code, ErrorCode::PlanRejectedInvalid);

    let bad_cap = broker
        .execute(
            &plan_with(ExecutionPlanStateWire::Ready, |p| {
                p.capability_id = "cli.github.issue.create".to_string()
            }),
            "test.self.run",
        )
        .expect_err("reserved capability prefix must be rejected");
    assert_eq!(bad_cap.code, ErrorCode::PlanRejectedInvalid);

    let bad_adapter = broker
        .execute(
            &plan_with(ExecutionPlanStateWire::Ready, |p| {
                p.adapter_id = "UPPER".to_string()
            }),
            "test.self.run",
        )
        .expect_err("invalid adapter_id must be rejected");
    assert_eq!(bad_adapter.code, ErrorCode::PlanRejectedInvalid);
}

#[test]
fn gate_timeout_bounds_enforced() {
    let tmp = TempDir::new("gate");
    let broker = broker_with_root(tmp.path());
    for bad in [0u64, 99, 86_400_001] {
        let err = broker
            .execute(
                &plan_with(ExecutionPlanStateWire::Ready, |p| p.timeout_ms = bad),
                "test.self.run",
            )
            .expect_err("out-of-bounds timeout must be rejected");
        assert_eq!(err.code, ErrorCode::PlanRejectedInvalid);
    }
}

#[test]
fn gate_serialization_rejects_unknown_fields() {
    // deny_unknown_fields must reject a plan carrying a shell/exec field.
    let json = r#"{
        "plan_id": "plan-00000001",
        "decision_id": "decision-1",
        "capability_id": "test.self.run",
        "capability_version": "1.0.0",
        "adapter_id": "test-adapter",
        "normalized_inputs": { "mode": "echo" },
        "required_approval": false,
        "approval": null,
        "risk_snapshot": {
            "risk_level": "low",
            "reversible": false,
            "side_effect_class": "read_only",
            "required_authority": "L0",
            "capability_version": "1.0.0"
        },
        "evidence_coverage_snapshot": { "entries": [] },
        "timeout_ms": 10000,
        "verification_plan": null,
        "rollback_plan": null,
        "state": "ready",
        "created_at": "2026-08-13T00:00:00+08:00",
        "expires_at": null,
        "correlation_id": null,
        "requested_by": "unit-test",
        "shell": "cmd /C evil"
    }"#;
    let result: Result<ExecutionPlanWire, _> = serde_json::from_str(json);
    assert!(result.is_err(), "unknown top-level field must be rejected");
}

// ---------------------------------------------------------------------------
// B. Executable resolution
// ---------------------------------------------------------------------------

#[test]
fn executable_arbitrary_input_impossible() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("exe");
    let broker = broker_with_root(tmp.path());
    // A plan tries to smuggle an executable path via inputs; the broker must
    // ignore it and use the trusted binding candidate.
    let mut p = plan(ExecutionPlanStateWire::Ready);
    set_inputs(
        &mut p,
        serde_json::json!({ "mode": "echo", "executable": "C:\\Windows\\System32\\notepad.exe" }),
    );
    let result = broker
        .execute(&p, "test.self.run")
        .expect("binding candidate used");
    assert!(result.success);
}

#[test]
fn executable_rejects_cmd_bat_ps1_and_missing() {
    let tmp = TempDir::new("exe");
    for (name, code) in [
        ("tool.cmd", ErrorCode::BrokerBlockedExtension),
        ("tool.bat", ErrorCode::BrokerBlockedExtension),
        ("tool.ps1", ErrorCode::BrokerBlockedExtension),
        ("tool.xyz", ErrorCode::BrokerBlockedExtension),
        ("missing.exe", ErrorCode::BrokerBlockedExecutable),
    ] {
        let candidate = tmp.path().join(name);
        if !name.starts_with("missing") {
            std::fs::write(&candidate, b"not a real exe").expect("write fixture");
        }
        let broker = Broker::new();
        broker.register_binding(Box::new(
            TestSelfBinding::new(tmp.path().to_path_buf()).with_candidate(candidate),
        ));
        let err = broker
            .execute(&plan(ExecutionPlanStateWire::Ready), "test.self.run")
            .expect_err("candidate must be rejected");
        assert_eq!(err.code, code, "candidate {name}");
    }
}

#[test]
fn executable_fingerprint_change_detected() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("exe");
    let copied = tmp.path().join("tool.exe");
    std::fs::copy(std::env::current_exe().expect("current_exe"), &copied).expect("copy test exe");

    let broker = Broker::new();
    broker.register_binding(Box::new(
        TestSelfBinding::new(tmp.path().to_path_buf()).with_candidate(copied.clone()),
    ));

    // First run: identity verified, child works.
    let result = broker
        .execute(&plan(ExecutionPlanStateWire::Ready), "test.self.run")
        .expect("first run ok");
    assert!(result.success);

    // Record the pre-tamper identity, then tamper: append one byte (the PE
    // loader ignores trailing data; size + mtime change).
    let (_, fingerprint_before) =
        crate::execution_broker::resolver::resolve_executable(std::slice::from_ref(&copied))
            .expect("resolve baseline");
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(&copied)
            .expect("open copied exe");
        f.write_all(b"X").expect("append byte");
    }

    // The broker re-verifies the recorded identity immediately before spawn;
    // a changed file must fail that pre-spawn check.
    assert!(
        !fingerprint_before.verify(),
        "tampered executable must fail the pre-spawn identity re-check"
    );
}

// ---------------------------------------------------------------------------
// C. argv safety
// ---------------------------------------------------------------------------

#[test]
fn argv_spaces_preserved() {
    let _guard = child_test_lock();
    std::env::set_var("OMNI_BROKER_TEST_MODE", "echo");
    let tmp = TempDir::new("argv");
    let broker = broker_with_root(tmp.path());
    let mut p = plan(ExecutionPlanStateWire::Ready);
    set_inputs(
        &mut p,
        serde_json::json!({ "mode": "echo", "args": ["hello world", "a  b", "  leading and trailing  "] }),
    );
    let result = broker.execute(&p, "test.self.run").expect("run");
    assert!(result.success);
    let echoed = extract_echoed_args(&result.stdout);
    assert_eq!(
        echoed,
        vec!["hello world", "a  b", "  leading and trailing  "],
        "argv elements must round-trip as single elements"
    );
}

#[test]
fn argv_shell_metacharacters_literal() {
    let _guard = child_test_lock();
    std::env::set_var("OMNI_BROKER_TEST_MODE", "echo");
    let tmp = TempDir::new("argv");
    let broker = broker_with_root(tmp.path());
    let mut p = plan(ExecutionPlanStateWire::Ready);
    set_inputs(
        &mut p,
        serde_json::json!({ "mode": "echo", "args": ["x&y|z>w<v^q", "$(touch pwned)", "`backtick`", "a;b&&c||d"] }),
    );
    let result = broker.execute(&p, "test.self.run").expect("run");
    assert!(result.success);
    let echoed = extract_echoed_args(&result.stdout);
    assert_eq!(
        echoed,
        vec!["x&y|z>w<v^q", "$(touch pwned)", "`backtick`", "a;b&&c||d"],
        "shell metacharacters must remain literal data"
    );
}

#[test]
fn argv_newline_literal() {
    let _guard = child_test_lock();
    std::env::set_var("OMNI_BROKER_TEST_MODE", "echo");
    let tmp = TempDir::new("argv");
    let broker = broker_with_root(tmp.path());
    let mut p = plan(ExecutionPlanStateWire::Ready);
    set_inputs(
        &mut p,
        serde_json::json!({ "mode": "echo", "args": ["line1\nline2", "tab\there"] }),
    );
    let result = broker.execute(&p, "test.self.run").expect("run");
    assert!(result.success);
    let echoed = extract_echoed_args(&result.stdout);
    assert_eq!(echoed, vec!["line1\nline2", "tab\there"]);
}

#[test]
fn argv_flag_like_value_stays_single_element() {
    let tmp = TempDir::new("argv");
    let binding = TestSelfBinding::new(tmp.path().to_path_buf());
    let inputs = serde_json::json!({ "mode": "echo", "args": ["--flag", "--flag=value"] })
        .as_object()
        .unwrap()
        .clone();
    let argv = binding.build_argv(&inputs).expect("build argv");
    // Prefix is exactly [--exact, name, --ignored, --nocapture]; the two
    // flag-like values must appear as exactly two extra elements and never be
    // split, dropped, or turned into broker-level flags.
    assert_eq!(argv.len(), 6, "no extra argv elements may be created");
    assert_eq!(argv[4], OsString::from("--flag"));
    assert_eq!(argv[5], OsString::from("--flag=value"));
}

#[test]
fn argv_nul_rejected() {
    let tmp = TempDir::new("argv");
    let broker = broker_with_root(tmp.path());
    let mut p = plan(ExecutionPlanStateWire::Ready);
    set_inputs(
        &mut p,
        serde_json::json!({ "mode": "echo", "args": ["bad\0arg"] }),
    );
    let err = broker
        .execute(&p, "test.self.run")
        .expect_err("NUL argv must be rejected");
    assert_eq!(err.code, ErrorCode::BrokerBlockedArgv);
}

// ---------------------------------------------------------------------------
// D. cwd policy
// ---------------------------------------------------------------------------

#[test]
fn cwd_allowed_root_works() {
    let _guard = child_test_lock();
    std::env::set_var("OMNI_BROKER_TEST_MODE", "print-cwd");
    let tmp = TempDir::new("cwd");
    let root = tmp.path().join("root");
    std::fs::create_dir_all(&root).expect("create root");
    let broker = broker_with_root(&root);
    let mut p = plan(ExecutionPlanStateWire::Ready);
    set_inputs(
        &mut p,
        serde_json::json!({ "mode": "print-cwd", "cwd": root.to_string_lossy() }),
    );
    let result = broker.execute(&p, "test.self.run").expect("run");
    assert!(result.success);
    let canonical = std::fs::canonicalize(&root).expect("canonical root");
    let canonical_str = canonical.to_string_lossy().into_owned();
    // Windows `canonicalize` returns a `\\?\`-prefixed extended path while the
    // child reports the plain normalized form; accept either representation.
    let plain_str = canonical_str
        .strip_prefix(r"\\?\")
        .unwrap_or(&canonical_str)
        .to_string();
    assert!(
        result.stdout.contains(&format!("CWD={plain_str:?}"))
            || result.stdout.contains(&format!("CWD={canonical_str:?}")),
        "child cwd must be the canonical allowed root, got: {}",
        result.stdout
    );
}

#[test]
fn cwd_dotdot_escape_rejected() {
    let tmp = TempDir::new("cwd");
    let root = tmp.path().join("root");
    std::fs::create_dir_all(&root).expect("create root");
    let outside = tmp.path().join("outside");
    std::fs::create_dir_all(&outside).expect("create outside");
    let broker = broker_with_root(&root);
    let mut p = plan(ExecutionPlanStateWire::Ready);
    set_inputs(
        &mut p,
        serde_json::json!({ "mode": "echo", "cwd": root.join("..").join("outside").to_string_lossy() }),
    );
    let err = broker
        .execute(&p, "test.self.run")
        .expect_err("cwd escape must be rejected");
    assert_eq!(err.code, ErrorCode::BrokerBlockedPath);
}

#[test]
fn cwd_symlink_escape_rejected_where_testable() {
    let tmp = TempDir::new("cwd");
    let root = tmp.path().join("root");
    std::fs::create_dir_all(&root).expect("create root");
    let outside = tmp.path().join("outside");
    std::fs::create_dir_all(&outside).expect("create outside");
    let link = root.join("link-to-outside");

    let Ok(()) = std::os::windows::fs::symlink_dir(&outside, &link) else {
        // Requires Developer Mode / privileges; skip when not testable.
        eprintln!("[skip] directory symlink creation not permitted on this host");
        return;
    };

    let broker = broker_with_root(&root);
    let mut p = plan(ExecutionPlanStateWire::Ready);
    set_inputs(
        &mut p,
        serde_json::json!({ "mode": "echo", "cwd": link.to_string_lossy() }),
    );
    let err = broker
        .execute(&p, "test.self.run")
        .expect_err("symlink escape must be rejected");
    assert_eq!(err.code, ErrorCode::BrokerBlockedPath);
}

// ---------------------------------------------------------------------------
// E. env policy
// ---------------------------------------------------------------------------

#[test]
fn env_secrets_not_inherited_and_allowlist_present() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("env");
    let broker = broker_with_root(tmp.path());

    // Poison the parent env with secrets + an allowlisted var.
    std::env::set_var("GH_TOKEN", "gh-secret");
    std::env::set_var("OPENAI_API_KEY", "sk-secret");
    std::env::set_var("AWS_SECRET_ACCESS_KEY", "aws-secret");
    std::env::set_var("OMNI_BROKER_TEST_ALLOWED", "allow-me");
    std::env::set_var("OMNI_BROKER_TEST_MODE", "print-env");

    let mut p = plan(ExecutionPlanStateWire::Ready);
    set_inputs(&mut p, serde_json::json!({ "mode": "print-env" }));
    let result = broker.execute(&p, "test.self.run").expect("run");
    assert!(result.success, "stdout: {}", result.stdout);

    assert!(
        result.stdout.contains("ENV:OMNI_BROKER_TEST_ALLOWED=true"),
        "allowlisted env must be present: {}",
        result.stdout
    );
    assert!(
        result.stdout.contains("ENV:GH_TOKEN=false"),
        "GH_TOKEN must not be inherited"
    );
    assert!(
        result.stdout.contains("ENV:GITHUB_TOKEN=false"),
        "GITHUB_TOKEN must not be inherited"
    );
    assert!(
        result.stdout.contains("ENV:OPENAI_API_KEY=false"),
        "OPENAI_API_KEY must not be inherited"
    );
    assert!(
        result.stdout.contains("ENV:AWS_SECRET_ACCESS_KEY=false"),
        "AWS_* must not be inherited"
    );
    assert!(
        result.stdout.contains("ENV:SystemRoot=true"),
        "SystemRoot base var should be present"
    );
}

// ---------------------------------------------------------------------------
// F. lifecycle
// ---------------------------------------------------------------------------

#[test]
fn lifecycle_success_and_nonzero_exit() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("life");
    let broker = broker_with_root(tmp.path());

    std::env::set_var("OMNI_BROKER_TEST_MODE", "exit-code");
    std::env::set_var("OMNI_BROKER_TEST_EXIT_CODE", "0");
    let ok = broker
        .execute(&plan(ExecutionPlanStateWire::Ready), "test.self.run")
        .expect("run");
    assert!(ok.success);
    assert_eq!(ok.exit_code, Some(0));

    std::env::set_var("OMNI_BROKER_TEST_EXIT_CODE", "7");
    let mut failed_plan = plan(ExecutionPlanStateWire::Ready);
    failed_plan.plan_id = "plan-00000002".to_string();
    let failed = broker.execute(&failed_plan, "test.self.run").expect("run");
    assert!(!failed.success);
    assert_eq!(failed.exit_code, Some(7));
    assert!(!failed.timed_out && !failed.cancelled);
}

#[test]
fn lifecycle_stdout_and_stderr_captured() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("life");
    let broker = broker_with_root(tmp.path());

    std::env::set_var("OMNI_BROKER_TEST_MODE", "stderr");
    let result = broker
        .execute(&plan(ExecutionPlanStateWire::Ready), "test.self.run")
        .expect("run");
    assert!(result.success);
    assert!(
        result.stderr.contains("OMNI_CHILD_STDERR_LINE"),
        "stderr: {}",
        result.stderr
    );
}

#[test]
fn lifecycle_timeout_terminates() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("life");
    let broker = broker_with_root(tmp.path());

    std::env::set_var("OMNI_BROKER_TEST_MODE", "sleep");
    std::env::set_var("OMNI_BROKER_TEST_SLEEP_MS", "60000");
    let mut p = plan(ExecutionPlanStateWire::Ready);
    p.timeout_ms = 300;
    let started = Instant::now();
    let result = broker
        .execute(&p, "test.self.run")
        .expect("run returns result");
    let elapsed = started.elapsed();
    assert!(result.timed_out, "must be marked timed out");
    assert!(!result.success);
    assert!(
        elapsed < Duration::from_secs(30),
        "timeout must fire promptly, took {elapsed:?}"
    );
}

#[test]
fn lifecycle_large_output_truncated_no_deadlock() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("life");
    let broker = broker_with_root(tmp.path());

    std::env::set_var("OMNI_BROKER_TEST_MODE", "large-output");
    std::env::set_var("OMNI_BROKER_TEST_STDOUT_BYTES", "2000000");
    let mut p = plan(ExecutionPlanStateWire::Ready);
    p.timeout_ms = 30_000;
    let started = Instant::now();
    let result = broker
        .execute(&p, "test.self.run")
        .expect("run returns result");
    assert!(result.success, "child should exit 0 after writing output");
    assert!(
        started.elapsed() < Duration::from_secs(30),
        "no deadlock expected"
    );

    assert!(result.stdout_truncated, "stdout must be truncated");
    assert!(result.stderr_truncated, "stderr must be truncated");
    assert!(
        result.stdout_bytes_seen >= 2_000_000,
        "stdout bytes seen: {}",
        result.stdout_bytes_seen
    );
    assert!(
        result.stdout.len() <= 1024 * 1024,
        "bounded stdout: {}",
        result.stdout.len()
    );
    assert!(
        result.stderr.len() <= 1024 * 1024,
        "bounded stderr: {}",
        result.stderr.len()
    );
}

#[test]
fn lifecycle_cancel_by_execution_id() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("life");
    let broker = Arc::new(broker_with_root(tmp.path()));
    std::env::set_var("OMNI_BROKER_TEST_MODE", "sleep");
    std::env::set_var("OMNI_BROKER_TEST_SLEEP_MS", "120000");
    let mut p = plan(ExecutionPlanStateWire::Ready);
    p.timeout_ms = 120_000;

    let broker2 = broker.clone();
    let handle = std::thread::spawn(move || broker2.execute(&p, "test.self.run"));

    // Wait for the broker registry to contain the execution.
    let deadline = Instant::now() + Duration::from_secs(15);
    assert!(
        wait_until(deadline, || !broker.active_executions().is_empty()),
        "execution never became active"
    );
    let execution_id = broker.active_executions()[0].clone();
    broker
        .cancel_execution(&execution_id)
        .expect("cancel known execution");

    let result = handle.join().expect("execution thread").expect("result");
    assert!(result.cancelled, "must be marked cancelled");
    assert!(!result.success);
    assert!(
        broker.active_executions().is_empty(),
        "registry must be cleaned up"
    );
}

// ---------------------------------------------------------------------------
// G. process tree (Windows)
// ---------------------------------------------------------------------------

#[test]
#[cfg(windows)]
fn process_tree_grandchild_killed_on_cancel() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("tree");
    let pid_file = tmp.path().join("grandchild.pid");
    let broker = Arc::new(broker_with_root(tmp.path()));

    std::env::set_var("OMNI_BROKER_TEST_MODE", "spawn-grandchild");
    std::env::set_var(
        "OMNI_BROKER_TEST_GRANDCHILD_PID_FILE",
        pid_file.to_string_lossy().to_string(),
    );
    let mut p = plan(ExecutionPlanStateWire::Ready);
    p.timeout_ms = 120_000;

    let broker2 = broker.clone();
    let handle = std::thread::spawn(move || broker2.execute(&p, "test.self.run"));

    // Wait for the grandchild PID file.
    let deadline = Instant::now() + Duration::from_secs(20);
    let grandchild_pid: u32 = wait_until(deadline, || {
        std::fs::read_to_string(&pid_file)
            .ok()
            .and_then(|s| s.trim().parse::<u32>().ok())
            .is_some()
    })
    .then(|| {
        std::fs::read_to_string(&pid_file)
            .unwrap()
            .trim()
            .parse()
            .unwrap()
    })
    .expect("grandchild pid file never appeared");

    assert!(
        wait_until(Instant::now() + Duration::from_secs(15), || !broker
            .active_executions()
            .is_empty()),
        "execution never became active"
    );
    let execution_id = broker.active_executions()[0].clone();
    broker.cancel_execution(&execution_id).expect("cancel");

    let result = handle.join().expect("execution thread").expect("result");
    assert!(result.cancelled);

    // The grandchild must be gone shortly after the job is terminated.
    assert!(
        wait_until(Instant::now() + Duration::from_secs(15), || {
            !process_running(grandchild_pid)
        }),
        "grandchild {grandchild_pid} survived broker cancellation"
    );
}

#[test]
#[cfg(windows)]
fn process_tree_grandchild_killed_on_timeout() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("tree");
    let pid_file = tmp.path().join("grandchild.pid");
    let broker2 = Broker::new();
    broker2.register_binding(Box::new(TestSelfBinding::new(tmp.path().to_path_buf())));

    std::env::set_var("OMNI_BROKER_TEST_MODE", "spawn-grandchild");
    std::env::set_var(
        "OMNI_BROKER_TEST_GRANDCHILD_PID_FILE",
        pid_file.to_string_lossy().to_string(),
    );
    let mut p = plan(ExecutionPlanStateWire::Ready);
    p.timeout_ms = 2_000;

    let handle = std::thread::spawn(move || broker2.execute(&p, "test.self.run"));

    let deadline = Instant::now() + Duration::from_secs(20);
    let grandchild_pid: u32 = wait_until(deadline, || {
        std::fs::read_to_string(&pid_file)
            .ok()
            .and_then(|s| s.trim().parse::<u32>().ok())
            .is_some()
    })
    .then(|| {
        std::fs::read_to_string(&pid_file)
            .unwrap()
            .trim()
            .parse()
            .unwrap()
    })
    .expect("grandchild pid file never appeared");

    let result = handle.join().expect("execution thread").expect("result");
    assert!(result.timed_out);

    assert!(
        wait_until(Instant::now() + Duration::from_secs(15), || {
            !process_running(grandchild_pid)
        }),
        "grandchild {grandchild_pid} survived broker timeout"
    );
}

// ---------------------------------------------------------------------------
// Registry / status
// ---------------------------------------------------------------------------

#[test]
fn status_surface_is_read_only() {
    let broker = Broker::new();
    let status = broker.status();
    assert_eq!(
        status.broker_version,
        crate::execution_broker::BROKER_VERSION
    );
    assert!(
        !status.execute_ipc_enabled,
        "CP3 must not expose execute IPC"
    );
    assert!(
        status.approvals_enforced,
        "CP7 enforces approvals whenever the in-memory store and ledger are healthy"
    );
    assert!(status.registered_bindings.is_empty());
    assert_eq!(status.active_executions, 0);
    assert_eq!(status.output_limits.stdout_max_bytes, 1024 * 1024);
    assert_eq!(status.output_limits.stderr_max_bytes, 1024 * 1024);
}

#[test]
fn unknown_cancel_rejected() {
    let broker = Broker::new();
    let err = broker
        .cancel_execution("exec_does_not_exist")
        .expect_err("unknown execution must be rejected");
    assert_eq!(err.code, ErrorCode::UnknownExecution);
}
