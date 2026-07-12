use anyhow::Result;
use base64::{engine::general_purpose::STANDARD, Engine};
use image::ImageFormat;
use screenshots::Screen;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ScreenCaptureResult {
    pub width: u32,
    pub height: u32,
    pub base64_data: String,
    pub display_index: usize,
}

pub async fn capture_screen() -> Result<Vec<u8>> {
    let screens = Screen::all().map_err(|e| anyhow::anyhow!("获取屏幕列表失败: {}", e))?;

    if screens.is_empty() {
        return Err(anyhow::anyhow!("没有可用的显示器"));
    }

    let primary_screen = screens
        .first()
        .ok_or_else(|| anyhow::anyhow!("无法获取主显示器"))?;

    let width = primary_screen.display_info.width;
    let height = primary_screen.display_info.height;

    println!("[ScreenCapture] 捕获屏幕: {}x{}", width, height);

    let image = primary_screen
        .capture()
        .map_err(|e| anyhow::anyhow!("屏幕捕获失败: {}", e))?;

    let buffer = image.rgba();
    let width = image.width();
    let height = image.height();

    let rgba_image = image::RgbaImage::from_raw(width, height, buffer.to_vec())
        .ok_or_else(|| anyhow::anyhow!("创建 RgbaImage 失败"))?;

    let mut png_buffer = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png_buffer);
    rgba_image
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|e| anyhow::anyhow!("PNG 编码失败: {}", e))?;

    println!("[ScreenCapture] 截图成功: {} bytes", png_buffer.len());

    Ok(png_buffer)
}

pub async fn capture_all_screens() -> Result<Vec<ScreenCaptureResult>> {
    let screens = Screen::all().map_err(|e| anyhow::anyhow!("获取屏幕列表失败: {}", e))?;

    if screens.is_empty() {
        return Err(anyhow::anyhow!("没有可用的显示器"));
    }

    let mut results = Vec::new();

    for (index, screen) in screens.iter().enumerate() {
        let width = screen.display_info.width;
        let height = screen.display_info.height;

        println!("[ScreenCapture] 捕获屏幕 {}: {}x{}", index, width, height);

        match screen.capture() {
            Ok(image) => {
                let buffer = image.rgba();
                let width = image.width();
                let height = image.height();

                if let Some(rgba_image) = image::RgbaImage::from_raw(width, height, buffer.to_vec())
                {
                    let mut png_buffer = Vec::new();
                    let mut cursor = std::io::Cursor::new(&mut png_buffer);
                    match rgba_image.write_to(&mut cursor, ImageFormat::Png) {
                        Ok(_) => {
                            let base64_data = STANDARD.encode(&png_buffer);
                            results.push(ScreenCaptureResult {
                                width,
                                height,
                                base64_data,
                                display_index: index,
                            });
                            println!(
                                "[ScreenCapture] 屏幕 {} 截图成功: {} bytes",
                                index,
                                png_buffer.len()
                            );
                        }
                        Err(e) => {
                            println!("[ScreenCapture] 屏幕 {} PNG 编码失败: {}", index, e);
                        }
                    }
                } else {
                    println!("[ScreenCapture] 屏幕 {} 创建 RgbaImage 失败", index);
                }
            }
            Err(e) => {
                println!("[ScreenCapture] 屏幕 {} 捕获失败: {}", index, e);
            }
        }
    }

    if results.is_empty() {
        return Err(anyhow::anyhow!("所有屏幕捕获都失败"));
    }

    Ok(results)
}

pub async fn capture_screen_base64() -> Result<String> {
    let png_data = capture_screen().await?;
    Ok(STANDARD.encode(&png_data))
}

pub async fn capture_screen_region(x: i32, y: i32, width: u32, height: u32) -> Result<Vec<u8>> {
    let screens = Screen::all().map_err(|e| anyhow::anyhow!("获取屏幕列表失败: {}", e))?;

    if screens.is_empty() {
        return Err(anyhow::anyhow!("没有可用的显示器"));
    }

    let primary_screen = screens
        .first()
        .ok_or_else(|| anyhow::anyhow!("无法获取主显示器"))?;

    println!(
        "[ScreenCapture] 捕获区域: ({}, {}) {}x{}",
        x, y, width, height
    );

    let image = primary_screen
        .capture_area(x, y, width, height)
        .map_err(|e| anyhow::anyhow!("区域捕获失败: {}", e))?;

    let buffer = image.rgba();
    let width = image.width();
    let height = image.height();

    let rgba_image = image::RgbaImage::from_raw(width, height, buffer.to_vec())
        .ok_or_else(|| anyhow::anyhow!("创建 RgbaImage 失败"))?;

    let mut png_buffer = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png_buffer);
    rgba_image
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|e| anyhow::anyhow!("PNG 编码失败: {}", e))?;

    println!("[ScreenCapture] 区域截图成功: {} bytes", png_buffer.len());

    Ok(png_buffer)
}
