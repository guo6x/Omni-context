use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use chrono::Utc;

const MAX_LOG_SIZE: u64 = 5 * 1024 * 1024; // 5MB

static LOG_MUTEX: std::sync::LazyLock<Mutex<()>> = std::sync::LazyLock::new(|| Mutex::new(()));

pub fn logs_dir() -> PathBuf {
    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        PathBuf::from(local_appdata).join("omni-context").join("logs")
    } else if let Ok(home) = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
    {
        PathBuf::from(home).join(".omni-context").join("logs")
    } else {
        PathBuf::from("./logs")
    }
}

pub fn log_file_path() -> PathBuf {
    logs_dir().join("brain-server.log")
}

/// 写入一行日志，线程安全。失败时静默 swallow。
pub fn write_line(log_path: &PathBuf, line: &str, is_stderr: bool) {
    let _lock = match LOG_MUTEX.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };

    let dir = match log_path.parent() {
        Some(d) => d,
        None => return,
    };

    // 确保日志目录存在
    let _ = fs::create_dir_all(dir);

    // 写入前检查大小，超过 5MB 触发轮转
    rotate_if_needed(log_path, dir);

    let ts = Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
    let prefix = if is_stderr { "[STDERR] " } else { "" };
    let formatted = format!("[{}] {}{}\n", ts, prefix, line);

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = file.write_all(formatted.as_bytes());
        let _ = file.flush();
    }
}

/// 轮转：brain-server.log → brain-server.log.1 → brain-server.log.2（最多 3 份）
fn rotate_if_needed(log_path: &PathBuf, dir: &std::path::Path) {
    if let Ok(meta) = fs::metadata(log_path) {
        if meta.len() >= MAX_LOG_SIZE {
            let _ = fs::remove_file(dir.join("brain-server.log.2"));
            let _ = fs::rename(dir.join("brain-server.log.1"), dir.join("brain-server.log.2"));
            let _ = fs::rename(log_path, dir.join("brain-server.log.1"));
        }
    }
}
