use std::process::{Command, Child, Stdio};
use std::sync::Mutex;
use std::path::PathBuf;

/// [核心壁垒] Brain Server 进程管理器
/// 使用 Mutex 替代 unsafe static mut，确保多线程安全
static BRAIN_SERVER_PROCESS: std::sync::LazyLock<Mutex<Option<Child>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));

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

/// 查找 node 可执行文件：优先用安装包内嵌的 node.exe，
/// 找不到时回退到 PATH 里的系统 node。
fn find_node_executable() -> String {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidates = [
                exe_dir.join("resources/brain-server/node.exe"),
                exe_dir.join("brain-server/node.exe"),
                exe_dir.join("../Resources/brain-server/node.exe"),
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
    if is_running() {
        println!("[Brain Server] 已经运行中");
        return Ok(());
    }

    println!("[Brain Server] 正在启动...");

    let node_exe = find_node_executable();
    println!("[Brain Server] 使用 node: {}", node_exe);

    let candidates = brain_server_paths();
    let mut tried: Vec<String> = Vec::new();

    // 直接 node <path>。spawn 成功不代表进程没立刻 exit，所以
    // 加 800ms 探测：try_wait 仍为 None 才认为真启动了。
    for path in &candidates {
        tried.push(path.display().to_string());
        if !path.exists() {
            continue;
        }

        let spawn_result = Command::new(&node_exe)
            .arg(path)
            .env("HOST", "127.0.0.1")
            .env("PORT", "3001")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();

        match spawn_result {
            Ok(mut child) => {
                std::thread::sleep(std::time::Duration::from_millis(800));
                match child.try_wait() {
                    Ok(None) => {
                        println!("[Brain Server] 已启动: {}", path.display());
                        store_process(child);
                        return Ok(());
                    }
                    Ok(Some(status)) => {
                        eprintln!(
                            "[Brain Server] node {} 立刻退出（status: {}），尝试下一个候选",
                            path.display(),
                            status
                        );
                    }
                    Err(e) => {
                        eprintln!("[Brain Server] try_wait 失败: {}", e);
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

fn brain_server_paths() -> Vec<PathBuf> {
    // 编译产物是 dist/mcp-server.js（不是顶层 mcp-server.js）。
    // Tauri 通过 resources: ["../../brain-server/**/*"] 把整个 brain-server
    // 目录拷到安装目录的 resources/brain-server/ 下，所以安装包里的真正路径是
    // <exe-dir>/resources/brain-server/dist/mcp-server.js。
    let mut paths: Vec<PathBuf> = Vec::new();

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            // Windows MSI/NSIS / Linux：<exe-dir>/resources/brain-server/dist/mcp-server.js
            paths.push(exe_dir.join("resources/brain-server/dist/mcp-server.js"));
            paths.push(exe_dir.join("resources/brain-server/mcp-server.js"));
            // macOS app bundle: <exe>/Contents/MacOS/<app> → ../Resources/brain-server/...
            paths.push(exe_dir.join("../Resources/brain-server/dist/mcp-server.js"));
            // Tauri externalBin / sidecar 风格
            paths.push(exe_dir.join("brain-server/dist/mcp-server.js"));
            // dev 模式：target/release/<exe>，需要往上回 3 级到 desktop-daemon/，再到 brain-server/
            paths.push(exe_dir.join("../../../../brain-server/dist/mcp-server.js"));
            paths.push(exe_dir.join("../../../brain-server/dist/mcp-server.js"));
        }
    }

    // CWD-based fallback（手动启动场景）
    paths.push(PathBuf::from("./brain-server/dist/mcp-server.js"));
    paths.push(PathBuf::from("../brain-server/dist/mcp-server.js"));

    // 用户主目录安装位置
    if let Some(home) = dirs_or_home() {
        paths.push(PathBuf::from(format!(
            "{}/omni-context/brain-server/dist/mcp-server.js",
            home
        )));
    }

    paths
}
