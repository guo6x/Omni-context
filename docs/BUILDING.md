# 打包、运行与发布 Omni-Context

本文档涵盖从环境准备到桌面应用打包、各组件构建，再到正式发版的完整流程。

## 目录

- [前置要求](#前置要求)
- [开发模式](#开发模式)
- [打包桌面应用](#打包桌面应用)
- [打包其他组件](#打包其他组件)
- [完整打包与 dist 结构](#完整打包与-dist-结构)
- [安装和运行](#安装和运行)
- [图标生成](#图标生成)
- [发布新版本](#发布新版本)
- [命令速查](#命令速查)
- [故障排除](#故障排除)
- [应用商店与已知限制](#应用商店与已知限制)

## 前置要求

### 基础工具

- **Node.js 18+** —— JavaScript 运行时
- **Rust 1.75+** —— Rust 编程语言和工具链

### 系统构建工具（按操作系统）

#### Windows
- Microsoft Visual Studio C++ Build Tools

#### macOS
```bash
xcode-select --install
# Rust toolchain（推荐通过 rustup 安装）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustc -V   # 需要 1.75+
```

#### Linux (Ubuntu 22.04 / Debian)
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.0-dev \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
rustc -V   # 需要 1.75+
```

### 安装项目依赖

```bash
git clone https://github.com/guo6x/Omni-context.git
cd Omni-context

# 一次安装所有组件依赖
npm run install:all

# 或按需单独安装
cd desktop-daemon && npm install
cd ../brain-server && npm install
```

## 开发模式

开发模式下应用会自动重新加载：

```bash
cd desktop-daemon
npm run tauri:dev
```

这会同时启动：
1. **Next.js 开发服务器** —— React 前端热重载
2. **Tauri 开发窗口** —— 桌面应用窗口
3. **Brain Server** —— 自动后台启动

## 打包桌面应用

### 一键构建（推荐）

跨平台打包脚本会自动完成 Brain Server 构建、内嵌 Node、前端构建和 Tauri 打包：

```bash
# 在仓库根目录运行
node scripts/build-desktop-only.js
```

脚本会根据当前操作系统自动检测 `node` 二进制名称（Windows: `node.exe`，macOS/Linux: `node`）。

### 单独构建 Tauri

如果 Brain Server 已就绪，只需要 Tauri 打包：

```bash
cd desktop-daemon
npm run tauri:build
```

### 手动打包（理解每一步）

```bash
# 构建 Brain Server 并集成到桌面应用资源目录
cd brain-server
npm install && npm run build
cd ../desktop-daemon
mkdir -p src-tauri/brain-server
cp -r ../brain-server/dist/* src-tauri/brain-server/dist/
cp ../brain-server/package.json src-tauri/brain-server/

# 构建前端 + 打包桌面应用
npm run build
npm run tauri build
```

### 打包产物位置

| 平台 | 产物 |
|------|------|
| Windows | `desktop-daemon/src-tauri/target/release/bundle/msi/*.msi`<br>`desktop-daemon/src-tauri/target/release/bundle/nsis/*.exe` |
| macOS | `desktop-daemon/src-tauri/target/release/bundle/macos/*.app`<br>`desktop-daemon/src-tauri/target/release/bundle/dmg/*.dmg` |
| Linux | `desktop-daemon/src-tauri/target/release/bundle/appimage/*.AppImage`<br>`desktop-daemon/src-tauri/target/release/bundle/deb/*.deb` |

## 打包其他组件

### 浏览器插件

```bash
cd browser-extension
npm install
npm run build:chrome    # Chrome/Edge
npm run build:firefox   # Firefox
```

产物：`browser-extension/build/chrome-mv3-prod/`、`browser-extension/build/firefox-mv2-prod/`

安装（Chrome/Edge）：`chrome://extensions/` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择 `chrome-mv3-prod` 目录。
安装（Firefox）：`about:debugging` →「此 Firefox」→「临时载入附加组件」→ 选择 `firefox-mv2-prod/manifest.json`。

### 移动端应用

前置：Expo CLI；Android 需 Android Studio（可选），iOS 需 Xcode（仅 macOS）。

```bash
cd mobile-app
npm install
npm start                  # Expo Go 中预览
npm run build:android      # 本地构建 Android APK
# 或用 EAS Build（需 Expo 账号）
npm install -g eas-cli && eas build:configure && eas build --platform all
```

### ESP32 硬件固件

固件需上传到 ESP32 开发板，而非打包成安装包。

```bash
cd hardware/esp32-firmware
pip install platformio
pio run --target upload
```

或用 Arduino IDE 打开 `hardware/esp32-firmware/src/main.ino`，选择正确的开发板和端口后上传。

## 完整打包与 dist 结构

一次性打包所有组件：

```bash
npm install
node scripts/package-all.js
```

清理构建缓存：

```bash
node scripts/clean-all.js
```

输出目录结构：

```
dist/
├── README.md                 # 打包输出说明
├── desktop-app/              # 桌面应用安装包
│   ├── msi/ · nsis/          # Windows
│   ├── macos/                # macOS DMG/APP
│   └── appimage/ · deb/      # Linux
├── browser-extension/        # chrome/ · firefox/
├── brain-server/             # Brain Server 可执行文件
├── mobile-app/               # 移动端配置和资源
└── hardware/                 # 硬件文档和固件
```

## 安装和运行

### Windows
- **安装包**：双击 `Omni-Context_<版本>_x64_en-US.msi` 或 `.exe`，按向导操作，在开始菜单启动。
- **直接运行**：`desktop-daemon/src-tauri/target/release/Omni-Context.exe`

### macOS
- **拖拽安装**：将 `Omni-Context.app` 拖到 `Applications` 文件夹后启动。
- **直接运行**：`open desktop-daemon/src-tauri/target/release/bundle/macos/Omni-Context.app`

### Linux
- **AppImage**：`chmod +x *.AppImage && ./Omni-Context_<版本>_amd64.AppImage`
- **DEB 包**：`sudo dpkg -i Omni-Context_<版本>_amd64.deb`

## 图标生成

如果 `src-tauri/icons/` 缺少所需图标文件，需先生成。

```bash
# 方法 1：Node.js 脚本（推荐）
cd desktop-daemon/src-tauri
npm install canvas
node icons/generate-icons.js

# 方法 2：在线工具
# 访问 https://icon.kitchen/ 上传 icons/icon.svg，下载各尺寸 PNG/ICO/ICNS 放回 src-tauri/icons/
```

所需文件：`16/24/32/48/64/72/96/128/256/512` 各尺寸 PNG，以及 `icon.ico`（Windows）、`icon.icns`（macOS）。

## 发布新版本

### 首次配置（仅需一次）

1. **生成签名密钥对**
   ```bash
   cargo install tauri-cli --version "^1.5"
   tauri signer generate -w ~/tauri_priv.key
   ```
   生成 `~/tauri_priv.key`（私钥，**绝对保密，不要提交仓库**）并输出公钥（base64）。

2. **配置公钥**：把公钥贴到 `desktop-daemon/src-tauri/tauri.conf.json` 的 `tauri.updater.pubkey`。

3. **配置 GitHub Secrets**（Settings → Secrets and variables → Actions）：

   | Name | Value |
   |------|-------|
   | `TAURI_PRIVATE_KEY` | `tauri_priv.key` 文件内容（整段 base64，不含换行） |
   | `TAURI_KEY_PASSWORD` | 生成密钥时设置的密码（无密码可留空 `""`） |

4. **配置 updater endpoint**：修改 `tauri.conf.json` 的 `tauri.updater.endpoints` 为
   `https://github.com/<用户名>/<仓库名>/releases/latest/download/latest.json`。

### 发版（自动化，推荐）

推送版本 tag 即触发 `release.yml` 自动构建并发布：

```bash
npm version patch   # 或 minor / major
git push --follow-tags
```

GitHub Actions 会构建 Windows 安装包、生成 `latest.json`（update manifest）并上传到 Release。已安装用户启动后约 30 秒内检测到新版本。

> 多平台安装包（Windows / macOS 双架构 / Linux）的 CI 构建走 `build.yml`，用 `workflow_dispatch` 手动触发或 tag 触发，使用 `tauri.ci.conf.json`（关闭 updater），无需签名密钥即可产出安装包。

### 手动测试自动更新

```bash
# 1. 本地起静态服务器
cd /tmp && python -m http.server 8080
```

2. 构造 `latest.json`（tauri updater manifest 格式），指向本地的安装包 URL；
3. 把 `tauri.conf.json` 的 endpoints 临时指向 `http://localhost:8080/latest.json`；
4. 启动桌面 App，等待约 30 秒应弹出更新 toast。正式环境改回指向 GitHub Releases。

### 更新流程

```
用户启动 → 30s 延迟 → 检查更新 → 有新版本 → 弹 Toast → 用户点击更新
       → 下载 .msi/.exe → 完成后提示重启 → 重启即新版本
```

检查更新失败时静默处理（写日志，不弹窗）。

## 命令速查

| 任务 | 命令 |
|------|------|
| 安装所有依赖 | `npm run install:all` |
| 快速打包桌面应用 | `node scripts/build-desktop-only.js` |
| 打包所有组件 | `node scripts/package-all.js` |
| 清理构建缓存 | `node scripts/clean-all.js` |
| 桌面开发模式 | `cd desktop-daemon && npm run tauri:dev` |
| 桌面打包 | `cd desktop-daemon && npm run tauri:build` |
| 只构建前端 | `cd desktop-daemon && npm run build` |
| 浏览器插件开发 | `cd browser-extension && npm run dev` |
| 移动端预览 | `cd mobile-app && npm start` |

## 故障排除

- **Tauri / 构建失败**：多为缺少系统依赖或 Rust 工具链未装好。按[前置要求](#前置要求)安装对应平台依赖；确认 `rustc -V` ≥ 1.75；建议至少 4GB RAM。
- **Brain Server 无法集成 / 启动**：确认 `brain-server` 已 `npm install && npm run build`，且 `dist/` 已复制到 `desktop-daemon/src-tauri/brain-server/`。
- **图标相关错误**：先运行[图标生成](#图标生成)脚本。
- **Node.js 版本不匹配**：用 nvm 切到 18 LTS（`nvm install --lts && nvm use --lts`）。

## 应用商店与已知限制

- **macOS App Store**：需 Apple Developer ID 签名 + notarize。本期未配置签名（`signingIdentity: null`），产出的 `.dmg` 安装时会有安全警告，需在「系统设置 > 隐私与安全性」手动允许。
- **Windows Store**：需额外打包与签名，参考 Tauri 官方文档。
- **Linux**：AppImage 可直接分发；DEB 包的 `depends` 已在 `tauri.conf.json` 配置。

> **注意**：当前开发者没有 macOS / Linux 设备做真机测试。两平台的打包代码已就绪、CI 也会在对应平台验证，欢迎社区贡献者在真实环境验证并反馈。架构概览见 [ARCHITECTURE.md](ARCHITECTURE.md)。
