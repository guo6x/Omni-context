use anyhow::Result;
use arboard::Clipboard;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ClipboardContent {
    pub text: Option<String>,
    pub has_image: bool,
    pub image_size: Option<(usize, usize)>,
}

pub async fn get_clipboard_content() -> Result<Option<String>> {
    let mut clipboard = Clipboard::new()
        .map_err(|e| anyhow::anyhow!("无法访问剪贴板: {}", e))?;
    
    match clipboard.get_text() {
        Ok(text) => {
            println!("[Clipboard] 获取文本内容: {} 字符", text.len());
            Ok(Some(text))
        }
        Err(e) => {
            println!("[Clipboard] 无文本内容或读取失败: {}", e);
            Ok(None)
        }
    }
}

pub async fn get_clipboard_detailed() -> Result<ClipboardContent> {
    let mut clipboard = Clipboard::new()
        .map_err(|e| anyhow::anyhow!("无法访问剪贴板: {}", e))?;
    
    let text = match clipboard.get_text() {
        Ok(t) => {
            println!("[Clipboard] 获取文本内容: {} 字符", t.len());
            Some(t)
        }
        Err(_) => None,
    };
    
    let has_image = match clipboard.get_image() {
        Ok(img) => {
            println!("[Clipboard] 检测到图片: {}x{}", img.width, img.height);
            true
        }
        Err(_) => false,
    };
    
    let image_size = if has_image {
        match clipboard.get_image() {
            Ok(img) => Some((img.width, img.height)),
            Err(_) => None,
        }
    } else {
        None
    };
    
    Ok(ClipboardContent {
        text,
        has_image,
        image_size,
    })
}

pub async fn set_clipboard_text(text: String) -> Result<()> {
    let mut clipboard = Clipboard::new()
        .map_err(|e| anyhow::anyhow!("无法访问剪贴板: {}", e))?;
    
    clipboard.set_text(&text)
        .map_err(|e| anyhow::anyhow!("设置剪贴板文本失败: {}", e))?;
    
    println!("[Clipboard] 设置文本内容: {} 字符", text.len());
    
    Ok(())
}

pub async fn clear_clipboard() -> Result<()> {
    let mut clipboard = Clipboard::new()
        .map_err(|e| anyhow::anyhow!("无法访问剪贴板: {}", e))?;
    
    clipboard.set_text("")
        .map_err(|e| anyhow::anyhow!("清空剪贴板失败: {}", e))?;
    
    println!("[Clipboard] 剪贴板已清空");
    
    Ok(())
}

pub async fn has_clipboard_content() -> Result<bool> {
    let mut clipboard = Clipboard::new()
        .map_err(|e| anyhow::anyhow!("无法访问剪贴板: {}", e))?;
    
    let has_text = clipboard.get_text().is_ok();
    let has_image = clipboard.get_image().is_ok();
    
    Ok(has_text || has_image)
}
