# Omni-Context 应用图标

## 文件

- `icon.svg` —— **唯一的设计源文件**，所有 PNG/ICO/ICNS 都从它渲染。
- `generate-icons.js` —— 跨平台图标生成脚本，覆盖：
  - Tauri 桌面端（多尺寸 PNG + Windows Store Square*Logo + 多分辨率 .ico + .icns 占位符）
  - 浏览器扩展（`browser-extension/icons/icon{16,48,128}.png`）
  - 移动端 Expo（`mobile-app/assets/{icon,adaptive-icon,favicon}.png`）

## 重新生成

需要 Node 18+：

```bash
cd desktop-daemon/src-tauri/icons
npm install --no-save @resvg/resvg-js@2.6.2 png-to-ico
node generate-icons.js
```

`@resvg/resvg-js` 是纯 JS 渲染器（无 native 编译，跨平台），生成完不需要保留为依赖。

## 设计

- **概念**：记忆环 —— 双层圆 + 6 个节点环绕一个发光核心，呼应"全域记忆 / 知识图谱节点"
- **色彩**：青色 `#00f2fe` 主体环 / 紫色 `#7000ff` 周边节点 / 白色高光核心
- **底**：深色径向渐变 + iOS 风格圆角（`rx=112` on 512px canvas）
- **可读性**：在 16/32 等小尺寸下，外环和中心高光仍然能识别

## macOS .icns

当前 `icon.icns` 是一个 1024px PNG 占位符。在 macOS 上做正式打包前，需要在 Mac 机器上用以下命令生成正规多分辨率 .icns：

```bash
mkdir Omni.iconset
sips -z 16 16     icon.png --out Omni.iconset/icon_16x16.png
sips -z 32 32     icon.png --out Omni.iconset/icon_16x16@2x.png
sips -z 32 32     icon.png --out Omni.iconset/icon_32x32.png
sips -z 64 64     icon.png --out Omni.iconset/icon_32x32@2x.png
sips -z 128 128   icon.png --out Omni.iconset/icon_128x128.png
sips -z 256 256   icon.png --out Omni.iconset/icon_128x128@2x.png
sips -z 256 256   icon.png --out Omni.iconset/icon_256x256.png
sips -z 512 512   icon.png --out Omni.iconset/icon_256x256@2x.png
sips -z 512 512   icon.png --out Omni.iconset/icon_512x512.png
cp icon.png       Omni.iconset/icon_512x512@2x.png
iconutil -c icns Omni.iconset -o icon.icns
```
