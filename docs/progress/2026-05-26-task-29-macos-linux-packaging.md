# Task 29 Progress: macOS / Linux 打包

**日期**: 2026-05-26  
**状态**: 代码就绪，等待 CI 验证

## 修改清单

### 1. `desktop-daemon/src-tauri/src/brain_server.rs`
- `find_node_executable()` 新增 `node`（无扩展名）候选路径，兼容 macOS / Linux
- 保留原有 `node.exe` 路径，不影响 Windows

### 2. `scripts/build-desktop-only.js`
- 内嵌 Node 二进制逻辑改为跨平台：Windows 用 `node.exe`，macOS/Linux 用 `node`
- 非 Windows 平台自动 `chmod 755` 确保可执行

### 3. `desktop-daemon/src-tauri/tauri.conf.json`
- `bundle.macOS`: 设置 `signingIdentity: null`（本期不签名），`minimumSystemVersion: "10.15"`
- `bundle.deb.depends`: 填入 Linux 运行时依赖列表
- `bundle.linux`: 基本配置

### 4. `.github/workflows/build.yml`（新建）
- tag push (`v*`) 触发三平台矩阵构建：`windows-latest` / `macos-latest` / `ubuntu-22.04`
- 上传各平台安装包为 Actions artifact
- 也支持 `workflow_dispatch` 手动触发
- 各平台 job 直接调用对应步骤（不使用 `build-desktop-only.js`，因为 CI 拆步更清晰）

### 5. `docs/BUILDING.md`
- macOS 增加 Rust via rustup 安装说明
- Linux 详细列出 apt 依赖
- 新增「一键构建」章节推荐 `build-desktop-only.js`
- 新增「已知限制」注明开发者无 mac/linux 设备

## 三平台 Node 内嵌对照

| 平台 | Node 二进制名 | Tauri 资源位置 | brain_server.rs 查找路径 |
|------|-------------|-------------|----------------------|
| Windows | `node.exe` | `resources/brain-server/node.exe` | `exe_dir/resources/brain-server/node.exe` |
| macOS | `node` | `<app>/Contents/Resources/brain-server/node` | `exe_dir/../Resources/brain-server/node` |
| Linux | `node` | `resources/brain-server/node` | `exe_dir/resources/brain-server/node` |

## 系统依赖清单

### macOS
```
xcode-select --install           # Xcode CLI
brew install rustup              # Rust（或 curl rustup.sh）
node 18+ (via nvm / nodejs.org)
```

### Linux (Ubuntu 22.04)
```
sudo apt install libwebkit2gtk-4.0-dev build-essential curl wget file \
  libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
node 18+
```

### Windows（现有，无变化）
```
Visual Studio C++ Build Tools
Rust 1.75+
Node.js 18+
```

## 留给用户 / 社区验证的 Checklist

### macOS
- [ ] 在 macOS (Intel 或 Apple Silicon) 上 `git clone` 仓库
- [ ] 安装前置依赖：Xcode CLI + Rust + Node 18+
- [ ] 运行 `node scripts/build-desktop-only.js`
- [ ] 确认产出 `desktop-daemon/src-tauri/target/release/bundle/dmg/*.dmg`
- [ ] 安装 `.dmg`，确认应用能启动
- [ ] 确认 Brain Server 自动启动（检查托盘图标状态）
- [ ] 如果无签名，确认「系统设置 > 隐私与安全性」中允许运行后正常

### Linux (Ubuntu 22.04)
- [ ] `git clone` 仓库
- [ ] 安装前置依赖（见上方）
- [ ] 运行 `node scripts/build-desktop-only.js`
- [ ] 确认产出 `desktop-daemon/src-tauri/target/release/bundle/appimage/*.AppImage`
- [ ] `chmod +x *.AppImage && ./*.AppImage`
- [ ] 确认 Brain Server 自动启动
- [ ] 确认系统托盘图标显示正常

### CI（自动化）
- [ ] `git tag v0.1.0-test && git push origin v0.1.0-test` → GitHub Actions 触发
- [ ] `windows-latest` job 产出 MSI/NSIS artifact
- [ ] `macos-latest` job 产出 DMG artifact
- [ ] `ubuntu-22.04` job 产出 AppImage artifact
- [ ] 三个 job 全部 green

## 不要做的事（本期）

- Apple 签名 + notarize（等有 Apple Developer ID）
- Snap / Flatpak / RPM 包
- Windows ARM64 包
- 在 Windows 上交叉编译 macOS / Linux 包
