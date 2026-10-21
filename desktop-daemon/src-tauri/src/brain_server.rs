use std::io::{BufRead, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
#[cfg(windows)]
use sha2::{Digest, Sha256};

use crate::execution_broker::process_tree::ProcessTree;
use crate::log_writer;

/// [核心壁垒] Brain Server 进程管理器
/// 使用 Mutex 替代 unsafe static mut，确保多线程安全
static BRAIN_SERVER_PROCESS: std::sync::LazyLock<Mutex<Option<ProcessTree>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));
static BRAIN_SERVER_STARTING: AtomicBool = AtomicBool::new(false);

// A hard desktop stop can terminate Node while SQLite is checkpointing its WAL
// or while Windows is still releasing the previous file handles.  In that
// small window the first child can exit before it ever binds /health.  Keep the
// recovery bounded and retry the *same* normal startup path a few times rather
// than leaving the desktop alive with no Brain service.  This does not retry
// requests or reuse an unverified process; every attempt still acquires the
// profile startup lock and runs the ownership checks in start_inner().
const START_ATTEMPTS: usize = 3;
const START_RETRY_DELAY: Duration = Duration::from_secs(1);

/// The production Brain transport is loopback-only. D1B1's real Desktop
/// harness may select an isolated loopback port through `OMNI_BRAIN_PORT` so
/// it never has to claim an unrelated application's listener. The value is
/// deliberately a port number rather than a URL/host override.
pub const DEFAULT_BRAIN_PORT: u16 = 3001;
// A first-run Windows instance may spend more than one minute opening the
// SQLite store and applying forward-only migrations.  The health probe must
// wait for the real server instead of killing a healthy cold start at the
// exact 60-second boundary.
const BRAIN_STARTUP_TIMEOUT: Duration = Duration::from_secs(120);
// Keep recovery within the installed-product startup gate. A cold first
// launch may use the full 120 seconds, but a hard-stop retry must still have
// a bounded window instead of multiplying the cold-start timeout by the
// attempt count.
const BRAIN_STARTUP_RETRY_BUDGET: Duration = Duration::from_secs(175);

pub fn brain_port() -> u16 {
    match std::env::var("OMNI_BRAIN_PORT") {
        Ok(raw) => match raw.parse::<u16>() {
            Ok(port) if port != 0 => port,
            _ => {
                eprintln!(
                    "[Brain Server] ignoring invalid OMNI_BRAIN_PORT={raw:?}; using {DEFAULT_BRAIN_PORT}"
                );
                DEFAULT_BRAIN_PORT
            }
        },
        Err(_) => DEFAULT_BRAIN_PORT,
    }
}

pub fn brain_api_url() -> String {
    format!("http://127.0.0.1:{}", brain_port())
}

pub fn is_running() -> bool {
    let mut guard = match BRAIN_SERVER_PROCESS.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };

    if let Some(ref mut process) = *guard {
        // try_wait 返回 Ok(None) 表示进程仍在运行
        match process.try_wait() {
            Ok(None) => true,
            Ok(Some(_status)) => {
                // 进程已退出，清理引用
                *guard = None;
                false
            }
            Err(_) => {
                *guard = None;
                false
            }
        }
    } else {
        false
    }
}

pub fn is_ready() -> bool {
    health_check(Duration::from_millis(350))
}

/// Persist native startup/recovery failures next to the Brain child log.  The
/// message contains only bounded state (phase, PIDs, paths and error kinds);
/// credentials and request payloads are never part of this path.
fn log_startup_event(message: &str) {
    let line = format!("[Desktop] {message}");
    log_writer::write_line(&log_writer::log_file_path(), &line, true);
}

fn health_check(timeout: Duration) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], brain_port()));
    let mut stream = match TcpStream::connect_timeout(&addr, timeout) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    if stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }

    let mut response = String::new();
    stream.read_to_string(&mut response).is_ok()
        && response.contains("200 OK")
        && response.contains("omni-context-brain-server")
}

fn wait_for_health(process: &mut ProcessTree, timeout: Duration) -> Result<(), String> {
    let started = Instant::now();
    let pid = process.child_mut().id();
    log_startup_event(&format!(
        "waiting for Brain child health pid={pid} timeout_ms={}",
        timeout.as_millis()
    ));
    let mut last_pending_log = Instant::now();
    while started.elapsed() < timeout {
        match process.try_wait() {
            Ok(None) => {
                if health_check(Duration::from_millis(700)) {
                    log_startup_event(&format!("Brain child health ready pid={pid}"));
                    return Ok(());
                }
                if last_pending_log.elapsed() >= Duration::from_secs(10) {
                    log_startup_event(&format!(
                        "Brain child still running without health pid={pid} job_empty={}",
                        process.is_empty()
                    ));
                    last_pending_log = Instant::now();
                }
            }
            Ok(Some(status)) => {
                log_startup_event(&format!(
                    "Brain child exited before health pid={pid} status={status}"
                ));
                return Err(format!("进程启动后退出（status: {}）", status));
            }
            Err(e) => {
                log_startup_event(&format!(
                    "Brain child status probe failed before health pid={pid}: {e}"
                ));
                return Err(format!("检查进程状态失败: {}", e));
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Err(format!("{} 秒内 /health 未就绪", timeout.as_secs()))
}

fn pipe_output_to_log(
    stdout: Option<std::process::ChildStdout>,
    stderr: Option<std::process::ChildStderr>,
) {
    let log_path = log_writer::log_file_path();
    if let Some(stdout) = stdout {
        let lp = log_path.clone();
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(l) => log_writer::write_line(&lp, &l, false),
                    Err(_) => break,
                }
            }
        });
    }
    if let Some(stderr) = stderr {
        let lp = log_path;
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(l) => log_writer::write_line(&lp, &l, true),
                    Err(_) => break,
                }
            }
        });
    }
}

/// 查找 node 可执行文件：优先用安装包内嵌的 node.exe，
/// 找不到时回退到 PATH 里的系统 node。
fn find_node_executable() -> String {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidates = [
                // Windows node.exe, macOS/Linux node (no extension)
                exe_dir.join("resources/brain-server/node.exe"),
                exe_dir.join("resources/brain-server/node"),
                exe_dir.join("brain-server/node.exe"),
                exe_dir.join("brain-server/node"),
                exe_dir.join("../Resources/brain-server/node.exe"),
                exe_dir.join("../Resources/brain-server/node"),
            ];
            for c in &candidates {
                if c.exists() {
                    return c.to_string_lossy().into_owned();
                }
            }
        }
    }
    // 兜底用 PATH 中的 node（开发模式 / 用户自己装过 Node 的场景）
    "node".to_string()
}

pub fn start() -> Result<(), String> {
    if BRAIN_SERVER_STARTING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        let started = Instant::now();
        while started.elapsed() < BRAIN_STARTUP_RETRY_BUDGET {
            if is_ready() {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        let error = format!(
            "Brain Server 正在启动，但 {} 秒内仍未就绪",
            BRAIN_STARTUP_RETRY_BUDGET.as_secs()
        );
        log_startup_event(&error);
        return Err(error);
    }

    let mut result = Err("Brain Server startup did not run".to_string());
    let deadline = Instant::now() + BRAIN_STARTUP_RETRY_BUDGET;
    for attempt in 1..=START_ATTEMPTS {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        result = start_inner(remaining.min(BRAIN_STARTUP_TIMEOUT));
        if let Err(error) = &result {
            log_startup_event(&format!(
                "startup attempt {attempt}/{START_ATTEMPTS} failed: {error}"
            ));
        }
        if result.is_ok() || attempt == START_ATTEMPTS {
            break;
        }
        eprintln!(
            "[Brain Server] startup attempt {attempt}/{START_ATTEMPTS} failed: {}; retrying after a bounded recovery delay",
            result.as_ref().err().unwrap()
        );
        let retry_delay = START_RETRY_DELAY.min(deadline.saturating_duration_since(Instant::now()));
        if retry_delay.is_zero() {
            break;
        }
        std::thread::sleep(retry_delay);
    }
    BRAIN_SERVER_STARTING.store(false, Ordering::Release);
    if let Err(error) = &result {
        log_startup_event(&format!("startup failed after bounded recovery: {error}"));
    }
    result
}

fn start_inner(startup_timeout: Duration) -> Result<(), String> {
    let startup_deadline = Instant::now() + startup_timeout;
    // Serialize startup across app instances that share the same data profile.
    // A second instance must not mistake the first instance's live Brain child
    // for a zombie while that child is starting or recovering.
    let lock_timeout_ms = startup_timeout.as_millis().min(u128::from(u32::MAX)) as u32;
    let _startup_lock = BrainStartupLock::acquire(lock_timeout_ms).map_err(|error| {
        log_startup_event(&format!(
            "startup lock unavailable after {} ms: {error}",
            lock_timeout_ms
        ));
        error
    })?;

    // A healthy service can belong to another desktop instance. Check it before
    // touching the recovery record or invalidating persisted sessions.
    if health_check(Duration::from_millis(350)) {
        #[cfg(windows)]
        match healthy_brain_owner_state() {
            HealthyBrainOwnerState::Active => {
                println!("[Brain Server] 已由活动的 Omni-context 实例提供服务");
                return Ok(());
            }
            HealthyBrainOwnerState::Orphaned => {
                // The old desktop process is gone but its Brain child survived.
                // Reclaim only after the child and owner identities were verified.
                kill_zombie_by_pid_file().map_err(|error| {
                    log_startup_event(&format!("orphan Brain recovery failed: {error}"));
                    error
                })?;
                clear_control_session();
                clear_verification_session();
                clear_reopen_session();
            }
            HealthyBrainOwnerState::Unverified => {
                // Old-format or unreadable recovery records are not authority to
                // stop a healthy local server, especially during an upgrade.
                println!("[Brain Server] 健康服务的所有者无法核验；保留现有服务");
                return Ok(());
            }
        }
        #[cfg(not(windows))]
        {
            println!("[Brain Server] 已有健康 Brain Server，保留现有服务");
            return Ok(());
        }
    } else {
        kill_zombie_by_pid_file().map_err(|error| {
            log_startup_event(&format!("stale Brain recovery failed: {error}"));
            error
        })?;
        // Only invalidate persisted sessions after recovery has established
        // that no other live desktop instance owns the Brain process.
        clear_control_session();
        clear_verification_session();
        clear_reopen_session();
    }

    if is_running() {
        eprintln!("[Brain Server] 进程存在但 /health 未就绪，先停止后重新启动");
        if let Err(error) = stop_inner(true) {
            log_startup_event(&format!("unready Brain cleanup failed: {error}"));
        }
    }

    println!("[Brain Server] 正在启动...");

    let node_exe = find_node_executable();
    println!("[Brain Server] 使用 node: {}", node_exe);

    let mut candidates = brain_server_paths();
    if std::env::var("OMNI_D1B1_E2E_FIXTURE").as_deref() == Ok("1") {
        // The closure fixture is composed only by api-server. Falling back to
        // mcp-server after fixture creation fails would report /health as ready
        // while silently replacing the shared authorization runtime with an
        // empty one, recreating PLAN_NOT_FOUND. Fail closed in this explicit
        // local-only mode instead.
        candidates.retain(|path| {
            path.file_name().and_then(|name| name.to_str()) == Some("api-server.js")
        });
    }
    let mut tried: Vec<String> = Vec::new();

    // 直接 node <path>。spawn 成功不代表 HTTP API 已经就绪，所以必须等 /health。
    for path in &candidates {
        tried.push(path.display().to_string());
        if !path.exists() {
            continue;
        }

        // 数据库放到用户可写目录，避免 Program Files 只读导致 sqlite open 失败
        let data_dir = user_data_dir();
        let _ = std::fs::create_dir_all(&data_dir);
        let db_path = data_dir.join("omni-context.db");
        let script_parent = path.parent().unwrap_or_else(|| std::path::Path::new("."));
        let brain_server_root =
            if script_parent.file_name().and_then(|name| name.to_str()) == Some("dist") {
                script_parent.parent().unwrap_or(script_parent)
            } else {
                script_parent
            };
        let embedding_model_root = brain_server_root.join("models");

        // 每次 Brain Server 启动都轮换配对码。运行中再次生成时，服务端
        // 通过 PAIR_CODE_FILE 的修改时间读取新码并重新开始短期有效窗口。
        let pair_code = regenerate_pair_code();
        let pair_code_path = pair_code_file();
        let lan_ip = get_lan_ip().unwrap_or_default();
        let local_token = ensure_local_token()?;

        let mut cmd = Command::new(&node_exe);
        cmd.arg(path)
            .current_dir(&data_dir)
            .env("HOST", "127.0.0.1")
            .env("PORT", brain_port().to_string())
            .env("DB_PATH", &db_path)
            .env("EMBEDDING_MODE", "local")
            .env("EMBEDDING_LOCAL_MODEL", "Xenova/multilingual-e5-large")
            .env("EMBEDDING_LOCAL_MODEL_PATH", &embedding_model_root)
            .env("PAIR_CODE", &pair_code)
            .env("PAIR_CODE_FILE", &pair_code_path)
            .env("LAN_IP", &lan_ip)
            .env("LOCAL_API_TOKEN", &local_token)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let entry_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("<unknown-entry>");
        let node_path = PathBuf::from(&node_exe);
        let node_name = node_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("<unknown-node>");
        log_startup_event(&format!(
            "spawning Brain child entry_name={entry_name} node_name={node_name}"
        ));
        let spawn_result = ProcessTree::spawn_hidden(&mut cmd);

        match spawn_result {
            Ok(mut process) => {
                let pid = process.child_mut().id();
                log_startup_event(&format!(
                    "Brain child spawned pid={pid} entry_name={entry_name}"
                ));
                // Publish the identity as soon as CreateProcessW succeeds,
                // before health or database initialization.  A hard desktop
                // stop can occur during that window; the next instance must
                // still have an identity-bound record it can safely reclaim.
                let process_record = write_pid_file(pid);
                // 要在 store_process 之前取出 stdout/stderr，否则 move 后拿不到。
                // 立即接日志，避免冷启动等待期间没有任何可诊断输出。
                let stdout = process.child_mut().stdout.take();
                let stderr = process.child_mut().stderr.take();
                pipe_output_to_log(stdout, stderr);

                let health_timeout = startup_deadline.saturating_duration_since(Instant::now());
                if health_timeout.is_zero() {
                    let _ = process.terminate();
                    let _ = process.wait();
                    remove_pid_file_for_current_process(pid, process_record);
                    break;
                }
                match wait_for_health(&mut process, health_timeout) {
                    Ok(()) => {
                        println!("[Brain Server] 已启动: {}", path.display());
                        log_startup_event(&format!(
                            "Brain child ready on loopback port {} (entry={})",
                            brain_port(),
                            path.display()
                        ));

                        // On Windows, persist the process creation time with the
                        // PID. Windows may reuse PIDs between a hard stop and the
                        // next launch; a bare PID is not sufficient authority to
                        // terminate a process during recovery.
                        store_process(process);
                        return Ok(());
                    }
                    Err(e) => {
                        eprintln!(
                            "[Brain Server] node {} 未就绪：{}，尝试下一个候选",
                            path.display(),
                            e
                        );
                        log_startup_event(&format!(
                            "Brain child entry {} did not become healthy: {e}",
                            path.display()
                        ));
                        let _ = process.terminate();
                        let _ = process.wait();
                        remove_pid_file_for_current_process(pid, process_record);
                    }
                }
            }
            Err(e) => {
                eprintln!(
                    "[Brain Server] spawn 失败 at {}: {}（可能 node 不在 PATH）",
                    path.display(),
                    e
                );
                log_startup_event(&format!(
                    "Brain child spawn failed at {}: {e}",
                    path.display()
                ));
            }
        }
    }

    let error = format!(
        "无法启动 Brain Server。\n  使用 node: {}\n  已尝试 JS 入口：\n    {}\n请确认：(1) node 可执行（系统 PATH 或内嵌均可）；(2) brain-server/dist 已构建。",
        node_exe,
        tried.join("\n    ")
    );
    log_startup_event(&error);
    Err(error)
}

pub fn stop() -> Result<(), String> {
    // Shutdown must stay responsive even if another app instance is in its
    // bounded startup wait. If the lock is unavailable, stop our own child but
    // leave the recovery record for the next serialized startup to reconcile.
    let startup_lock = BrainStartupLock::acquire(1_000).ok();
    stop_inner(startup_lock.is_some())
}

fn stop_inner(owns_startup_lock: bool) -> Result<(), String> {
    let mut guard = BRAIN_SERVER_PROCESS
        .lock()
        .map_err(|e| format!("锁获取失败: {}", e))?;

    if let Some(mut process) = guard.take() {
        let pid = process.child_mut().id();
        #[cfg(windows)]
        let process_start_time = process_creation_time(pid);
        process
            .terminate()
            .map_err(|e| format!("终止进程树失败: {}", e))?;
        // 等待进程退出，回收资源
        let _ = process.wait();
        // Remove only the record for the child we just stopped. A second
        // instance may have replaced it while this process was shutting down.
        #[cfg(windows)]
        if owns_startup_lock {
            if let Some(start_time) = process_start_time {
                remove_pid_file_for_process(pid, start_time);
            }
        } else {
            eprintln!("[Brain Server] startup lock unavailable during shutdown; keeping recovery record for next startup");
        }
        #[cfg(not(windows))]
        if owns_startup_lock {
            let _ = std::fs::remove_file(pid_file_path());
        }
        clear_control_session();
        clear_verification_session();
        clear_reopen_session();
        println!("[Brain Server] 已停止");
        Ok(())
    } else {
        Err("Brain Server 未运行".to_string())
    }
}

pub fn restart() -> Result<(), String> {
    let _ = stop();
    std::thread::sleep(std::time::Duration::from_secs(1));
    start()
}

/// 获取进程 PID（用于日志/调试）
pub fn get_pid() -> Option<u32> {
    let mut guard = BRAIN_SERVER_PROCESS.lock().ok()?;
    guard.as_mut().map(|process| process.child_mut().id())
}

fn store_process(process: ProcessTree) {
    let mut guard = match BRAIN_SERVER_PROCESS.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    *guard = Some(process);
}

/// 跨平台获取用户主目录
fn dirs_or_home() -> Option<String> {
    // Windows: USERPROFILE, Unix: HOME
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
}

/// 用户可写的数据目录：Windows 优先 LOCALAPPDATA，回退到 USERPROFILE/HOME 下。
fn pair_code_dir() -> PathBuf {
    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        return PathBuf::from(local_appdata).join("omni-context");
    }
    if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
        return PathBuf::from(home).join(".omni-context");
    }
    PathBuf::from("./.omni-context")
}

fn pair_code_file() -> PathBuf {
    pair_code_dir().join("pair-code.txt")
}

/// Ephemeral CLI approval session minted by Brain for the native Desktop.
pub fn control_session_file() -> PathBuf {
    pair_code_dir().join("control-session.json")
}

pub fn verification_session_file() -> PathBuf {
    pair_code_dir().join("verification-session.json")
}

/// Ephemeral Goal27 revision session. It is distinct from approve and verify
/// sessions so no existing control token can be broadened into reopen.
pub fn reopen_session_file() -> PathBuf {
    pair_code_dir().join("reopen-session.json")
}

pub fn clear_control_session() {
    let _ = std::fs::remove_file(control_session_file());
}

pub fn clear_verification_session() {
    let _ = std::fs::remove_file(verification_session_file());
}

pub fn clear_reopen_session() {
    let _ = std::fs::remove_file(reopen_session_file());
}

pub fn ensure_pair_code() -> String {
    let dir = pair_code_dir();
    let _ = std::fs::create_dir_all(&dir);
    let file = pair_code_file();

    if let Ok(existing) = std::fs::read_to_string(&file) {
        let trimmed = existing.trim().to_string();
        if trimmed.len() == 6 && trimmed.chars().all(|c| c.is_ascii_digit()) {
            return trimmed;
        }
    }

    generate_and_save_pair_code(&file)
}

pub fn regenerate_pair_code() -> String {
    let dir = pair_code_dir();
    let _ = std::fs::create_dir_all(&dir);
    let file = pair_code_file();
    generate_and_save_pair_code(&file)
}

fn generate_and_save_pair_code(file: &std::path::Path) -> String {
    let code = generate_pair_code();
    let _ = std::fs::write(file, &code);
    code
}

fn generate_pair_code() -> String {
    let mut bytes = [0_u8; 4];
    getrandom::getrandom(&mut bytes).expect("secure OS randomness is required for pairing");
    let num = u32::from_le_bytes(bytes) % 1_000_000;
    format!("{:06}", num)
}

// ========== Local API Token ==========

fn local_token_dir() -> PathBuf {
    pair_code_dir() // 复用同一个目录: %LOCALAPPDATA%/omni-context/
}

fn local_token_file() -> PathBuf {
    local_token_dir().join("local-token.txt")
}

pub fn ensure_local_token() -> Result<String, String> {
    let dir = local_token_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("unable to create local API token directory: {error}"))?;
    let file = local_token_file();
    ensure_local_token_at(&file)
}

fn ensure_local_token_at(file: &std::path::Path) -> Result<String, String> {
    if let Ok(existing) = std::fs::read_to_string(file) {
        let trimmed = existing.trim().to_string();
        if !trimmed.is_empty() {
            harden_local_token_permissions(file)?;
            return Ok(trimmed);
        }
    }

    generate_and_save_local_token(file)
}

pub fn regenerate_local_token() -> Result<String, String> {
    let dir = local_token_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("unable to create local API token directory: {error}"))?;
    let file = local_token_file();
    generate_and_save_local_token(&file)
}

fn generate_and_save_local_token(file: &std::path::Path) -> Result<String, String> {
    let token = generate_local_token();
    // For an existing file, establish restrictive permissions before its new
    // secret is written. A hardening failure is an error and never returns the
    // token to callers.
    #[cfg(unix)]
    if file.exists() {
        harden_local_token_permissions(file)?;
    }
    write_local_token(file, &token)?;
    harden_local_token_permissions(file)?;
    Ok(token)
}

fn write_local_token(file: &std::path::Path, token: &str) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::fs::OpenOptions;
        use std::os::unix::fs::OpenOptionsExt;
        let mut handle = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(file)
            .map_err(|error| format!("unable to create local API token file: {error}"))?;
        handle
            .write_all(token.as_bytes())
            .map_err(|error| format!("unable to write local API token file: {error}"))?;
        return Ok(());
    }
    #[cfg(not(unix))]
    {
        std::fs::write(file, token)
            .map_err(|error| format!("unable to write local API token file: {error}"))
    }
}

fn harden_local_token_permissions(file: &std::path::Path) -> Result<(), String> {
    // On Windows the file lives under user-scoped LOCALAPPDATA. Explicit ACL
    // rewriting is deliberately deferred until the application has a shared,
    // reviewed helper; do not claim it is hardened here.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("local API token permission hardening failed: {error}"))?;
    }
    #[cfg(not(unix))]
    let _ = file;
    Ok(())
}

fn generate_local_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("getrandom failed");
    URL_SAFE_NO_PAD.encode(bytes)
}

#[cfg(all(test, unix))]
#[allow(clippy::items_after_test_module)]
mod local_token_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_token_file(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("omctx-{label}-{}-{unique}", std::process::id()))
    }

    #[test]
    fn existing_local_token_is_hardened_to_owner_only() {
        let directory = test_token_file("existing-token");
        std::fs::create_dir_all(&directory).expect("create temporary token directory");
        let file = directory.join("local-token.txt");
        std::fs::write(&file, "existing-test-token").expect("write token fixture");
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644))
            .expect("make token fixture overly permissive");

        let token = ensure_local_token_at(&file).expect("harden existing token");
        let mode = std::fs::metadata(&file)
            .expect("stat token file")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(token, "existing-test-token");
        assert_eq!(mode, 0o600);
        std::fs::remove_dir_all(&directory).expect("remove temporary token directory");
    }

    #[test]
    fn new_local_token_is_created_owner_only() {
        let directory = test_token_file("new-token");
        std::fs::create_dir_all(&directory).expect("create temporary token directory");
        let file = directory.join("local-token.txt");

        let token = ensure_local_token_at(&file).expect("create secure token");
        let mode = std::fs::metadata(&file)
            .expect("stat token file")
            .permissions()
            .mode()
            & 0o777;
        assert!(!token.is_empty());
        assert_eq!(mode, 0o600);
        std::fs::remove_dir_all(&directory).expect("remove temporary token directory");
    }
}

/// 获取本机 LAN IP，失败返回 None
///
/// 过滤掉 VPN/TUN 虚拟网卡（如 Clash、Proxifier、企业 VPN 常用的 198.18.0.0/15 网段），
/// 否则配对二维码会包含手机无法访问的虚拟 IP。
pub fn get_lan_ip() -> Option<String> {
    // 枚举所有网卡地址（接口名 + IP），按优先级筛选真实的 LAN IP
    let ifaces = local_ip_address::list_afinet_netifas().ok()?;

    // 优先级：IPv4 私有地址（10.x / 192.168.x / 172.16-31.x），排除虚拟网卡网段
    for (_intf, ip) in ifaces.iter() {
        if let std::net::IpAddr::V4(v4) = ip {
            let octets = v4.octets();
            // 排除环回
            if octets[0] == 127 {
                continue;
            }
            // 排除 198.18.0.0/15（VPN/TUN 虚拟网卡常用，如 Clash）
            if octets[0] == 198 && (octets[1] == 18 || octets[1] == 19) {
                continue;
            }
            // 排除 169.254.x.x（link-local）
            if octets[0] == 169 && octets[1] == 254 {
                continue;
            }
            // 只保留私有地址段
            // 10.0.0.0/8
            if octets[0] == 10 {
                return Some(ip.to_string());
            }
            // 192.168.0.0/16
            if octets[0] == 192 && octets[1] == 168 {
                return Some(ip.to_string());
            }
            // 172.16.0.0/12
            if octets[0] == 172 && (octets[1] >= 16 && octets[1] <= 31) {
                return Some(ip.to_string());
            }
        }
    }

    // 回退：所有 IPv4 中第一个非环回/非虚拟/非 link-local 的地址
    for (_intf, ip) in ifaces.iter() {
        if let std::net::IpAddr::V4(v4) = ip {
            let octets = v4.octets();
            if octets[0] == 127 {
                continue;
            }
            if octets[0] == 198 && (octets[1] == 18 || octets[1] == 19) {
                continue;
            }
            if octets[0] == 169 && octets[1] == 254 {
                continue;
            }
            return Some(ip.to_string());
        }
    }

    // 最后回退到 local_ip()
    local_ip_address::local_ip().ok().map(|ip| ip.to_string())
}

fn pid_file_path() -> PathBuf {
    user_data_dir().join("brain-server.pid")
}

#[cfg(windows)]
struct BrainStartupLock {
    handle: windows::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
impl BrainStartupLock {
    fn acquire(timeout_ms: u32) -> Result<Self, String> {
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::{
            CloseHandle, WAIT_ABANDONED, WAIT_OBJECT_0, WAIT_TIMEOUT,
        };
        use windows::Win32::System::Threading::{CreateMutexW, WaitForSingleObject};

        let profile = normalize_process_path(&user_data_dir().to_string_lossy());
        let digest = Sha256::digest(profile.as_bytes());
        let name = format!("Local\\OmniContextBrainStartup-{}", hex::encode(digest));
        let mut wide_name = name.encode_utf16().collect::<Vec<_>>();
        wide_name.push(0);
        let handle = unsafe { CreateMutexW(None, false, PCWSTR(wide_name.as_ptr())) }
            .map_err(|error| format!("创建 Brain Server 启动锁失败: {error}"))?;
        let wait = unsafe { WaitForSingleObject(handle, timeout_ms) };
        if wait == WAIT_OBJECT_0 || wait == WAIT_ABANDONED {
            return Ok(Self { handle });
        }

        unsafe { CloseHandle(handle) }.ok();
        if wait == WAIT_TIMEOUT {
            Err("等待其他 Omni-context 实例完成 Brain Server 启动超时".to_string())
        } else {
            Err(format!("获取 Brain Server 启动锁失败: {:?}", wait))
        }
    }
}

#[cfg(windows)]
impl Drop for BrainStartupLock {
    fn drop(&mut self) {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::ReleaseMutex;

        unsafe { ReleaseMutex(self.handle) }.ok();
        unsafe { CloseHandle(self.handle) }.ok();
    }
}

#[cfg(not(windows))]
struct BrainStartupLock;

#[cfg(not(windows))]
impl BrainStartupLock {
    fn acquire(_timeout_ms: u32) -> Result<Self, String> {
        Ok(Self)
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct BrainPidRecord {
    pid: u32,
    process_start_time: u64,
    executable_path: String,
    owner_pid: u32,
    owner_process_start_time: u64,
    owner_executable_path: String,
}

impl BrainPidRecord {
    fn matches_process(&self, pid: u32, process_start_time: u64, executable_path: &str) -> bool {
        self.pid == pid
            && self.process_start_time == process_start_time
            && normalize_process_path(&self.executable_path)
                == normalize_process_path(executable_path)
    }

    fn matches_owner_process(
        &self,
        pid: u32,
        process_start_time: u64,
        executable_path: &str,
    ) -> bool {
        self.owner_pid == pid
            && self.owner_process_start_time == process_start_time
            && normalize_process_path(&self.owner_executable_path)
                == normalize_process_path(executable_path)
    }
}

fn normalize_process_path(path: &str) -> String {
    path.replace('/', "\\").to_lowercase()
}

#[cfg(windows)]
fn process_start_time_for_handle(handle: windows::Win32::Foundation::HANDLE) -> Option<u64> {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::GetProcessTimes;

    let mut created = FILETIME::default();
    let mut exited = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    if unsafe { GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user) }
        .is_err()
    {
        return None;
    }
    Some(((created.dwHighDateTime as u64) << 32) | u64::from(created.dwLowDateTime))
}

#[cfg(windows)]
fn process_image_path_for_handle(handle: windows::Win32::Foundation::HANDLE) -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::System::Threading::{QueryFullProcessImageNameW, PROCESS_NAME_WIN32};

    let mut path = vec![0u16; 32_768];
    let mut length = path.len() as u32;
    unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(path.as_mut_ptr()),
            &mut length,
        )
    }
    .ok()?;
    Some(String::from_utf16_lossy(&path[..length as usize]))
}

#[cfg(windows)]
fn process_creation_time(pid: u32) -> Option<u64> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let start_time = process_start_time_for_handle(handle);
    unsafe { CloseHandle(handle) }.ok();
    start_time
}

#[cfg(windows)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProcessIdentityStatus {
    Match,
    Mismatch,
    Exited,
    Unavailable,
}

#[cfg(windows)]
#[derive(Debug, PartialEq, Eq)]
enum ProcessLiveness {
    Alive,
    Exited,
    Unavailable,
}

#[cfg(windows)]
const PROCESS_IDENTITY_RETRY_TIMEOUT: Duration = Duration::from_secs(5);

#[cfg(windows)]
const PROCESS_IDENTITY_RETRY_INTERVAL: Duration = Duration::from_millis(100);

#[cfg(windows)]
#[derive(Debug, PartialEq, Eq)]
enum HealthyBrainOwnerState {
    Active,
    Orphaned,
    Unverified,
}

#[cfg(windows)]
fn classify_healthy_brain_owner(
    child: ProcessIdentityStatus,
    owner: ProcessIdentityStatus,
) -> HealthyBrainOwnerState {
    if child != ProcessIdentityStatus::Match {
        return HealthyBrainOwnerState::Unverified;
    }
    match owner {
        ProcessIdentityStatus::Match => HealthyBrainOwnerState::Active,
        ProcessIdentityStatus::Mismatch | ProcessIdentityStatus::Exited => {
            HealthyBrainOwnerState::Orphaned
        }
        ProcessIdentityStatus::Unavailable => HealthyBrainOwnerState::Unverified,
    }
}

#[cfg(windows)]
fn process_identity_status(
    pid: u32,
    start_time: u64,
    executable_path: &str,
) -> ProcessIdentityStatus {
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_ACCESS_RIGHTS, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let handle = match unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_ACCESS_RIGHTS(0x0010_0000),
            false,
            pid,
        )
    } {
        Ok(handle) => handle,
        // OpenProcess reports ERROR_INVALID_PARAMETER when the PID no longer
        // exists. All other failures remain unverifiable and fail closed.
        Err(error) if error.code().0 == 0x8007_0057u32 as i32 => {
            return ProcessIdentityStatus::Exited;
        }
        Err(_) => return ProcessIdentityStatus::Unavailable,
    };

    let status = match unsafe { WaitForSingleObject(handle, 0) } {
        WAIT_OBJECT_0 => ProcessIdentityStatus::Exited,
        WAIT_TIMEOUT => {
            match process_start_time_for_handle(handle).zip(process_image_path_for_handle(handle)) {
                Some((actual_start, actual_path))
                    if actual_start == start_time
                        && normalize_process_path(&actual_path)
                            == normalize_process_path(executable_path) =>
                {
                    ProcessIdentityStatus::Match
                }
                Some(_) => ProcessIdentityStatus::Mismatch,
                None => ProcessIdentityStatus::Unavailable,
            }
        }
        _ => ProcessIdentityStatus::Unavailable,
    };
    unsafe { CloseHandle(handle) }.ok();
    status
}

/// A hard stop can leave a process in the short Windows termination window
/// where `OpenProcess` succeeds but one of the identity queries is not yet
/// available. Treat that as transient, not as an immediately unverified
/// owner. The retry is bounded and still fails closed when the identity cannot
/// be established, so it never authorizes terminating an unknown process.
#[cfg(windows)]
fn process_identity_status_with_retry(
    pid: u32,
    start_time: u64,
    executable_path: &str,
) -> ProcessIdentityStatus {
    let deadline = Instant::now() + PROCESS_IDENTITY_RETRY_TIMEOUT;
    loop {
        let status = process_identity_status(pid, start_time, executable_path);
        if status != ProcessIdentityStatus::Unavailable || Instant::now() >= deadline {
            return status;
        }
        std::thread::sleep(PROCESS_IDENTITY_RETRY_INTERVAL);
    }
}

/// A desktop process can be terminated between the identity check and the
/// handle used to reclaim its Brain child.  In that case the termination call
/// quite correctly returns `false` because there is no longer a process to
/// open; a second identity check must treat an exited or replaced PID as a
/// successful cleanup, while keeping an active or unverifiable process
/// fail-closed.
#[cfg(windows)]
fn failed_termination_can_clear_record(status: ProcessIdentityStatus) -> bool {
    matches!(
        status,
        ProcessIdentityStatus::Exited | ProcessIdentityStatus::Mismatch
    )
}

/// During a forced app stop the owner process may still be in its Windows
/// termination window.  Wait for that owner to disappear before deciding that
/// another live instance owns the Brain child.  The bound is deliberately
/// short and fail-closed: a still-live owner remains an error after the wait.
#[cfg(windows)]
fn wait_for_owner_release(
    pid: u32,
    start_time: u64,
    executable_path: &str,
) -> ProcessIdentityStatus {
    let deadline = Instant::now() + PROCESS_IDENTITY_RETRY_TIMEOUT;
    loop {
        let status = process_identity_status(pid, start_time, executable_path);
        if !matches!(
            status,
            ProcessIdentityStatus::Match | ProcessIdentityStatus::Unavailable
        ) || Instant::now() >= deadline
        {
            return status;
        }
        std::thread::sleep(PROCESS_IDENTITY_RETRY_INTERVAL);
    }
}

#[cfg(windows)]
fn process_liveness(pid: u32) -> ProcessLiveness {
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_ACCESS_RIGHTS, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let handle = match unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_ACCESS_RIGHTS(0x0010_0000),
            false,
            pid,
        )
    } {
        Ok(handle) => handle,
        Err(error) if error.code().0 == 0x8007_0057u32 as i32 => {
            return ProcessLiveness::Exited;
        }
        Err(_) => return ProcessLiveness::Unavailable,
    };
    let liveness = match unsafe { WaitForSingleObject(handle, 0) } {
        WAIT_OBJECT_0 => ProcessLiveness::Exited,
        WAIT_TIMEOUT => ProcessLiveness::Alive,
        _ => ProcessLiveness::Unavailable,
    };
    unsafe { CloseHandle(handle) }.ok();
    liveness
}

#[cfg(windows)]
fn process_liveness_with_retry(pid: u32) -> ProcessLiveness {
    let deadline = Instant::now() + PROCESS_IDENTITY_RETRY_TIMEOUT;
    loop {
        let liveness = process_liveness(pid);
        if liveness != ProcessLiveness::Unavailable || Instant::now() >= deadline {
            return liveness;
        }
        std::thread::sleep(PROCESS_IDENTITY_RETRY_INTERVAL);
    }
}

#[cfg(windows)]
fn healthy_brain_owner_state() -> HealthyBrainOwnerState {
    let Ok(contents) = std::fs::read_to_string(pid_file_path()) else {
        return HealthyBrainOwnerState::Unverified;
    };
    let Ok(record) = serde_json::from_str::<BrainPidRecord>(&contents) else {
        return HealthyBrainOwnerState::Unverified;
    };
    classify_healthy_brain_owner(
        process_identity_status_with_retry(
            record.pid,
            record.process_start_time,
            &record.executable_path,
        ),
        process_identity_status_with_retry(
            record.owner_pid,
            record.owner_process_start_time,
            &record.owner_executable_path,
        ),
    )
}

#[cfg(windows)]
fn terminate_process_if_identity_matches(record: &BrainPidRecord) -> bool {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Foundation::WAIT_OBJECT_0;
    use windows::Win32::System::Threading::{
        OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_ACCESS_RIGHTS,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };

    // Keep one process handle from identity check through termination. This
    // closes the PID-reuse race between checking the process and calling
    // taskkill with a numeric PID.
    let Ok(handle) = (unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION
                | PROCESS_TERMINATE
                | PROCESS_ACCESS_RIGHTS(0x0010_0000),
            false,
            record.pid,
        )
    }) else {
        return false;
    };
    let matches = process_start_time_for_handle(handle)
        .zip(process_image_path_for_handle(handle))
        .is_some_and(|(start_time, image_path)| {
            record.matches_process(record.pid, start_time, &image_path)
        });
    let terminated = matches && unsafe { TerminateProcess(handle, 1) }.is_ok();
    // TerminateProcess is asynchronous.  Do not clear the recovery record or
    // let a replacement Brain open the same SQLite profile until Windows has
    // confirmed that the old process object is signalled.  A hard stop can
    // leave Node/native SQLite teardown in flight for several seconds; merely
    // observing a successful TerminateProcess call is not an ownership proof.
    let exited = terminated && unsafe { WaitForSingleObject(handle, 30_000) } == WAIT_OBJECT_0;
    unsafe { CloseHandle(handle) }.ok();
    exited
}

#[cfg(windows)]
fn write_pid_file(pid: u32) -> Option<u64> {
    // Windows can briefly deny one of the identity queries immediately after
    // Node binds /health.  Keep the recovery record authoritative by waiting
    // through that transient window; if identity still cannot be established,
    // fail closed and do not publish a PID-only record.
    let Some((process_start_time, executable_path)) = process_identity_with_retry(pid) else {
        eprintln!("[Brain Server] unable to verify process identity; skipping PID recovery record");
        return None;
    };
    let owner_pid = std::process::id();
    let Some((owner_process_start_time, owner_executable_path)) =
        process_identity_with_retry(owner_pid)
    else {
        eprintln!(
            "[Brain Server] unable to verify owner process identity; skipping PID recovery record"
        );
        return None;
    };
    let record = BrainPidRecord {
        pid,
        process_start_time,
        executable_path,
        owner_pid,
        owner_process_start_time,
        owner_executable_path,
    };
    match serde_json::to_vec(&record) {
        Ok(contents) => {
            let path = pid_file_path();
            let temporary = path.with_file_name(format!("brain-server.pid.{pid}.tmp"));
            if let Err(error) = std::fs::write(&temporary, contents) {
                eprintln!("[Brain Server] unable to write PID recovery record: {error}");
                return None;
            }
            // `std::fs::rename` maps to MoveFileExW without
            // MOVEFILE_REPLACE_EXISTING on Windows, so it fails whenever a
            // stale recovery record is still present. Replace the old record
            // atomically and flush the directory entry before returning.
            let publish_result = {
                use std::os::windows::ffi::OsStrExt;
                use windows::core::PCWSTR;
                use windows::Win32::Storage::FileSystem::{
                    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
                };

                let mut temporary_wide = temporary.as_os_str().encode_wide().collect::<Vec<_>>();
                temporary_wide.push(0);
                let mut path_wide = path.as_os_str().encode_wide().collect::<Vec<_>>();
                path_wide.push(0);
                unsafe {
                    MoveFileExW(
                        PCWSTR(temporary_wide.as_ptr()),
                        PCWSTR(path_wide.as_ptr()),
                        MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                    )
                }
            };
            if let Err(error) = publish_result {
                let _ = std::fs::remove_file(&temporary);
                eprintln!(
                    "[Brain Server] unable to atomically publish PID recovery record: {error}"
                );
                return None;
            }
            Some(process_start_time)
        }
        Err(error) => {
            eprintln!("[Brain Server] unable to encode PID recovery record: {error}");
            None
        }
    }
}

#[cfg(not(windows))]
fn write_pid_file(pid: u32) -> Option<u64> {
    let _ = std::fs::write(pid_file_path(), pid.to_string());
    None
}

#[cfg(windows)]
fn process_identity(pid: u32) -> Option<(u64, String)> {
    use windows::Win32::Foundation::{CloseHandle, WAIT_TIMEOUT};
    use windows::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_ACCESS_RIGHTS, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let handle = unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_ACCESS_RIGHTS(0x0010_0000),
            false,
            pid,
        )
    }
    .ok()?;
    let identity = if unsafe { WaitForSingleObject(handle, 0) } == WAIT_TIMEOUT {
        process_start_time_for_handle(handle).zip(process_image_path_for_handle(handle))
    } else {
        None
    };
    unsafe { CloseHandle(handle) }.ok();
    identity
}

#[cfg(windows)]
fn process_identity_with_retry(pid: u32) -> Option<(u64, String)> {
    let deadline = Instant::now() + PROCESS_IDENTITY_RETRY_TIMEOUT;
    loop {
        if let Some(identity) = process_identity(pid) {
            return Some(identity);
        }
        if Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(PROCESS_IDENTITY_RETRY_INTERVAL);
    }
}

/// A descendant identity captured before reclaiming an orphaned Brain.  The
/// Toolhelp snapshot only gives us PID/parent PID edges; capture the native
/// creation time and image path while each process is still queryable so a
/// reused PID can never be treated as the old child during the drain wait.
#[cfg(windows)]
#[derive(Clone, Debug)]
struct BrainDescendantIdentity {
    pid: u32,
    process_start_time: u64,
    executable_path: String,
}

/// Read the process parent graph without opening or mutating any process.
/// Toolhelp can fail after the snapshot is created (for example if a process
/// exits while the snapshot is being walked); propagate that failure instead
/// of claiming that the tree is empty.
#[cfg(windows)]
fn snapshot_process_parent_edges() -> Result<Vec<(u32, u32)>, String> {
    use windows::Win32::Foundation::{CloseHandle, ERROR_NO_MORE_FILES};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32First, Process32Next, PROCESSENTRY32, TH32CS_SNAPPROCESS,
    };

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
        .map_err(|error| format!("CreateToolhelp32Snapshot(processes) failed: {error}"))?;
    let result = (|| {
        let mut entry = PROCESSENTRY32::default();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32>() as u32;
        unsafe { Process32First(snapshot, &mut entry) }
            .map_err(|error| format!("Process32First failed: {error}"))?;

        let mut edges = Vec::new();
        loop {
            edges.push((entry.th32ProcessID, entry.th32ParentProcessID));
            match unsafe { Process32Next(snapshot, &mut entry) } {
                Ok(()) => {}
                // Toolhelp returns a `windows::core::Error` whose code is the
                // HRESULT form (`0x80070012`), not the raw Win32 value 18.
                // Compare against the canonical conversion so normal end of
                // the snapshot is not misreported as a recovery failure.
                Err(error) if error.code() == ERROR_NO_MORE_FILES.to_hresult() => break,
                Err(error) => return Err(format!("Process32Next failed: {error}")),
            }
        }
        Ok(edges)
    })();
    unsafe { CloseHandle(snapshot) }.ok();
    result
}

/// Capture every currently observable descendant of `root_pid`, including
/// grandchildren.  A process that exits between the snapshot and identity
/// query is harmless and skipped; any other identity-query failure is
/// unverified and therefore blocks destructive recovery (fail closed).
#[cfg(windows)]
fn capture_descendant_identities(root_pid: u32) -> Result<Vec<BrainDescendantIdentity>, String> {
    use std::collections::{HashMap, HashSet, VecDeque};

    let edges = snapshot_process_parent_edges()?;
    let mut children_by_parent: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, parent_pid) in edges {
        if pid != 0 {
            children_by_parent.entry(parent_pid).or_default().push(pid);
        }
    }

    let mut pending = VecDeque::from([root_pid]);
    let mut seen = HashSet::from([root_pid]);
    let mut descendants = Vec::new();
    while let Some(parent_pid) = pending.pop_front() {
        for child_pid in children_by_parent
            .get(&parent_pid)
            .into_iter()
            .flatten()
            .copied()
        {
            if !seen.insert(child_pid) {
                continue;
            }
            match process_identity(child_pid) {
                Some((process_start_time, executable_path)) => {
                    descendants.push(BrainDescendantIdentity {
                        pid: child_pid,
                        process_start_time,
                        executable_path,
                    });
                    pending.push_back(child_pid);
                }
                None => match process_liveness(child_pid) {
                    ProcessLiveness::Exited => {}
                    ProcessLiveness::Alive | ProcessLiveness::Unavailable => {
                        return Err(format!(
                            "无法安全核验 Brain descendant process {child_pid}；未回收旧进程"
                        ));
                    }
                },
            }
        }
    }
    Ok(descendants)
}

/// Wait until all identities captured from an orphaned Brain have exited or
/// changed identity.  While a captured child is still alive, enumerate its
/// direct children again so a late-spawned helper is included in the same
/// identity-bound drain.  The root PID is intentionally not used after
/// termination: it may be reused by an unrelated process.
#[cfg(windows)]
fn wait_for_descendants_drain(
    descendants: &mut Vec<BrainDescendantIdentity>,
) -> Result<(), String> {
    use std::collections::HashSet;

    const DRAIN_TIMEOUT: Duration = Duration::from_secs(30);
    const DRAIN_INTERVAL: Duration = Duration::from_millis(100);
    let deadline = Instant::now() + DRAIN_TIMEOUT;

    loop {
        let mut active_parent_pids = HashSet::new();
        let mut pending = false;
        let mut unavailable = false;
        for identity in descendants.iter() {
            match process_identity_status(
                identity.pid,
                identity.process_start_time,
                &identity.executable_path,
            ) {
                ProcessIdentityStatus::Match => {
                    pending = true;
                    active_parent_pids.insert(identity.pid);
                }
                ProcessIdentityStatus::Unavailable => unavailable = true,
                ProcessIdentityStatus::Exited | ProcessIdentityStatus::Mismatch => {}
            }
        }

        // Discover helpers spawned by a still-verified descendant.  If the
        // read-only snapshot itself cannot be verified, do not clear the
        // recovery record while an unknown process may still be alive.
        if !active_parent_pids.is_empty() {
            let edges = snapshot_process_parent_edges()?;
            for (child_pid, parent_pid) in edges {
                if !active_parent_pids.contains(&parent_pid)
                    || descendants.iter().any(|identity| identity.pid == child_pid)
                {
                    continue;
                }
                match process_identity(child_pid) {
                    Some((process_start_time, executable_path)) => {
                        descendants.push(BrainDescendantIdentity {
                            pid: child_pid,
                            process_start_time,
                            executable_path,
                        });
                        pending = true;
                    }
                    None => match process_liveness(child_pid) {
                        ProcessLiveness::Exited => {}
                        ProcessLiveness::Alive | ProcessLiveness::Unavailable => {
                            return Err(format!(
                                "无法安全核验 late Brain descendant process {child_pid}"
                            ));
                        }
                    },
                }
            }
        }

        if !pending && !unavailable {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "Brain descendants did not drain within {} seconds; recovery record retained",
                DRAIN_TIMEOUT.as_secs()
            ));
        }
        std::thread::sleep(DRAIN_INTERVAL);
    }
}

#[cfg(windows)]
fn remove_pid_file_if_unchanged(expected_contents: &str) {
    let path = pid_file_path();
    if std::fs::read_to_string(&path).ok().as_deref() == Some(expected_contents) {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(windows)]
fn remove_pid_file_for_process(pid: u32, process_start_time: u64) {
    let path = pid_file_path();
    let Ok(contents) = std::fs::read_to_string(&path) else {
        return;
    };
    if serde_json::from_str::<BrainPidRecord>(&contents)
        .is_ok_and(|record| record.pid == pid && record.process_start_time == process_start_time)
    {
        remove_pid_file_if_unchanged(&contents);
    }
}

/// Remove the recovery record only when it still names the child created by
/// this startup attempt.  The identity is captured immediately after spawn,
/// because a failed health wait may reap the process before cleanup runs.
fn remove_pid_file_for_current_process(pid: u32, process_start_time: Option<u64>) {
    #[cfg(windows)]
    if let Some(start_time) = process_start_time {
        remove_pid_file_for_process(pid, start_time);
        return;
    }

    #[cfg(not(windows))]
    {
        let _ = process_start_time;
        let _ = std::fs::remove_file(pid_file_path());
    }
}

/// Reclaim only a process whose PID *and* creation time match our record.
/// Legacy numeric-only PID files do not prove ownership and are never used to
/// terminate a process; this fail-closed behavior prevents killing a PID that
/// Windows has since reused for another application or a new desktop instance.
fn kill_zombie_by_pid_file() -> Result<(), String> {
    let pid_path = pid_file_path();
    let Ok(contents) = std::fs::read_to_string(&pid_path) else {
        return Ok(());
    };

    #[cfg(windows)]
    {
        match serde_json::from_str::<BrainPidRecord>(&contents) {
            Ok(record) => {
                match process_identity_status_with_retry(
                    record.pid,
                    record.process_start_time,
                    &record.executable_path,
                ) {
                    ProcessIdentityStatus::Exited | ProcessIdentityStatus::Mismatch => {
                        // The recorded root is already gone (or its PID was
                        // reused).  We may clear the record only when a
                        // read-only Toolhelp walk proves that no descendant
                        // remains under that PID; otherwise preserve it and
                        // fail closed rather than racing a live helper.
                        let descendants = capture_descendant_identities(record.pid)
                            .map_err(|error| {
                                format!(
                                    "无法安全核验旧 Brain Server descendants；PID 文件已保留：{error}"
                                )
                            })?;
                        if !descendants.is_empty() {
                            return Err(format!(
                                "旧 Brain Server 根进程已退出但仍有 {} 个 descendants；PID 文件已保留",
                                descendants.len()
                            ));
                        }
                        remove_pid_file_if_unchanged(&contents);
                        return Ok(());
                    }
                    ProcessIdentityStatus::Unavailable => {
                        return Err(format!(
                            "无法安全核验旧 Brain Server 进程 {}；未终止该进程",
                            record.pid
                        ));
                    }
                    ProcessIdentityStatus::Match => {}
                }

                let owner_status = wait_for_owner_release(
                    record.owner_pid,
                    record.owner_process_start_time,
                    &record.owner_executable_path,
                );
                match owner_status {
                    ProcessIdentityStatus::Match if record.owner_pid != std::process::id() => {
                        return Err(format!(
                            "Brain Server 仍由另一个 Omni-context 实例 (PID {}) 管理；未终止该进程",
                            record.owner_pid
                        ));
                    }
                    ProcessIdentityStatus::Match if is_running() => {
                        // Let the current Child handle perform its normal stop
                        // and wait path instead of terminating it behind the
                        // supervisor's back.
                        return Ok(());
                    }
                    ProcessIdentityStatus::Unavailable => {
                        return Err(format!(
                            "无法安全核验 Brain Server 所属实例 {}；未终止该进程",
                            record.owner_pid
                        ));
                    }
                    ProcessIdentityStatus::Match
                    | ProcessIdentityStatus::Mismatch
                    | ProcessIdentityStatus::Exited => {}
                }

                let mut descendants = capture_descendant_identities(record.pid).map_err(|error| {
                    format!(
                        "无法安全核验旧 Brain Server descendants；未终止该进程且 PID 文件已保留：{error}"
                    )
                })?;
                if terminate_process_if_identity_matches(&record) {
                    wait_for_descendants_drain(&mut descendants).map_err(|error| {
                        format!(
                            "旧 Brain Server 根进程已终止但 descendants 未安全排空；PID 文件已保留：{error}"
                        )
                    })?;
                    eprintln!(
                        "[Brain Server] reclaimed owned stale process {}",
                        record.pid
                    );
                    remove_pid_file_if_unchanged(&contents);
                    return Ok(());
                }

                // The child may have exited in the small window between the
                // identity check above and OpenProcess/TerminateProcess.  A
                // second bounded identity check distinguishes that benign
                // race from an active or unverifiable process.  Only the
                // former cases clear the record and allow startup to proceed.
                let post_termination_status = process_identity_status_with_retry(
                    record.pid,
                    record.process_start_time,
                    &record.executable_path,
                );
                if failed_termination_can_clear_record(post_termination_status) {
                    wait_for_descendants_drain(&mut descendants).map_err(|error| {
                        format!(
                            "旧 Brain Server 已退出但 descendants 未安全排空；PID 文件已保留：{error}"
                        )
                    })?;
                    eprintln!(
                        "[Brain Server] stale process {} exited or changed during recovery; clearing record",
                        record.pid
                    );
                    remove_pid_file_if_unchanged(&contents);
                    return Ok(());
                }
                return Err(format!(
                    "无法安全回收 Brain Server 进程 {}；PID 文件已保留（终止后身份状态：{post_termination_status:?}）",
                    record.pid
                ));
            }
            Err(_) => {
                let pid = contents.trim().parse::<u32>().ok().or_else(|| {
                    serde_json::from_str::<serde_json::Value>(&contents)
                        .ok()?
                        .get("pid")?
                        .as_u64()
                        .and_then(|value| u32::try_from(value).ok())
                });
                let Some(pid) = pid.filter(|pid| *pid > 0) else {
                    return Err(
                        "Brain Server PID recovery record is invalid; it was preserved and no process was terminated".to_string(),
                    );
                };
                match process_liveness_with_retry(pid) {
                    ProcessLiveness::Exited => {
                        remove_pid_file_if_unchanged(&contents);
                        return Ok(());
                    }
                    ProcessLiveness::Alive | ProcessLiveness::Unavailable => {
                        return Err(format!(
                            "旧版 Brain PID 记录缺少进程身份且 PID {pid} 仍无法排除为活动进程；未终止并保留记录"
                        ));
                    }
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        if let Ok(pid) = contents.trim().parse::<u32>() {
            let _ = std::process::Command::new("kill")
                .args(["-9", &pid.to_string()])
                .output();
        }
        let _ = std::fs::remove_file(&pid_path);
        Ok(())
    }
}

#[cfg(test)]
mod brain_pid_record_tests {
    use super::BrainPidRecord;
    #[cfg(windows)]
    use super::{
        classify_healthy_brain_owner, failed_termination_can_clear_record, HealthyBrainOwnerState,
        ProcessIdentityStatus,
    };

    #[test]
    fn process_identity_requires_both_pid_and_creation_time() {
        let record = BrainPidRecord {
            pid: 42,
            process_start_time: 1_700_000_000,
            executable_path: "C:\\Omni\\node.exe".to_string(),
            owner_pid: 100,
            owner_process_start_time: 1_600_000_000,
            owner_executable_path: "C:\\Omni\\Omni Context.exe".to_string(),
        };

        assert!(record.matches_process(42, 1_700_000_000, "C:/Omni/node.exe"));
        assert!(!record.matches_process(43, 1_700_000_000, "C:/Omni/node.exe"));
        assert!(!record.matches_process(42, 1_700_000_001, "C:/Omni/node.exe"));
        assert!(!record.matches_process(42, 1_700_000_000, "C:/Other/node.exe"));
        assert!(record.matches_owner_process(100, 1_600_000_000, "C:/Omni/Omni Context.exe"));
        assert!(!record.matches_owner_process(101, 1_600_000_000, "C:/Omni/Omni Context.exe"));
        assert!(!record.matches_owner_process(100, 1_600_000_001, "C:/Omni/Omni Context.exe"));
    }

    #[test]
    fn legacy_numeric_pid_does_not_prove_process_ownership() {
        assert!(serde_json::from_str::<BrainPidRecord>("42").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn healthy_server_is_reused_only_for_a_verified_live_owner() {
        assert_eq!(
            classify_healthy_brain_owner(
                ProcessIdentityStatus::Match,
                ProcessIdentityStatus::Match
            ),
            HealthyBrainOwnerState::Active
        );
        assert_eq!(
            classify_healthy_brain_owner(
                ProcessIdentityStatus::Match,
                ProcessIdentityStatus::Exited
            ),
            HealthyBrainOwnerState::Orphaned
        );
        assert_eq!(
            classify_healthy_brain_owner(
                ProcessIdentityStatus::Mismatch,
                ProcessIdentityStatus::Exited
            ),
            HealthyBrainOwnerState::Unverified
        );
        assert_eq!(
            classify_healthy_brain_owner(
                ProcessIdentityStatus::Match,
                ProcessIdentityStatus::Unavailable
            ),
            HealthyBrainOwnerState::Unverified
        );
    }

    #[cfg(windows)]
    #[test]
    fn failed_reclaim_clears_only_exited_or_replaced_process_records() {
        assert!(failed_termination_can_clear_record(
            ProcessIdentityStatus::Exited
        ));
        assert!(failed_termination_can_clear_record(
            ProcessIdentityStatus::Mismatch
        ));
        assert!(!failed_termination_can_clear_record(
            ProcessIdentityStatus::Match
        ));
        assert!(!failed_termination_can_clear_record(
            ProcessIdentityStatus::Unavailable
        ));
    }
}

pub fn user_data_dir() -> PathBuf {
    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        return PathBuf::from(local_appdata)
            .join("omni-context")
            .join("data");
    }
    if let Some(home) = dirs_or_home() {
        return PathBuf::from(home).join(".omni-context").join("data");
    }
    PathBuf::from("./data")
}

fn brain_server_paths() -> Vec<PathBuf> {
    // 桌面端需要的是 HTTP API，所以优先启动 dist/api-server.js。
    // dist/mcp-server.js 仍保留为兼容兜底，但它依赖 MCP stdio SDK，
    // 不应该成为桌面应用能否启动 Brain Server 的唯一入口。
    // Tauri 通过 resources: ["../../brain-server/**/*"] 把整个 brain-server
    // 目录拷到安装目录的 resources/brain-server/ 下，所以安装包里的真正路径是
    // <exe-dir>/resources/brain-server/dist/api-server.js。
    let mut paths: Vec<PathBuf> = Vec::new();

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            // Windows MSI/NSIS / Linux：<exe-dir>/resources/brain-server/dist/api-server.js
            paths.push(exe_dir.join("resources/brain-server/dist/api-server.js"));
            paths.push(exe_dir.join("resources/brain-server/dist/mcp-server.js"));
            paths.push(exe_dir.join("resources/brain-server/api-server.js"));
            paths.push(exe_dir.join("resources/brain-server/mcp-server.js"));
            // macOS app bundle: <exe>/Contents/MacOS/<app> → ../Resources/brain-server/...
            paths.push(exe_dir.join("../Resources/brain-server/dist/api-server.js"));
            paths.push(exe_dir.join("../Resources/brain-server/dist/mcp-server.js"));
            // Tauri externalBin / sidecar 风格
            paths.push(exe_dir.join("brain-server/dist/api-server.js"));
            paths.push(exe_dir.join("brain-server/dist/mcp-server.js"));
            // build-desktop-only.js 把 dist 平铺到 brain-server/ 下，所以实际路径无 dist/
            paths.push(exe_dir.join("brain-server/api-server.js"));
            paths.push(exe_dir.join("brain-server/mcp-server.js"));
            // dev 模式：target/release/<exe>，需要往上回 3 级到 desktop-daemon/，再到 brain-server/
            paths.push(exe_dir.join("../../../../brain-server/dist/api-server.js"));
            paths.push(exe_dir.join("../../../../brain-server/dist/mcp-server.js"));
            paths.push(exe_dir.join("../../../brain-server/dist/api-server.js"));
            paths.push(exe_dir.join("../../../brain-server/dist/mcp-server.js"));
            // cargo test/debug executables live at
            // <repo>/desktop-daemon/src-tauri/target/debug/deps; the source
            // Brain is five parents above that directory.
            paths.push(exe_dir.join("../../../../../brain-server/dist/api-server.js"));
            paths.push(exe_dir.join("../../../../../brain-server/dist/mcp-server.js"));
        }
    }

    // CWD-based fallback（手动启动场景）
    paths.push(PathBuf::from("./brain-server/dist/api-server.js"));
    paths.push(PathBuf::from("./brain-server/dist/mcp-server.js"));
    paths.push(PathBuf::from("../brain-server/dist/api-server.js"));
    paths.push(PathBuf::from("../brain-server/dist/mcp-server.js"));

    // 用户主目录安装位置
    if let Some(home) = dirs_or_home() {
        paths.push(PathBuf::from(format!(
            "{}/omni-context/brain-server/dist/api-server.js",
            home
        )));
        paths.push(PathBuf::from(format!(
            "{}/omni-context/brain-server/dist/mcp-server.js",
            home
        )));
    }

    paths
}

pub fn open_folder_in_explorer() -> Result<(), String> {
    let path = user_data_dir();
    let _ = std::fs::create_dir_all(&path);

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn open_logs_folder() -> Result<(), String> {
    let path = log_writer::logs_dir();
    let _ = std::fs::create_dir_all(&path);

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
