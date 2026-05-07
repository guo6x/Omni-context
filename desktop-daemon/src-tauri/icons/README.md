# Omni-Context 应用图标

## 图标说明

`icon.svg` - SVG 版本的完整应用图标（用于参考）

## 生成图标

要生成所有尺寸的图标文件，请运行：

```bash
cd src-tauri
npm install canvas
node icons/generate-icons.js
```

或者你可以使用在线工具：
1. https://convertico.com/
2. https://icon.kitchen/
3. https://www.icoconverter.com/

## 所需图标文件

Tauri 应用需要以下尺寸的图标：
- 16x16.png
- 24x24.png
- 32x32.png
- 48x48.png
- 64x64.png
- 128x128.png
- 256x256.png
- 512x512.png

还有：
- icon.ico (Windows)
- icon.icns (macOS)

## 设计理念

- 深色背景，符合黑客美学
- 六边形表示知识图谱
- 中心大脑图标表示 AI 记忆
- 青色和紫色霓虹效果
- 周围节点表示知识图谱节点
