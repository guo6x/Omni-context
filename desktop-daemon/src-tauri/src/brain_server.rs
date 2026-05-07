use std::process::{Command, Child, Stdio};
use std::sync::Mutex;
use std::path::{Path, PathBuf};

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

pub fn start() -> Result<(), String> {
    if is_running() {
        println!("[Brain Server] 已经运行中");
        return Ok(());
    }

    println!("[Brain Server] 正在启动...");

    // 尝试在不同位置查找 Brain Server
    let possible_paths = brain_server_paths();

    // 尝试直接运行 npm 脚本
    let npm_commands: Vec<Vec<&str>> = vec![
        // 从项目根目录运行
        vec!["npm", "run", "dev", "--prefix", "brain-server"],
        // 从桌面应用目录运行
        vec!["npm", "run", "dev", "--prefix", "../brain-server"],
    ];

    // 获取用户主目录（跨平台兼容）
    let home_path = dirs_or_home();
    if let Some(ref home) = home_path {
        let home_brain = format!("{}/omni-context/brain-server/dist/mcp-server.js", home);
        if Path::new(&home_brain).exists() {
            if let Ok(child) = Command::new("node")
                .arg(&home_brain)
                .env("HOST", "127.0.0.1")
                .env("PORT", "3001")
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
            {
                println!("[Brain Server] 已从用户目录启动: {}", home_brain);
                store_process(child);
                return Ok(());
            }
        }
    }

    for cmd_parts in npm_commands {
        let mut cmd = Command::new(cmd_parts[0]);
        cmd.args(&cmd_parts[1..])
            .env("HOST", "127.0.0.1")
            .env("PORT", "3001")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        match cmd.spawn() {
            Ok(child) => {
                println!("[Brain Server] 已通过 npm 启动");
                store_process(child);
                return Ok(());
            }
            Err(e) => {
                println!("[Brain Server] npm 命令失败: {}", e);
            }
        }
    }

    // 尝试直接运行 JS 文件
    for path in possible_paths {
        if path.exists() {
            match Command::new("node")
                .arg(&path)
                .env("HOST", "127.0.0.1")
                .env("PORT", "3001")
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
            {
                Ok(child) => {
                    println!("[Brain Server] 已启动: {}", path.display());
                    store_process(child);
                    return Ok(());
                }
                Err(e) => {
                    println!("[Brain Server] 启动失败: {}", e);
                }
            }
        }
    }

    Err("无法找到或启动 Brain Server".to_string())
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
    let mut paths = vec![
        PathBuf::from("./brain-server/mcp-server.js"),
        PathBuf::from("./brain-server/dist/mcp-server.js"),
        PathBuf::from("../brain-server/dist/mcp-server.js"),
    ];

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            paths.push(exe_dir.join("brain-server").join("mcp-server.js"));
            paths.push(exe_dir.join("resources").join("brain-server").join("mcp-server.js"));
            paths.push(exe_dir.join("../Resources/brain-server/mcp-server.js"));
        }
    }

    paths
}
