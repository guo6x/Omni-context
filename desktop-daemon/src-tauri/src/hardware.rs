use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub ip: String,
    pub last_seen: String,
    pub last_command: String,
    pub packets: u32,
    pub paired: bool,
    pub alias: Option<String>,
}

/// 全局硬件设备注册表：IP -> DeviceInfo
/// UDP listener 每次收包都会更新这里；UI 通过 Tauri 命令读取。
pub static DEVICE_REGISTRY: LazyLock<Mutex<HashMap<String, DeviceInfo>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 把 UNIX 毫秒时间戳转成 ISO 8601 / RFC 3339 字符串（UTC，Z 结尾）。
/// 不引入 chrono 依赖；闰年/天数边界严格按格里历计算。
fn format_iso8601(secs: u64, nanos: u32) -> String {
    // Howard Hinnant 风格 days->civil 算法
    let days = (secs / 86_400) as i64;
    let secs_of_day = secs % 86_400;
    let hour = (secs_of_day / 3_600) as u32;
    let minute = ((secs_of_day % 3_600) / 60) as u32;
    let second = (secs_of_day % 60) as u32;
    let millis = nanos / 1_000_000;

    // 1970-01-01 对应 days = 0
    let z = days + 719_468;
    let era = if z >= 0 { z / 146_097 } else { (z - 146_096) / 146_097 };
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, m, d, hour, minute, second, millis
    )
}

pub fn current_iso8601() -> String {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => format_iso8601(d.as_secs(), d.subsec_nanos()),
        Err(_) => "1970-01-01T00:00:00.000Z".to_string(),
    }
}

/// UDP listener 调用：登记/更新一台设备的最新状态。
/// 保留已配对设备的 paired / alias 字段。
pub fn record_packet(ip: &str, command: &str) {
    let now = current_iso8601();
    let mut guard = match DEVICE_REGISTRY.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    let entry = guard
        .entry(ip.to_string())
        .or_insert_with(|| DeviceInfo {
            ip: ip.to_string(),
            last_seen: now.clone(),
            last_command: command.to_string(),
            packets: 0,
            paired: false,
            alias: None,
        });
    entry.last_seen = now;
    entry.last_command = command.to_string();
    entry.packets = entry.packets.saturating_add(1);
}

#[tauri::command]
pub fn list_hardware_devices() -> Vec<DeviceInfo> {
    let guard = match DEVICE_REGISTRY.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    let mut list: Vec<DeviceInfo> = guard.values().cloned().collect();
    // 按 last_seen 倒序（ISO 8601 字符串可直接字典序比较）
    list.sort_by(|a, b| b.last_seen.cmp(&a.last_seen));
    list
}

#[tauri::command]
pub fn pair_hardware_device(ip: String, alias: Option<String>) -> Result<(), String> {
    let mut guard = match DEVICE_REGISTRY.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    match guard.get_mut(&ip) {
        Some(dev) => {
            dev.paired = true;
            if let Some(a) = alias {
                let trimmed = a.trim();
                dev.alias = if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                };
            }
            Ok(())
        }
        None => Err(format!("设备 {} 不存在", ip)),
    }
}

#[tauri::command]
pub fn unpair_hardware_device(ip: String) -> Result<(), String> {
    let mut guard = match DEVICE_REGISTRY.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    match guard.get_mut(&ip) {
        Some(dev) => {
            dev.paired = false;
            Ok(())
        }
        None => Err(format!("设备 {} 不存在", ip)),
    }
}

#[tauri::command]
pub fn forget_hardware_device(ip: String) -> Result<(), String> {
    let mut guard = match DEVICE_REGISTRY.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    if guard.remove(&ip).is_some() {
        Ok(())
    } else {
        Err(format!("设备 {} 不存在", ip))
    }
}
