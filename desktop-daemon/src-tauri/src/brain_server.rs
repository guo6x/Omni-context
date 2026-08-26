use std::io::{BufRead, Read, Write};
use std::net::{SocketAddr, TcpStream};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

use crate::log_writer;

/// Windows CREATE_NO_WINDOW —— 防止 spawn node.exe 时弹出黑色控制台窗口
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// [核心壁垒] Brain Server 进程管理器
/// 使用 Mutex 替代 unsafe static mut，确保多线程安全
static BRAIN_SERVER_PROCESS: std::sync::LazyLock<Mutex<Option<Child>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));
static BRAIN_SERVER_STARTING: AtomicBool = AtomicBool::new(false);

/// The production Brain transport is loopback-only. D1B1's real Desktop
/// harness may select an isolated loopback port through `OMNI_BRAIN_PORT` so
/// it never has to claim an unrelated application's listener. The value is
/// deliberately a port number rather than a URL/host override.
pub const DEFAULT_BRAIN_PORT: u16 = 3001;

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

    if let Some(ref mut child) = *guard {
        // try_wait 返回 Ok(None) 表示进程仍在运行
        match child.try_wait() {
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
    is_running() && health_check(Duration::from_millis(350))
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

    let mut buf = [0_u8; 256];
    match stream.read(&mut buf) {
        Ok(n) if n > 0 => String::from_utf8_lossy(&buf[..n]).contains("200 OK"),
        _ => false,
    }
}

fn wait_for_health(child: &mut Child, timeout: Duration) -> Result<(), String> {
    let started = Instant::now();
    while started.elapsed() < timeout {
        match child.try_wait() {
            Ok(None) => {
                if health_check(Duration::from_millis(700)) {
                    return Ok(());
                }
            }
            Ok(Some(status)) => {
                return Err(format!("进程启动后退出（status: {}）", status));
            }
            Err(e) => {
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
    if is_ready() {
        println!("[Brain Server] 已经运行中");
        return Ok(());
    }

    if BRAIN_SERVER_STARTING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(65) {
            if is_ready() {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        return Err("Brain Server 正在启动，但 65 秒内仍未就绪".to_string());
    }

    let result = start_inner();
    BRAIN_SERVER_STARTING.store(false, Ordering::Release);
    result
}

fn start_inner() -> Result<(), String> {
    // A Brain/Desktop restart invalidates any previously persisted CLI session.
    clear_control_session();
    // 先杀掉上一次遗留的 zombie 进程（防止配置的回环端口被占用）
    kill_zombie_by_pid_file();

    if is_ready() {
        println!("[Brain Server] 已经运行中");
        return Ok(());
    }

    if is_running() {
        eprintln!("[Brain Server] 进程存在但 /health 未就绪，先停止后重新启动");
        let _ = stop();
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
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let spawn_result = cmd.spawn();

        match spawn_result {
            Ok(mut child) => {
                // 要在 store_process 之前取出 stdout/stderr，否则 move 后拿不到。
                // 立即接日志，避免冷启动等待期间没有任何可诊断输出。
                let stdout = child.stdout.take();
                let stderr = child.stderr.take();
                pipe_output_to_log(stdout, stderr);

                match wait_for_health(&mut child, Duration::from_secs(60)) {
                    Ok(()) => {
                        println!("[Brain Server] 已启动: {}", path.display());

                        // 写入 PID 文件，下次启动时可清理 zombie
                        let pid = child.id();
                        let _ = std::fs::write(pid_file_path(), pid.to_string());

                        store_process(child);
                        return Ok(());
                    }
                    Err(e) => {
                        eprintln!(
                            "[Brain Server] node {} 未就绪：{}，尝试下一个候选",
                            path.display(),
                            e
                        );
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
            Err(e) => {
                eprintln!(
                    "[Brain Server] spawn 失败 at {}: {}（可能 node 不在 PATH）",
                    path.display(),
                    e
                );
            }
        }
    }

    Err(format!(
        "无法启动 Brain Server。\n  使用 node: {}\n  已尝试 JS 入口：\n    {}\n请确认：(1) node 可执行（系统 PATH 或内嵌均可）；(2) brain-server/dist 已构建。",
        node_exe,
        tried.join("\n    ")
    ))
}

pub fn stop() -> Result<(), String> {
    let mut guard = BRAIN_SERVER_PROCESS
        .lock()
        .map_err(|e| format!("锁获取失败: {}", e))?;

    if let Some(mut child) = guard.take() {
        child.kill().map_err(|e| format!("终止进程失败: {}", e))?;
        // 等待进程退出，回收资源
        let _ = child.wait();
        // 清理 PID 文件
        let _ = std::fs::remove_file(pid_file_path());
        clear_control_session();
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
    let guard = BRAIN_SERVER_PROCESS.lock().ok()?;
    guard.as_ref().map(|child| child.id())
}

fn store_process(child: Child) {
    let mut guard = match BRAIN_SERVER_PROCESS.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    *guard = Some(child);
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

pub fn clear_control_session() {
    let _ = std::fs::remove_file(control_session_file());
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

/// 读取 PID 文件并尝试杀掉 zombie brain-server 进程
fn kill_zombie_by_pid_file() {
    let pid_path = pid_file_path();
    if let Ok(pid_str) = std::fs::read_to_string(&pid_path) {
        if let Ok(pid) = pid_str.trim().parse::<u32>() {
            #[cfg(windows)]
            {
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/PID", &pid.to_string()])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }
            #[cfg(not(windows))]
            {
                let _ = std::process::Command::new("kill")
                    .args(["-9", &pid.to_string()])
                    .output();
            }
        }
        let _ = std::fs::remove_file(&pid_path);
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
