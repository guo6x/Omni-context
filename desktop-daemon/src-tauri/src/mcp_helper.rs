use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[derive(Serialize)]
pub struct ClientStatus {
    pub id: String,
    pub name: String,
    pub config_path: String,
    pub installed: bool,
    pub configured: bool,
}

#[derive(Serialize)]
pub struct ServerCommand {
    pub command: String,
    pub args: Vec<String>,
}

fn resolve_home_path(path_str: &str) -> Option<PathBuf> {
    if path_str.starts_with('~') {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .ok()?;
        Some(
            PathBuf::from(home).join(
                path_str
                    .trim_start_matches('~')
                    .trim_start_matches('/')
                    .trim_start_matches('\\'),
            ),
        )
    } else if path_str.contains("%APPDATA%") {
        let appdata = std::env::var("APPDATA").ok()?;
        let resolved = path_str.replace("%APPDATA%", &appdata);
        Some(PathBuf::from(resolved))
    } else if path_str.contains("%USERPROFILE%") {
        let userprofile = std::env::var("USERPROFILE").ok()?;
        let resolved = path_str.replace("%USERPROFILE%", &userprofile);
        Some(PathBuf::from(resolved))
    } else {
        Some(PathBuf::from(path_str))
    }
}

/// Claude Desktop on Windows：MSIX/商店版实际读 LocalCache 下的路径，而非 %APPDATA%。
/// 写错位置会被静默忽略（官方已知问题），这里优先返回 MSIX 路径。
#[cfg(target_os = "windows")]
fn claude_desktop_config_path_windows() -> PathBuf {
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let packages = PathBuf::from(&local).join("Packages");
        if let Ok(entries) = fs::read_dir(&packages) {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().starts_with("Claude") {
                    return entry
                        .path()
                        .join("LocalCache")
                        .join("Roaming")
                        .join("Claude")
                        .join("claude_desktop_config.json");
                }
            }
        }
    }
    // 回退：经典 .exe 安装
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    PathBuf::from(appdata)
        .join("Claude")
        .join("claude_desktop_config.json")
}

pub fn get_config_path(client_id: &str) -> Option<PathBuf> {
    // Claude Desktop on Windows 走 MSIX 感知的特殊处理
    #[cfg(target_os = "windows")]
    if client_id == "claude" {
        return Some(claude_desktop_config_path_windows());
    }
    let raw_path = match client_id {
        "claude" => {
            #[cfg(target_os = "windows")]
            {
                "%APPDATA%\\Claude\\claude_desktop_config.json"
            }
            #[cfg(not(target_os = "windows"))]
            {
                "~/Library/Application Support/Claude/claude_desktop_config.json"
            }
        }
        "cursor" => "~/.cursor/mcp.json",
        "cline" => {
            #[cfg(target_os = "windows")]
            {
                "%APPDATA%\\Code\\User\\globalStorage\\saoudrizwan.claude-dev\\settings\\cline_mcp_settings.json"
            }
            #[cfg(not(target_os = "windows"))]
            {
                "~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json"
            }
        }
        "roo" => {
            #[cfg(target_os = "windows")]
            {
                "%APPDATA%\\Code\\User\\globalStorage\\rooveterinaryinc.roo-cline\\settings\\cline_mcp_settings.json"
            }
            #[cfg(not(target_os = "windows"))]
            {
                "~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json"
            }
        }
        "windsurf" => {
            #[cfg(target_os = "windows")]
            {
                "%USERPROFILE%\\.codeium\\windsurf\\mcp_config.json"
            }
            #[cfg(not(target_os = "windows"))]
            {
                "~/.codeium/windsurf/mcp_config.json"
            }
        }
        "trae" => "~/.trae/mcp.json",
        "lmstudio" => {
            #[cfg(target_os = "windows")]
            {
                "%USERPROFILE%\\.lmstudio\\mcp.json"
            }
            #[cfg(not(target_os = "windows"))]
            {
                "~/.lmstudio/mcp.json"
            }
        }
        "continue" => {
            #[cfg(target_os = "windows")]
            {
                "%USERPROFILE%\\.continue\\config.json"
            }
            #[cfg(not(target_os = "windows"))]
            {
                "~/.continue/config.json"
            }
        }
        "zed" => "~/.config/zed/settings.json",
        "goose" => "~/.config/goose/config.yaml",
        "cherrystudio" => {
            #[cfg(target_os = "windows")]
            {
                "%APPDATA%\\CherryStudio"
            }
            #[cfg(not(target_os = "windows"))]
            {
                "~/Library/Application Support/CherryStudio"
            }
        }
        "chatbox" => {
            #[cfg(target_os = "windows")]
            {
                "%APPDATA%\\xyz.chatboxapp.app"
            }
            #[cfg(not(target_os = "windows"))]
            {
                "~/Library/Application Support/xyz.chatboxapp.app"
            }
        }
        _ => return None,
    };
    resolve_home_path(raw_path)
}

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
    "node".to_string()
}

fn find_proxy_js_path() -> String {
    let mut paths = Vec::new();
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            paths.push(exe_dir.join("resources/brain-server/dist/mcp-proxy.js"));
            paths.push(exe_dir.join("resources/brain-server/mcp-proxy.js"));
            paths.push(exe_dir.join("../Resources/brain-server/dist/mcp-proxy.js"));
            paths.push(exe_dir.join("brain-server/dist/mcp-proxy.js"));
            paths.push(exe_dir.join("brain-server/mcp-proxy.js"));
            // dev 模式
            paths.push(exe_dir.join("../../../../brain-server/dist/mcp-proxy.js"));
            paths.push(exe_dir.join("../../../brain-server/dist/mcp-proxy.js"));
        }
    }

    paths.push(PathBuf::from("./brain-server/dist/mcp-proxy.js"));
    paths.push(PathBuf::from("../brain-server/dist/mcp-proxy.js"));

    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        paths.push(PathBuf::from(format!(
            "{}/omni-context/brain-server/dist/mcp-proxy.js",
            home
        )));
    }

    for p in paths {
        if p.exists() {
            return p.to_string_lossy().into_owned();
        }
    }

    "mcp-proxy.js".to_string()
}

pub fn get_mcp_server_command() -> ServerCommand {
    ServerCommand {
        command: find_node_executable(),
        args: vec![find_proxy_js_path()],
    }
}

pub fn get_mcp_clients_status() -> Vec<ClientStatus> {
    let clients = vec![
        ("claude", "Claude Desktop"),
        ("cursor", "Cursor"),
        ("cline", "Cline"),
        ("roo", "Roo Code"),
        ("windsurf", "Windsurf"),
        ("trae", "Trae"),
        ("lmstudio", "LM Studio"),
        ("continue", "Continue.dev"),
        ("zed", "Zed"),
        ("goose", "Goose"),
        ("cherrystudio", "Cherry Studio"),
        ("chatbox", "ChatBox"),
    ];

    let mut statuses = Vec::new();

    for (id, name) in clients {
        let config_path = get_config_path(id);
        let path_str = config_path
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();

        let mut installed = false;
        let mut configured = false;

        if let Some(ref path) = config_path {
            if path.exists() {
                installed = true;

                // 只有一键配置的文件才支持检测配置状态
                if id != "zed" && id != "goose" && id != "cherrystudio" && id != "chatbox" {
                    if let Ok(content) = fs::read_to_string(path) {
                        if let Ok(json) = serde_json::from_str::<Value>(&content) {
                            if id == "continue" {
                                if let Some(exp) = json.get("experimental") {
                                    if let Some(servers) = exp.get("modelContextProtocolServers") {
                                        if servers.get("omni-context").is_some() {
                                            configured = true;
                                        }
                                    }
                                }
                            } else {
                                if let Some(servers) = json.get("mcpServers") {
                                    if servers.get("omni-context").is_some() {
                                        configured = true;
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                // 如果是目录，存在即为 installed
                if id == "cherrystudio" || id == "chatbox" {
                    if let Some(parent) = path.parent() {
                        if parent.exists() {
                            installed = true;
                        }
                    }
                } else {
                    // 若父目录存在，或者我们在常用地方判定装过，但这里还是以 config 文件或其父目录是否存在判定为准
                    if let Some(parent) = path.parent() {
                        if parent.exists() {
                            installed = true;
                        }
                    }
                }
            }
        }

        statuses.push(ClientStatus {
            id: id.to_string(),
            name: name.to_string(),
            config_path: path_str,
            installed,
            configured,
        });
    }

    statuses
}

pub fn install_mcp_to(client_id: &str) -> Result<(), String> {
    let path = get_config_path(client_id)
        .ok_or_else(|| format!("未找到该客户端的配置路径: {}", client_id))?;

    if client_id == "zed"
        || client_id == "goose"
        || client_id == "cherrystudio"
        || client_id == "chatbox"
    {
        return Err("该客户端不支持一键写入，请按照接入步骤手动配置".to_string());
    }

    // 自动创建父目录
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建配置文件夹失败: {}", e))?;
    }

    let mut json_val: Value = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| format!("读取配置文件失败: {}", e))?;
        if content.trim().is_empty() {
            Value::Object(serde_json::Map::new())
        } else {
            serde_json::from_str(&content)
                .map_err(|e| format!("解析配置文件失败，可能存在 JSON 语法错误: {}", e))?
        }
    } else {
        Value::Object(serde_json::Map::new())
    };

    let node_path = find_node_executable();
    let proxy_path = find_proxy_js_path();

    if client_id == "continue" {
        // Continue.dev 结构
        if !json_val.is_object() {
            json_val = Value::Object(serde_json::Map::new());
        }

        let obj = json_val.as_object_mut().unwrap();
        if !obj.contains_key("experimental") {
            obj.insert(
                "experimental".to_string(),
                Value::Object(serde_json::Map::new()),
            );
        }

        let exp = obj
            .get_mut("experimental")
            .unwrap()
            .as_object_mut()
            .ok_or("experimental 字段类型错误，请检查配置文件")?;

        if !exp.contains_key("modelContextProtocolServers") {
            exp.insert(
                "modelContextProtocolServers".to_string(),
                Value::Object(serde_json::Map::new()),
            );
        }

        let servers = exp
            .get_mut("modelContextProtocolServers")
            .unwrap()
            .as_object_mut()
            .ok_or("modelContextProtocolServers 字段类型错误，请检查配置文件")?;

        servers.insert(
            "omni-context".to_string(),
            serde_json::json!({
                "command": node_path,
                "args": [proxy_path]
            }),
        );
    } else {
        // 通用 mcpServers 结构
        if !json_val.is_object() {
            json_val = Value::Object(serde_json::Map::new());
        }

        let obj = json_val.as_object_mut().unwrap();
        if !obj.contains_key("mcpServers") {
            obj.insert(
                "mcpServers".to_string(),
                Value::Object(serde_json::Map::new()),
            );
        }

        let servers = obj
            .get_mut("mcpServers")
            .unwrap()
            .as_object_mut()
            .ok_or("mcpServers 字段类型错误，请检查配置文件")?;

        servers.insert(
            "omni-context".to_string(),
            serde_json::json!({
                "command": node_path,
                "args": [proxy_path]
            }),
        );
    }

    let pretty_content =
        serde_json::to_string_pretty(&json_val).map_err(|e| format!("序列化配置失败: {}", e))?;

    fs::write(&path, pretty_content).map_err(|e| format!("写入配置文件失败: {}", e))?;

    Ok(())
}

pub fn open_config_folder(client_id: &str) -> Result<(), String> {
    let path = get_config_path(client_id)
        .ok_or_else(|| format!("未找到该客户端的配置路径: {}", client_id))?;

    let dir = if path.is_file() {
        path.parent().unwrap_or(&path)
    } else {
        &path
    };

    if !dir.exists() {
        let _ = fs::create_dir_all(dir);
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_mcp_server_command() {
        let cmd = get_mcp_server_command();
        println!("--- MCP Server Command Test ---");
        println!("Node path: {}", cmd.command);
        println!("Proxy path: {:?}", cmd.args);
        assert!(!cmd.command.is_empty());
        assert!(!cmd.args.is_empty());
    }

    #[test]
    fn test_get_mcp_clients_status() {
        let statuses = get_mcp_clients_status();
        println!("--- MCP Clients Status Test ---");
        for s in &statuses {
            println!(
                "Client {}: installed={}, configured={}, path={}",
                s.id, s.installed, s.configured, s.config_path
            );
        }
        assert!(!statuses.is_empty());
    }

    #[test]
    fn test_install_mcp_to_claude() {
        let path = get_config_path("claude").unwrap();
        // 如果文件已存在，先备份
        let backup_path = path.with_extension("json.bak");
        let existed = path.exists();
        if existed {
            fs::copy(&path, &backup_path).unwrap();
        }

        println!("--- MCP Install to Claude Test ---");
        let result = install_mcp_to("claude");
        assert!(result.is_ok(), "Install failed: {:?}", result);

        // 验证状态是否变为 configured=true
        let statuses = get_mcp_clients_status();
        let claude_status = statuses.iter().find(|s| s.id == "claude").unwrap();
        assert!(
            claude_status.configured,
            "Claude should be marked as configured"
        );

        // 验证文件内容
        let content = fs::read_to_string(&path).unwrap();
        println!("Generated Claude Config Content:\n{}", content);

        let json: serde_json::Value = serde_json::from_str(&content).unwrap();
        let cmd = json.pointer("/mcpServers/omni-context/command").unwrap();
        let args = json.pointer("/mcpServers/omni-context/args").unwrap();

        assert!(cmd.is_string());
        assert!(args.is_array());
        println!("Verified JSON format: command={}, args={:?}", cmd, args);

        // 恢复或清理
        if existed {
            fs::copy(&backup_path, &path).unwrap();
            fs::remove_file(&backup_path).ok();
        } else {
            fs::remove_file(&path).ok();
            // 尝试移除空的父目录
            if let Some(parent) = path.parent() {
                let _ = fs::remove_dir(parent); // 如果是空目录就删掉
            }
        }
    }
}
