# 📦 Omni-Context 打包指南

这个指南将告诉你如何快速打包 Omni-Context 各个组件，得到可以直接安装和使用的文件。

---

## 🚀 快速开始（推荐）

### 最简单的打包 - 桌面应用（含 Brain Server）

```bash
# 进入项目根目录
cd /workspace

# 运行快速打包脚本
node scripts/build-desktop-only.js
```

这个脚本会：
- ✅ 自动安装依赖
- ✅ 构建 Brain Server 并集成到桌面应用
- ✅ 打包 Tauri 应用
- ✅ 输出安装包

**打包完成后，你会得到：**
- Windows: `.msi` 或 `.exe` 安装包
- macOS: `.dmg` 或 `.app` 应用
- Linux: `.AppImage` 或 `.deb` 安装包

---

## 📦 打包所有组件

如果你想要打包所有组件（桌面、浏览器插件、移动端、硬件文档）：

```bash
cd /workspace
npm install
node scripts/package-all.js
```

输出文件会在 `dist/` 目录中。

---

## 🧹 清理构建缓存

```bash
cd /workspace
node scripts/clean-all.js
```

---

## 📖 详细打包指南

### 1. 桌面应用（含 Brain Server）

**前置要求：**
- Node.js 18+
- Rust 1.75+
- 系统依赖库（根据你的操作系统）

**Windows 系统依赖：**
- Microsoft Visual Studio C++ Build Tools

**macOS 系统依赖：**
```bash
xcode-select --install
```

**Linux 系统依赖（Debian/Ubuntu）：**
```bash
sudo apt install libwebkit2gtk-4.0-dev build-essential curl wget libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

**打包步骤：**

```bash
# 方法 1: 使用快速脚本（推荐）
cd /workspace
node scripts/build-desktop-only.js

# 方法 2: 手动打包
cd desktop-daemon
npm install

# 构建 Brain Server 并集成
cd ../brain-server
npm install
npm run build
cd ../desktop-daemon
mkdir -p brain-server
cp -r ../brain-server/dist/* brain-server/
cp ../brain-server/package.json brain-server/

# 打包应用
npm run build       # 构建前端
npm run tauri build # 打包桌面应用
```

**打包输出位置：**
- Windows: `desktop-daemon/src-tauri/target/release/bundle/msi/*.msi`
- Windows: `desktop-daemon/src-tauri/target/release/bundle/nsis/*.exe`
- macOS: `desktop-daemon/src-tauri/target/release/bundle/macos/*.dmg`
- macOS: `desktop-daemon/src-tauri/target/release/bundle/macos/Omni-Context.app`
- Linux: `desktop-daemon/src-tauri/target/release/bundle/appimage/*.AppImage`
- Linux: `desktop-daemon/src-tauri/target/release/bundle/deb/*.deb`

---

### 2. 浏览器插件

**打包步骤：**

```bash
cd browser-extension
npm install

# 打包 Chrome/Edge 版本
npm run build:chrome

# 打包 Firefox 版本
npm run build:firefox
```

**打包输出位置：**
- Chrome: `browser-extension/build/chrome-mv3-prod/`
- Firefox: `browser-extension/build/firefox-mv2-prod/`

**安装方法：**

**Chrome/Edge:**
1. 打开 `chrome://extensions/`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `chrome-mv3-prod` 目录

**Firefox:**
1. 打开 `about:debugging`
2. 点击"此 Firefox"
3. 点击"临时载入附加组件"
4. 选择 `firefox-mv2-prod/manifest.json`

---

### 3. 移动端应用

**前置要求：**
- Expo CLI
- 对于 Android: Android Studio（可选）
- 对于 iOS: Xcode（仅限 macOS）

**打包步骤（预览版）：**

```bash
cd mobile-app
npm install

# 启动开发服务器（可以在 Expo Go 中预览）
npm start

# 或者使用 EAS Build（需要 Expo 账号）
npm install -g eas-cli
eas build:configure
eas build --platform all
```

**本地构建 Android APK：**

```bash
cd mobile-app
npm run build:android
```

---

### 4. ESP32 硬件固件

硬件固件不是"打包"成安装包的，而是需要上传到 ESP32 开发板。

**方法 1: 使用 PlatformIO（推荐）**

```bash
cd hardware/esp32-firmware

# 安装 PlatformIO
pip install platformio

# 编译并上传
pio run --target upload
```

**方法 2: 使用 Arduino IDE**

1. 安装 Arduino IDE
2. 安装 ESP32 开发板支持
3. 打开 `hardware/esp32-firmware/src/main.ino`
4. 选择正确的开发板和端口
5. 点击上传按钮

---

## 📦 打包输出结构

运行完整打包脚本后，`dist/` 目录会包含：

```
dist/
├── README.md                          # 打包输出说明
├── desktop-app/                      # 桌面应用安装包
│   ├── msi/                          # Windows MSI 安装包
│   ├── nsis/                         # Windows EXE 安装包
│   ├── macos/                        # macOS DMG/APP
│   ├── appimage/                     # Linux AppImage
│   └── deb/                          # Linux DEB 包
├── browser-extension/                # 浏览器插件
│   ├── chrome/                       # Chrome/Edge 插件
│   └── firefox/                      # Firefox 插件
├── brain-server/                     # Brain Server 可执行文件
├── mobile-app/                       # 移动端配置和资源
└── hardware/                         # 硬件文档和固件
```

---

## 🎯 快速参考

### 常用命令速查表

| 任务 | 命令 |
|------|------|
| 安装所有依赖 | `npm run install:all` |
| 快速打包桌面应用 | `node scripts/build-desktop-only.js` |
| 打包所有组件 | `node scripts/package-all.js` |
| 清理构建缓存 | `node scripts/clean-all.js` |
| 桌面开发模式 | `cd desktop-daemon && npm run tauri dev` |
| 浏览器插件开发 | `cd browser-extension && npm run dev` |
| 移动端预览 | `cd mobile-app && npm start` |

---

## ⚠️ 常见问题

### 问题 1: Tauri 打包失败

**原因：** 缺少系统依赖库。

**解决方案：**
```bash
# Linux (Debian/Ubuntu)
sudo apt install libwebkit2gtk-4.0-dev build-essential libssl-dev

# macOS
xcode-select --install

# Windows
# 安装 Visual Studio C++ Build Tools
```

### 问题 2: Brain Server 无法集成

**原因：** Brain Server 没有构建到正确的位置。

**解决方案：**
```bash
cd brain-server
npm install
npm run build

# 复制到 Tauri 应用资源目录
cd ../desktop-daemon
mkdir -p brain-server
cp -r ../brain-server/dist/* brain-server/
```

### 问题 3: Node.js 版本不匹配

**原因：** 版本太低。

**解决方案：**
```bash
# 安装 nvm（推荐）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# 使用 Node.js 18 LTS
nvm install --lts
nvm use --lts
```

---

## 📞 需要帮助？

查看以下文档：
- [BUILDING.md](BUILDING.md) - 完整的构建指南
- [README.md](README.md) - 项目主文档
- [ECOSYSTEM.md](ECOSYSTEM.md) - 生态系统架构

祝你打包顺利！🎉
