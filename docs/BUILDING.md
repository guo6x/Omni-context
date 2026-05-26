# 打包和运行 Omni-Context 桌面应用

## 目录

- [前置要求](#前置要求)
- [开发模式](#开发模式)
- [打包应用](#打包应用)
- [安装和运行](#安装和运行)
- [图标生成](#图标生成)

## 前置要求

在开始之前，确保你已经安装了：

### 基础工具

- **Node.js 18+** - JavaScript 运行时
- **Rust 1.75+** - Rust 编程语言和工具链
- **系统构建工具** - 根据你的操作系统：

#### Windows
- Microsoft Visual Studio C++ Build Tools

#### macOS
- Xcode Command Line Tools:
  ```bash
  xcode-select --install
  ```
- Rust toolchain（推荐通过 rustup 安装）:
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  # 重启终端后确认
  rustc -V   # 需要 1.75+
  ```

#### Linux (Ubuntu 22.04 / Debian)
- 系统依赖库：
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
  ```
- Rust toolchain:
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  source ~/.cargo/env
  rustc -V   # 需要 1.75+
  ```

### 安装项目依赖

```bash
# 克隆项目
git clone <repository-url>
cd omni-context

# 安装桌面应用依赖
cd desktop-daemon
npm install

# 安装 Brain Server 依赖
cd ../brain-server
npm install
```

## 开发模式

在开发模式下，应用会自动重新加载：

```bash
cd desktop-daemon
npm run tauri:dev
```

这会同时启动：
1. **Next.js 开发服务器** - React 前端热重载
2. **Tauri 开发窗口** - 桌面应用窗口
3. **Brain Server** - 自动后台启动

## 打包应用

### 一键构建（推荐）

运行跨平台打包脚本，自动完成 Brain Server 构建、内嵌 Node、前端构建和 Tauri 打包：

```bash
# 在仓库根目录运行
node scripts/build-desktop-only.js
```

脚本会根据当前操作系统自动检测 `node` 二进制名称（Windows: `node.exe`，macOS/Linux: `node`）。

### 单独构建 Tauri

如果只需要 Tauri 打包（Brain Server 已就绪）：

```bash
cd desktop-daemon
npm run tauri:build
```

### 打包产物位置

构建完成后，可执行文件位于：

#### Windows
```
desktop-daemon/src-tauri/target/release/bundle/
├── msie/
│   └── Omni-Context_0.1.0_x64_en-US.msi
└── nsis/
    └── Omni-Context_0.1.0_x64_en-US.exe
```

#### macOS
```
desktop-daemon/src-tauri/target/release/bundle/
└── macos/
    └── Omni-Context.app
```

#### Linux
```
desktop-daemon/src-tauri/target/release/bundle/
├── appimage/
│   └── Omni-Context_0.1.0_amd64.AppImage
└── deb/
    └── Omni-Context_0.1.0_amd64.deb
```

## 安装和运行

### Windows

#### 方法 1: 安装包
1. 双击运行 `Omni-Context_0.1.0_x64_en-US.msi` 或 `Omni-Context_0.1.0_x64_en-US.exe`
2. 按照安装向导操作
3. 在开始菜单中找到并启动应用

#### 方法 2: 直接运行
也可以直接运行可执行文件：
```
desktop-daemon/src-tauri/target/release/Omni-Context.exe
```

### macOS

#### 方法 1: 拖拽安装
1. 打开 `Omni-Context.app` 的位置
2. 拖拽 `Omni-Context.app` 到 `Applications` 文件夹
3. 在应用程序文件夹中找到并启动

#### 方法 2: 直接运行
```bash
open desktop-daemon/src-tauri/target/release/bundle/macos/Omni-Context.app
```

### Linux

#### 方法 1: AppImage
```bash
chmod +x desktop-daemon/src-tauri/target/release/bundle/appimage/Omni-Context_0.1.0_amd64.AppImage
./desktop-daemon/src-tauri/target/release/bundle/appimage/Omni-Context_0.1.0_amd64.AppImage
```

#### 方法 2: DEB 包
```bash
sudo dpkg -i desktop-daemon/src-tauri/target/release/bundle/deb/Omni-Context_0.1.0_amd64.deb
```

## 图标生成

如果 `icons` 文件夹中没有所需的图标文件，需要先生成。

### 方法 1: 使用 Node.js 脚本（推荐）

```bash
cd desktop-daemon/src-tauri
npm install canvas
node icons/generate-icons.js
```

### 方法 2: 使用在线工具

1. 访问 https://convertico.com/ 或 https://icon.kitchen/
2. 上传 `icons/icon.svg` 文件
3. 下载生成的各种尺寸的 PNG、ICO、ICNS 文件
4. 放到 `src-tauri/icons/` 文件夹中

### 所需图标文件

确保 `icons/` 文件夹包含：
- `16x16.png`
- `24x24.png`
- `32x32.png`
- `48x48.png`
- `64x64.png`
- `72x72.png`
- `96x96.png`
- `128x128.png`
- `256x256.png`
- `512x512.png`
- `icon.ico` (Windows)
- `icon.icns` (macOS)

## 快速命令参考

| 命令 | 说明 |
|------|------|
| `npm run tauri:dev` | 开发模式运行 |
| `npm run tauri:build` | 打包应用 |
| `npm run build` | 只构建 Next.js 前端 |
| `npm run dev` | 只运行 Next.js 前端 |

## 故障排除

### 构建失败

如果构建失败，请检查：
1. Rust 工具链是否安装正确
2. 系统依赖是否完整
3. 内存是否足够（建议至少 4GB RAM）

### 图标错误

如果看到图标相关的错误，请先运行图标生成脚本。

### Brain Server 无法启动

确保 `brain-server` 文件夹存在且依赖已安装。

## 发布到应用商店（可选）

### macOS App Store
需要 Apple Developer ID 签名 + notarize。本期未配置签名（`signingIdentity: null`），产出 `.dmg` 安装时有安全警告，需用户在「系统设置 > 隐私与安全性」中手动允许。

### Windows Store
需要额外的打包和签名步骤，请参考 Tauri 官方文档。

### Linux
AppImage 可直接分发。DEB 包需配置 `depends` 列表（已在 `tauri.conf.json` 中配置）。

## 已知限制

> **注意**: 当前开发者没有 macOS / Linux 设备进行真机测试。macOS 和 Linux 打包流程的代码已准备就绪，CI 也会在对应平台验证，但欢迎社区贡献者在真实 macOS / Linux 上验证并反馈问题。
