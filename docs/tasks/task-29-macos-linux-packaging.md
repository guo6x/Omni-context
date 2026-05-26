# Task 29: macOS / Linux 打包脚本

## 背景

当前 `scripts/build-desktop-only.js` 在 Windows 上跑得通，输出 MSI + NSIS。但 macOS（.dmg）和 Linux（.AppImage / .deb）打包：

- 没有签名 / notarize 配置（macOS 要 Apple Developer ID）
- 没处理 macOS .app bundle 路径（brain-server 资源拷贝的目标目录不同）
- 没处理 Linux 系统依赖（webkit2gtk、libssl-dev 等）
- 没在 CI 上验证过能产出

用户**当前没 mac/linux 设备**，所以本任务只要把代码 + 脚本 + CI 准备好，等以后有人在对应平台跑就能出包。

## 目标

让任何拿到这份仓库、在 macOS / Linux 上跑 `node scripts/build-desktop-only.js` 的人能直接得到安装包。

成功标准：

1. **macOS** 上跑脚本 → 产出 `.dmg`（无签名版可装但有警告，签名版无警告）
2. **Linux**（Ubuntu 22.04 测试）上跑脚本 → 产出 `.AppImage`
3. brain-server 资源 + 内嵌 node 在对应平台路径正确
4. 文档 `docs/BUILDING.md` 写清各平台前置依赖

## 涉及文件

- `scripts/build-desktop-only.js`
  - 已有跨平台 copyDir 等逻辑，确认对 macOS / Linux 也能跑
  - 关键：内嵌 node 的处理——macOS 需要 node binary 而不是 node.exe，Linux 同理
  - macOS spawn 命令路径变成 `Contents/MacOS/...` 而不是 exe 同目录
- `desktop-daemon/src-tauri/src/brain_server.rs`
  - `find_node_executable()` 已经有 macOS 路径 candidates（`../Resources/...`），确认完整
- `desktop-daemon/src-tauri/tauri.conf.json`
  - `bundle.macOS` 区块：`exceptionDomain`、`signingIdentity`（留 null，发版时再填）
  - `bundle.deb`、`bundle.appimage` 字段补全 deps 列表
- `desktop-daemon/src-tauri/icons/`
  - 需要 macOS `icon.icns` 和 Linux `.png`（现有 icons 目录里应该已经有，确认）
- `docs/BUILDING.md`
  - 加 macOS / Linux 章节：所需依赖（`brew install rustup`, `apt install libwebkit2gtk-4.0-dev` 等）
- `.github/workflows/build.yml`（新建或扩展）
  - matrix build: windows-latest / macos-latest / ubuntu-22.04
  - 三个 OS 都跑 `node scripts/build-desktop-only.js`
  - artifact 上传安装包
  - 只在 tag push 时跑，不在每次 commit 跑（避免 CI 配额浪费）

## 约束

- **不需要立刻搞 Apple 签名 + notarize**——本期目标是"能产出包"，签名是另一回事
- macOS arm64 + x86_64 都要支持（用 `cargo tauri build --target universal-apple-darwin` 或者分别 build）
- AppImage 用 Tauri 默认的 bundling
- 不要为了支持 Snap / Flatpak 引入额外复杂度——只产 AppImage
- 不要尝试在 Windows 机器上交叉编译 macOS / Linux 包——只在对应 OS 上才跑
- 文档明确写"用户当前没有 mac/linux 设备测试，欢迎社区贡献验证"

## 验收标准

1. ✅ 在 GitHub Actions 上（macos-latest）跑脚本 → 产出 .dmg artifact
2. ✅ 在 GitHub Actions 上（ubuntu-22.04）跑脚本 → 产出 .AppImage artifact
3. ✅ Windows 现有打包不能 regression（windows-latest job 仍产出 MSI/NSIS）
4. ✅ 写一份 `.github/workflows/build.yml`，tag push 触发三平台构建
5. ✅ `docs/BUILDING.md` 写清三平台依赖
6. ✅ 内嵌 node 在三平台 path 都对（macOS: `Contents/Resources/brain-server/node`，Linux: `resources/brain-server/node`）
7. ✅ 三平台 cargo check 都过（macOS / Linux 在 CI 验）

## 进度文档

`docs/progress/2026-05-26-task-29-macos-linux-packaging.md`

包含：
- 三个 OS 各自需要的系统依赖清单
- node binary 在三平台分别用什么名字 / 怎么内嵌
- GitHub Actions 构建产物链接（如果跑了 CI）
- 留给用户测试的 checklist：拿到 .dmg 后该确认什么、拿到 .AppImage 后该确认什么

## 不要做的事

- 不要本期就搞 Apple 签名 + notarize（等用户买了 Apple Developer ID 再说）
- 不要做 Windows ARM64 包
- 不要做 Snap / Flatpak / RPM 包
- 不要试图在 Windows 上交叉编译——CI 用真实对应 OS 跑
- 不要在本地 build 脚本里硬塞签名密钥
