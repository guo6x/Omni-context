use crate::brain_server;
use crate::SystemStatus;
use crate::screen_capture;
use crate::clipboard;
use base64::{engine::general_purpose::STANDARD, Engine};

#[tauri::command]
pub async fn start_listening() -> Result<String, String> {
    Ok("监听已启动".to_string())
}

#[tauri::command]
pub async fn capture_screen() -> Result<String, String> {
    match screen_capture::capture_screen_base64().await {
        Ok(base64_data) => Ok(base64_data),
        Err(e) => Err(format!("屏幕捕获失败: {}", e)),
    }
}

#[tauri::command]
pub async fn capture_all_screens() -> Result<Vec<screen_capture::ScreenCaptureResult>, String> {
    match screen_capture::capture_all_screens().await {
        Ok(results) => Ok(results),
        Err(e) => Err(format!("多屏幕捕获失败: {}", e)),
    }
}

#[tauri::command]
pub async fn capture_screen_region(x: i32, y: i32, width: u32, height: u32) -> Result<String, String> {
    match screen_capture::capture_screen_region(x, y, width, height).await {
        Ok(png_data) => Ok(STANDARD.encode(&png_data)),
        Err(e) => Err(format!("区域捕获失败: {}", e)),
    }
}

#[tauri::command]
pub async fn get_clipboard() -> Result<String, String> {
    match clipboard::get_clipboard_content().await {
        Ok(Some(text)) => Ok(text),
        Ok(None) => Ok("".to_string()),
        Err(e) => Err(format!("读取剪贴板失败: {}", e)),
    }
}

#[tauri::command]
pub async fn get_clipboard_detailed() -> Result<clipboard::ClipboardContent, String> {
    match clipboard::get_clipboard_detailed().await {
        Ok(content) => Ok(content),
        Err(e) => Err(format!("读取剪贴板详情失败: {}", e)),
    }
}

#[tauri::command]
pub async fn set_clipboard(text: String) -> Result<String, String> {
    match clipboard::set_clipboard_text(text).await {
        Ok(_) => Ok("剪贴板已更新".to_string()),
        Err(e) => Err(format!("设置剪贴板失败: {}", e)),
    }
}

#[tauri::command]
pub async fn clear_clipboard() -> Result<String, String> {
    match clipboard::clear_clipboard().await {
        Ok(_) => Ok("剪贴板已清空".to_string()),
        Err(e) => Err(format!("清空剪贴板失败: {}", e)),
    }
}

#[tauri::command]
pub async fn send_to_brain_server(data: String) -> Result<String, String> {
    Ok(format!("已发送到 Brain Server: {}", data))
}

#[tauri::command]
pub fn get_system_status() -> SystemStatus {
    SystemStatus {
        brain_server_running: brain_server::is_running(),
        udp_listener_running: true,
        last_event: None,
    }
}

#[tauri::command]
pub fn start_brain_server() -> Result<String, String> {
    brain_server::start()?;
    Ok("Brain Server 已启动".to_string())
}

#[tauri::command]
pub fn stop_brain_server() -> Result<String, String> {
    brain_server::stop()?;
    Ok("Brain Server 已停止".to_string())
}

#[tauri::command]
pub fn restart_brain_server() -> Result<String, String> {
    brain_server::restart()?;
    Ok("Brain Server 已重启".to_string())
}

#[tauri::command]
pub async fn trigger_precipitate() -> Result<String, String> {
    println!("[Command] 触发沉淀操作");
    
    match screen_capture::capture_screen_base64().await {
        Ok(base64_data) => {
            println!("[Command] 屏幕捕获成功: {} 字符", base64_data.len());
        }
        Err(e) => {
            println!("[Command] 屏幕捕获失败: {}", e);
        }
    }
    
    match clipboard::get_clipboard_content().await {
        Ok(Some(text)) => {
            println!("[Command] 剪贴板内容: {} 字符", text.len());
        }
        Ok(None) => {
            println!("[Command] 剪贴板为空");
        }
        Err(e) => {
            println!("[Command] 读取剪贴板失败: {}", e);
        }
    }
    
    Ok("沉淀操作已触发".to_string())
}

#[tauri::command]
pub async fn trigger_decision() -> Result<String, String> {
    println!("[Command] 触发决策查询");
    Ok("决策查询已触发".to_string())
}

#[tauri::command]
pub async fn trigger_reset() -> Result<String, String> {
    println!("[Command] 触发重置");
    Ok("重置操作已触发".to_string())
}
