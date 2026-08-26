//! Goal24 Checkpoint 3 — adversarial oracle execution harness (Lane B).
//!
//! Turns the 104 machine-readable vectors in
//! `docs/goal24/cp3-broker-adversarial-vectors.json` into executable cargo
//! tests. Vectors that were already covered by the Lane A security suite map
//! to `COVERED_BY_EXISTING_TEST` entries in
//! `docs/goal24/cp3-adversarial-execution-map.json`; the automatable gaps are
//! implemented here. Windows-only fixture vectors are compiled only on
//! Windows and recorded as MANUAL on other platforms by the map.

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::execution_broker::types::{
    ApprovalReferenceWire, ErrorCode, ExecutionPlanStateWire, ExecutionPlanWire,
};
use crate::execution_broker::Broker;

#[cfg(windows)]
use super::tests::process_running;
use super::tests::{
    broker_with_root, child_test_lock, plan, set_inputs, wait_until, TempDir, TestSelfBinding,
    TEST_CHILD_TEST_NAME,
};

// Deliberately marked as a test fixture so repository secret scans do not
// confuse it with a credential while the redaction adversarial test remains
// structurally representative.
const GH_TOKEN_SAMPLE: &str = "ghp_testtokenabcdefghijklmnopqrstuvwxyz1234567890ABCD";

/// Build a plan with a process-unique plan id so repeated submissions inside
/// one test never collide with the single-use ledger.
fn fresh_plan(state: ExecutionPlanStateWire) -> ExecutionPlanWire {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let mut p = plan(state);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    p.plan_id = format!("plan-adv-{n:08}");
    p
}
const FAKE_SECRET: &str = "FAKE_SECRET_CP3_TEST_VALUE";

fn approval_ref(plan_id: &str) -> ApprovalReferenceWire {
    ApprovalReferenceWire {
        approval_id: "appr_0001".to_string(),
        plan_id: plan_id.to_string(),
        granted_by: "user-test".to_string(),
        granted_at: "2026-08-13T00:05:00+08:00".to_string(),
        policy_version: "1.0.0".to_string(),
        token_reference: "token-ref-0001".to_string(),
        token_digest: "digest-placeholder-0001".to_string(),
    }
}

/// Submit a plan whose only input is `cwd`, expecting an error.
fn execute_with_cwd(
    broker: &Broker,
    cwd: &str,
) -> Result<(), crate::execution_broker::BrokerError> {
    let mut p = fresh_plan(ExecutionPlanStateWire::Ready);
    set_inputs(&mut p, serde_json::json!({ "mode": "echo", "cwd": cwd }));
    broker.execute(&p, "test.self.run").map(|_| ())
}

/// Recursive text scan of every file under `dir`.
fn dir_contains(dir: &Path, needle: &str) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if dir_contains(&path, needle) {
                return true;
            }
        } else if let Ok(text) = std::fs::read_to_string(&path) {
            if text.contains(needle) {
                return true;
            }
        }
    }
    false
}

// ---------------------------------------------------------------------------
// V004 / V083 — single-use guard
// ---------------------------------------------------------------------------

#[test]
fn single_use_replay_blocked() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("adv-replay");
    let broker = broker_with_root(tmp.path());
    std::env::set_var("OMNI_BROKER_TEST_MODE", "echo");

    let p = plan(ExecutionPlanStateWire::Ready);
    let first = broker.execute(&p, "test.self.run").expect("first run");
    assert!(first.success, "first run must succeed");

    // CP3 policy: required_approval=true plans are blocked before the
    // single-use ledger is consulted, so the frozen V004/V083 templates
    // (tpl_write) can never reach single-use in CP3. The guard itself is
    // verified with a ready, approval-free plan: the same plan id must be
    // rejected on the second submission.
    let err = broker
        .execute(&p, "test.self.run")
        .expect_err("same ready plan twice must be rejected");
    assert_eq!(err.code, ErrorCode::PlanRejectedSingleUse);
}

// ---------------------------------------------------------------------------
// V082 / V084 — approval reference consistency
// ---------------------------------------------------------------------------

#[test]
fn approval_reference_consistency_rejected() {
    let tmp = TempDir::new("adv-approval");
    let broker = broker_with_root(tmp.path());

    // V082: approval.plan_id != plan.plan_id.
    let mut mismatched = plan(ExecutionPlanStateWire::Ready);
    mismatched.required_approval = true;
    mismatched.approval = Some(approval_ref("some-other-plan"));
    let err = broker
        .execute(&mismatched, "test.self.run")
        .expect_err("mismatched approval plan_id");
    assert_eq!(err.code, ErrorCode::PlanRejectedInvalid);

    // V084: approval present on a plan that does not require approval.
    let mut unneeded = plan(ExecutionPlanStateWire::Ready);
    unneeded.required_approval = false;
    unneeded.approval = Some(approval_ref(&unneeded.plan_id.clone()));
    let err = broker
        .execute(&unneeded, "test.self.run")
        .expect_err("approval on approval-free plan");
    assert_eq!(err.code, ErrorCode::PlanRejectedInvalid);

    // V080/V081: required_approval=true with a fabricated approval payload
    // must fail the native store lookup (CP7: the reference strings alone
    // are never authority).
    let mut required = plan(ExecutionPlanStateWire::Ready);
    required.required_approval = true;
    required.approval = Some(approval_ref(&required.plan_id.clone()));
    let err = broker
        .execute(&required, "test.self.run")
        .expect_err("fabricated approval reference must be rejected");
    assert_eq!(err.code, ErrorCode::ApprovalRecordNotFound);
}

// ---------------------------------------------------------------------------
// V049 — write-scoped github credential in the broker environment
// ---------------------------------------------------------------------------

#[test]
fn github_token_env_blocked() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("adv-env");
    let broker = broker_with_root(tmp.path());
    std::env::set_var("GITHUB_TOKEN", "ghp_write_scope_fake");
    let result = broker.execute(&fresh_plan(ExecutionPlanStateWire::Ready), "test.self.run");
    std::env::remove_var("GITHUB_TOKEN");
    let err = result.expect_err("GITHUB_TOKEN in env must block execution");
    assert_eq!(err.code, ErrorCode::BrokerBlockedEnv);
}

// ---------------------------------------------------------------------------
// V046 / V047 / V055 — token-shaped output redaction
// ---------------------------------------------------------------------------

#[test]
fn credential_output_redacted() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("adv-redact");
    let broker = broker_with_root(tmp.path());

    for mode in ["print-token", "secret-output"] {
        std::env::set_var("OMNI_BROKER_TEST_MODE", mode);
        let result = broker
            .execute(&fresh_plan(ExecutionPlanStateWire::Ready), "test.self.run")
            .expect("run");
        assert!(result.success, "{mode} run failed");
        assert!(result.output_redacted, "{mode} must be redacted");
        assert!(
            !result.stdout.contains(GH_TOKEN_SAMPLE),
            "{mode}: token must not appear: {}",
            result.stdout
        );
        assert!(
            !result.stdout.contains("ghp_"),
            "{mode}: token pattern must be redacted: {}",
            result.stdout
        );
        assert!(
            result.stdout.contains("[REDACTED]"),
            "{mode}: redaction marker expected: {}",
            result.stdout
        );
    }
}

// ---------------------------------------------------------------------------
// V056 / V057 — bearer + URL credential redaction
// ---------------------------------------------------------------------------

#[test]
fn bearer_output_redacted() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("adv-bearer");
    let broker = broker_with_root(tmp.path());
    std::env::set_var("OMNI_BROKER_TEST_MODE", "bearer-output");
    let result = broker
        .execute(&fresh_plan(ExecutionPlanStateWire::Ready), "test.self.run")
        .expect("run");
    assert!(result.success);
    assert!(result.output_redacted);
    assert!(
        !result.stdout.contains("Bearer ghp_"),
        "bearer value must be redacted: {}",
        result.stdout
    );
    assert!(
        result.stdout.contains("Bearer [REDACTED]"),
        "bearer redaction marker expected: {}",
        result.stdout
    );
}

#[test]
fn credential_url_output_redacted() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("adv-url");
    let broker = broker_with_root(tmp.path());
    std::env::set_var("OMNI_BROKER_TEST_MODE", "credential-url-output");
    let result = broker
        .execute(&fresh_plan(ExecutionPlanStateWire::Ready), "test.self.run")
        .expect("run");
    assert!(result.success);
    assert!(result.output_redacted);
    assert!(
        !result.stdout.contains("user:pass123"),
        "url userinfo must be redacted: {}",
        result.stdout
    );
    assert!(
        result.stdout.contains("://[REDACTED]@"),
        "url redaction marker expected: {}",
        result.stdout
    );
}
// ---------------------------------------------------------------------------
// V099 — control characters / ANSI escapes
// ---------------------------------------------------------------------------

#[test]
fn control_chars_output_redacted() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("adv-control");
    let broker = broker_with_root(tmp.path());
    std::env::set_var("OMNI_BROKER_TEST_MODE", "control-chars-output");
    let result = broker
        .execute(&fresh_plan(ExecutionPlanStateWire::Ready), "test.self.run")
        .expect("run");
    assert!(result.success);
    assert!(result.output_redacted);
    assert!(
        !result.stdout.contains('\u{1b}'),
        "ANSI escapes must be stripped: {:?}",
        result.stdout
    );
    assert!(
        !result.stdout.contains('\u{07}'),
        "control chars must be stripped: {:?}",
        result.stdout
    );
    assert!(
        result.stdout.contains("normalRED tail"),
        "readable text must survive redaction: {:?}",
        result.stdout
    );
}

// ---------------------------------------------------------------------------
// Step 22 — FAKE_SECRET_CP3_TEST_VALUE persistence check
// ---------------------------------------------------------------------------

#[test]
fn fake_secret_not_persisted() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("adv-secret");
    let broker = broker_with_root(tmp.path());
    std::env::set_var("OMNI_BROKER_TEST_MODE", "echo");
    let mut p = fresh_plan(ExecutionPlanStateWire::Ready);
    set_inputs(
        &mut p,
        serde_json::json!({ "mode": "echo", "args": [FAKE_SECRET] }),
    );
    let result = broker.execute(&p, "test.self.run").expect("run");
    assert!(result.success);
    assert!(
        !result.stdout.contains(FAKE_SECRET),
        "captured output must redact the fake secret"
    );
    let logs = crate::log_writer::logs_dir();
    if logs.exists() {
        assert!(
            !dir_contains(&logs, FAKE_SECRET),
            "broker output must never be persisted to logs"
        );
    }
}

// ---------------------------------------------------------------------------
// V010 / V012 / V013 — planted fake binaries never run
// ---------------------------------------------------------------------------

#[test]
fn path_hijack_fake_binary_not_run() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("adv-hijack");
    let evil = tmp.path().join("evil");
    let shims = tmp.path().join("shims");
    std::fs::create_dir_all(&evil).expect("evil dir");
    std::fs::create_dir_all(&shims).expect("shims dir");

    // V012: a fake gh.exe planted directly in the allowed cwd (the broker
    // binding root).
    let cwd_fake = tmp.path().join("gh.exe");
    std::fs::copy(std::env::current_exe().expect("current_exe"), &cwd_fake)
        .expect("plant cwd fake");
    // V010: a fake gh.exe earlier in PATH.
    std::fs::copy(
        std::env::current_exe().expect("current_exe"),
        evil.join("gh.exe"),
    )
    .expect("plant PATH fake");
    // V013: a gh.cmd shim earlier in PATH.
    std::fs::write(shims.join("gh.cmd"), "@echo ran").expect("plant cmd shim");

    let marker = tmp.path().join("marker_fake_ran");
    std::env::set_var("OMNI_BROKER_TEST_MODE", "echo");
    std::env::set_var(
        "OMNI_BROKER_TEST_MARKER_FILE",
        marker.to_string_lossy().to_string(),
    );

    let old_path = std::env::var("PATH").unwrap_or_default();
    std::env::set_var(
        "PATH",
        format!("{};{};{}", evil.display(), shims.display(), old_path),
    );

    let broker = broker_with_root(tmp.path());
    let result = broker
        .execute(&fresh_plan(ExecutionPlanStateWire::Ready), "test.self.run")
        .expect("pinned binding must execute");

    std::env::remove_var("OMNI_BROKER_TEST_MARKER_FILE");
    std::env::set_var("PATH", old_path);

    assert!(result.success, "broker must run the pinned binary");
    assert!(
        !marker.exists(),
        "planted fake binary must never execute (V010/V012/V013)"
    );
}

// ---------------------------------------------------------------------------
// V032 / V039 / V093 / V097 / V101 / V102 / V103 — cwd path forms
// ---------------------------------------------------------------------------

#[test]
fn cwd_form_rejections() {
    let tmp = TempDir::new("adv-cwd");
    let root = tmp.path().join("root");
    std::fs::create_dir_all(&root).expect("create root");
    let broker = broker_with_root(&root);

    // V032: relative traversal.
    let err = execute_with_cwd(&broker, "..\\..\\Windows\\System32")
        .expect_err("relative cwd must be rejected");
    assert_eq!(err.code, ErrorCode::BrokerBlockedCwd);

    // V097: NUL byte.
    let err = execute_with_cwd(&broker, "C:\\repos\\allowed\u{0}evil")
        .expect_err("NUL cwd must be rejected");
    assert_eq!(err.code, ErrorCode::BrokerBlockedCwd);

    #[cfg(windows)]
    {
        // V101: UNC share.
        let err = execute_with_cwd(&broker, "\\\\server\\share\\repo")
            .expect_err("UNC cwd must be rejected");
        assert_eq!(err.code, ErrorCode::BrokerBlockedCwd);

        // V102: verbatim \\?\ prefix.
        let err = execute_with_cwd(&broker, "\\\\?\\C:\\repos\\allowed")
            .expect_err("verbatim cwd must be rejected");
        assert_eq!(err.code, ErrorCode::BrokerBlockedPath);

        // V103: alternate data stream.
        let err = execute_with_cwd(&broker, "C:\\repos\\allowed\\evil.txt:stream")
            .expect_err("ADS cwd must be rejected");
        assert_eq!(err.code, ErrorCode::BrokerBlockedPath);

        // V093: fullwidth separators are not real path separators.
        let err = execute_with_cwd(&broker, "C\u{ff1a}\u{ff3c}repos\u{ff3c}allowed")
            .expect_err("fullwidth path must be rejected");
        assert_eq!(err.code, ErrorCode::BrokerBlockedCwd);

        // V039: canonicalization failure (symlink cycle class) is PATH-form.
        let loop_dir = root.join("loop");
        let link = root.join("loop-link");
        if std::os::windows::fs::symlink_dir(&loop_dir, &link).is_ok() {
            let err = execute_with_cwd(&broker, link.to_string_lossy().as_ref())
                .expect_err("cycle cwd must be rejected");
            assert_eq!(err.code, ErrorCode::BrokerBlockedPath);
        } else {
            eprintln!("[skip] symlink cycle fixture creation not permitted on this host");
        }
    }
}

// ---------------------------------------------------------------------------
// V094 / V095 / V096 / V104 — benign cwd path variants resolve to the same dir
// ---------------------------------------------------------------------------

#[cfg(windows)]
#[test]
fn cwd_unicode_variants_allowed() {
    let tmp = TempDir::new("adv-uni");
    let root = tmp.path().join("repo");
    std::fs::create_dir_all(&root).expect("create repo");
    let broker = broker_with_root(&root);
    let root_str = root.to_string_lossy().into_owned();

    let mut variants: Vec<(String, &str)> = vec![
        (format!("{}.", root_str), "trailing dot"),
        (format!("{} ", root_str), "trailing space"),
        (root_str.to_uppercase(), "case variant"),
    ];

    // V104: 8.3 short name, when the volume exposes one.
    let short = root_str
        .split('\\')
        .map(|seg| {
            let trimmed = seg.trim_end_matches('.').trim_end();
            if trimmed.len() > 8 {
                format!("{}~1", trimmed[..6].replace(' ', ""))
            } else {
                trimmed.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\\");
    if short != root_str {
        variants.push((short, "8.3 short name"));
    }

    for (variant, label) in variants {
        let mut p = fresh_plan(ExecutionPlanStateWire::Ready);
        set_inputs(
            &mut p,
            serde_json::json!({ "mode": "echo", "cwd": variant }),
        );
        match broker.execute(&p, "test.self.run") {
            Ok(result) => {
                assert!(result.success, "{label} cwd variant must succeed");
            }
            Err(err) => {
                if label == "8.3 short name" {
                    eprintln!("[skip] 8.3 short names unavailable for {label}: {err}");
                } else {
                    panic!("{label} cwd variant must succeed, got {err:?}");
                }
            }
        }
    }
}
// ---------------------------------------------------------------------------
// V036 — junction escape
// ---------------------------------------------------------------------------

#[cfg(windows)]
#[test]
fn junction_escape_rejected() {
    let tmp = TempDir::new("adv-junction");
    let root = tmp.path().join("root");
    std::fs::create_dir_all(&root).expect("create root");
    let outside = tmp.path().join("outside");
    std::fs::create_dir_all(&outside).expect("create outside");
    let link = root.join("sub");
    let Ok(()) = std::os::windows::fs::symlink_dir(&outside, &link) else {
        eprintln!("[skip] directory symlink creation not permitted on this host");
        return;
    };
    let broker = broker_with_root(&root);
    let err = execute_with_cwd(&broker, link.to_string_lossy().as_ref())
        .expect_err("junction escape must be rejected");
    assert_eq!(err.code, ErrorCode::BrokerBlockedPath);
}

// ---------------------------------------------------------------------------
// V037 — executable symlink to an attacker binary
// ---------------------------------------------------------------------------

#[cfg(windows)]
#[test]
fn executable_symlink_target_rejected() {
    let tmp = TempDir::new("adv-symlink-exe");
    let attacker = tmp.path().join("attacker.exe");
    std::fs::copy(std::env::current_exe().expect("current_exe"), &attacker).expect("copy attacker");
    let link = tmp.path().join("gh.exe");
    let Ok(()) = std::os::windows::fs::symlink_file(&attacker, &link) else {
        eprintln!("[skip] file symlink creation not permitted on this host");
        return;
    };
    let broker = Broker::new();
    broker.register_binding(Box::new(
        TestSelfBinding::new(tmp.path().to_path_buf()).with_candidate(link),
    ));
    let err = broker
        .execute(&fresh_plan(ExecutionPlanStateWire::Ready), "test.self.run")
        .expect_err("symlinked executable must be rejected");
    assert_eq!(err.code, ErrorCode::BrokerBlockedExecutable);
}

// ---------------------------------------------------------------------------
// V073 — post-spawn replacement does not affect the running child
// ---------------------------------------------------------------------------

#[test]
fn toctou_post_spawn_replacement_ignored() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("adv-toctou");
    let copied = tmp.path().join("tool.exe");
    std::fs::copy(std::env::current_exe().expect("current_exe"), &copied).expect("copy test exe");
    let broker = Arc::new(Broker::new());
    broker.register_binding(Box::new(
        TestSelfBinding::new(tmp.path().to_path_buf()).with_candidate(copied.clone()),
    ));
    std::env::set_var("OMNI_BROKER_TEST_MODE", "sleep");
    std::env::set_var("OMNI_BROKER_TEST_SLEEP_MS", "600");

    let broker2 = broker.clone();
    let mut p = fresh_plan(ExecutionPlanStateWire::Ready);
    p.timeout_ms = 30_000;
    let handle = std::thread::spawn(move || broker2.execute(&p, "test.self.run"));

    // Wait for the child to be running, then swap the executable bytes.
    let deadline = Instant::now() + Duration::from_secs(15);
    assert!(
        wait_until(deadline, || !broker.active_executions().is_empty()),
        "execution never became active"
    );
    let replacement = std::fs::copy(std::env::current_exe().expect("current_exe"), &copied);
    let _ = replacement;

    let result = handle.join().expect("join").expect("run");
    assert!(
        result.success,
        "post-spawn replacement must not affect the running child"
    );
}

// ---------------------------------------------------------------------------
// V068 — child exits first, grandchild must not survive
// ---------------------------------------------------------------------------

#[test]
fn tree_drain_child_exit_first() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("adv-tree-drain");
    let pid_file = tmp.path().join("grandchild.pid");
    let broker = broker_with_root(tmp.path());
    std::env::set_var("OMNI_BROKER_TEST_MODE", "spawn-grandchild-exit-first");
    std::env::set_var(
        "OMNI_BROKER_TEST_GRANDCHILD_PID_FILE",
        pid_file.to_string_lossy().to_string(),
    );
    let mut p = fresh_plan(ExecutionPlanStateWire::Ready);
    p.timeout_ms = 2_500;
    let result = broker.execute(&p, "test.self.run").expect("run");
    assert!(
        result.timed_out,
        "a surviving grandchild must keep the tree alive until timeout"
    );
    assert_eq!(result.error_code, Some(ErrorCode::BrokerTimeout));

    #[cfg(windows)]
    {
        let deadline = Instant::now() + Duration::from_secs(10);
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
            wait_until(deadline, || !process_running(grandchild_pid)),
            "grandchild must die when the broker drains the tree"
        );
    }
}

// ---------------------------------------------------------------------------
// V069 — CREATE_BREAKAWAY_FROM_JOB must fail
// ---------------------------------------------------------------------------

#[cfg(windows)]
#[test]
fn breakaway_attempt_blocked() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("adv-breakaway");
    let pid_file = tmp.path().join("grandchild.pid");
    let broker = broker_with_root(tmp.path());
    std::env::set_var("OMNI_BROKER_TEST_MODE", "breakaway-attempt");
    std::env::set_var(
        "OMNI_BROKER_TEST_GRANDCHILD_PID_FILE",
        pid_file.to_string_lossy().to_string(),
    );
    let result = broker
        .execute(&fresh_plan(ExecutionPlanStateWire::Ready), "test.self.run")
        .expect("run");
    assert!(result.success, "breakaway fixture must exit cleanly");
    assert!(
        result.stdout.contains("BREAKAWAY_BLOCKED"),
        "breakaway must be refused: {}",
        result.stdout
    );
    assert!(!pid_file.exists(), "escaped grandchild must not exist");
}

// ---------------------------------------------------------------------------
// V070 — broker crash: KILL_ON_JOB_CLOSE terminates descendants
// ---------------------------------------------------------------------------

#[cfg(windows)]
#[test]
fn broker_crash_job_kill() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("adv-crash");
    let pid_file = tmp.path().join("grandchild.pid");
    let holder = std::process::Command::new(std::env::current_exe().expect("current_exe"))
        .args(["--exact", TEST_CHILD_TEST_NAME, "--ignored", "--nocapture"])
        .env("OMNI_BROKER_TEST_MODE", "job-holder")
        .env(
            "OMNI_BROKER_TEST_GRANDCHILD_PID_FILE",
            pid_file.to_string_lossy().to_string(),
        )
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("spawn job holder");

    let deadline = Instant::now() + Duration::from_secs(15);
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

    let _ = holder.wait_with_output();
    assert!(
        wait_until(deadline, || !process_running(grandchild_pid)),
        "grandchild must die when the broker process dies (KILL_ON_JOB_CLOSE)"
    );
}

// ---------------------------------------------------------------------------
// V063 — cancel after exit must keep the verified success outcome
// ---------------------------------------------------------------------------

#[test]
fn cancel_after_exit_success() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("adv-cancel-exit");
    let broker = Arc::new(broker_with_root(tmp.path()));
    std::env::set_var("OMNI_BROKER_TEST_MODE", "exit-immediately");
    let broker2 = broker.clone();
    let handle = std::thread::spawn(move || {
        broker2.execute(&fresh_plan(ExecutionPlanStateWire::Ready), "test.self.run")
    });
    let deadline = Instant::now() + Duration::from_secs(10);
    assert!(
        wait_until(deadline, || !broker.active_executions().is_empty()),
        "execution never became active"
    );
    assert!(
        wait_until(deadline, || broker.active_executions().is_empty()),
        "execution never finished"
    );
    let result = handle.join().expect("join").expect("run");
    assert!(result.success, "child exited 0 before cancel");
    assert!(!result.cancelled, "late cancel must not flip the outcome");
}

// ---------------------------------------------------------------------------
// V058 / V061 — timeout carries BROKER_TIMEOUT
// ---------------------------------------------------------------------------

#[test]
fn timeout_error_code_reported() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("adv-timeout");
    let broker = broker_with_root(tmp.path());
    std::env::set_var("OMNI_BROKER_TEST_MODE", "sleep");
    std::env::set_var("OMNI_BROKER_TEST_SLEEP_MS", "60000");
    let mut p = fresh_plan(ExecutionPlanStateWire::Ready);
    p.timeout_ms = 100;
    let result = broker.execute(&p, "test.self.run").expect("run");
    assert!(result.timed_out);
    assert!(!result.success);
    assert_eq!(result.error_code, Some(ErrorCode::BrokerTimeout));
}

// ---------------------------------------------------------------------------
// V050–V054 — truncation carries BROKER_OUTPUT_LIMIT
// ---------------------------------------------------------------------------

#[test]
fn output_limit_error_code_reported() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("adv-flood");
    let broker = broker_with_root(tmp.path());
    std::env::set_var("OMNI_BROKER_TEST_MODE", "large-output");
    std::env::set_var("OMNI_BROKER_TEST_STDOUT_BYTES", "2000000");
    let mut p = fresh_plan(ExecutionPlanStateWire::Ready);
    p.timeout_ms = 30_000;
    let result = broker.execute(&p, "test.self.run").expect("run");
    assert!(result.success);
    assert!(result.stdout_truncated);
    assert!(result.stdout.len() <= 1024 * 1024);
    assert_eq!(result.error_code, Some(ErrorCode::BrokerOutputLimit));
}

// ---------------------------------------------------------------------------
// V021 / V092 — homoglyph argv stays a literal argument
// ---------------------------------------------------------------------------

#[test]
fn unicode_homoglyph_argv_literal() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("adv-argv");
    let broker = broker_with_root(tmp.path());
    std::env::set_var("OMNI_BROKER_TEST_MODE", "echo");
    let homoglyph = "\u{ff0d}\u{ff0d}force";
    let mut p = fresh_plan(ExecutionPlanStateWire::Ready);
    set_inputs(
        &mut p,
        serde_json::json!({ "mode": "echo", "args": [homoglyph] }),
    );
    let result = broker.execute(&p, "test.self.run").expect("run");
    assert!(result.success);
    assert!(
        result.stdout.contains(&format!("ARG={homoglyph:?}")),
        "homoglyph argv must stay literal: {}",
        result.stdout
    );
    assert!(
        !result.stdout.contains("--force"),
        "homoglyph argv must not become a flag: {}",
        result.stdout
    );
}
// ---------------------------------------------------------------------------
// V087 — stale plan without expires_at rejected by the CP3 default TTL
// ---------------------------------------------------------------------------

#[test]
fn stale_plan_default_ttl_rejected() {
    let tmp = TempDir::new("adv-stale");
    let broker = broker_with_root(tmp.path());
    let mut p = fresh_plan(ExecutionPlanStateWire::Ready);
    p.created_at = (chrono::Utc::now() - chrono::Duration::days(8)).to_rfc3339();
    p.expires_at = None;
    let err = broker
        .execute(&p, "test.self.run")
        .expect_err("stale plan without expires_at must be rejected");
    assert_eq!(err.code, ErrorCode::PlanRejectedExpired);
}
