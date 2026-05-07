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

#### Linux
- 系统依赖库（根据发行版）：
  ```bash
  # Debian/Ubuntu
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

### 构建应用

要打包成可执行文件，运行：

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
需要额外的签名和公证步骤，请参考 Tauri 官方文档。

### Windows Store
需要额外的打包和签名步骤，请参考 Tauri 官方文档。

### Linux
可以发布到 Flathub、Snap Store 等平台。
