# Task 28: Tauri 自动更新（updater）

## 背景

桌面 App 装了就装了，**没有通知用户有新版本的机制**。每次发新版本只能让用户重新下载 setup.exe 手动装。

Tauri 1.x 自带 `updater` 模块——只要在配置里启用 + 提供一个 update manifest URL，App 启动时会检查更新、用户同意就自动下载安装。

## 目标

接入 Tauri updater，桌面 App 启动 30 秒后检查更新（避免拖慢启动），有新版本时弹个 toast 提示用户。

成功标准：

1. 当 GitHub Release 发了新 tag，用户的 App 启动后 30 秒内会检测到
2. 检测到后弹 toast "Omni-Context v0.2.0 可用，点此更新"
3. 用户点 → 进度条下载 → 完成后提示重启
4. 更新失败 / 网络挂掉 → 静默失败（写日志，不烦用户）
5. 设置面板加"检查更新"按钮（手动触发）

## 涉及文件

- `desktop-daemon/src-tauri/tauri.conf.json`
  - `tauri.updater`:
    ```json
    "updater": {
      "active": true,
      "endpoints": ["https://github.com/<owner>/<repo>/releases/latest/download/latest.json"],
      "dialog": false,
      "pubkey": "<生成的签名公钥 base64>"
    }
    ```
  - **签名公钥**：用 `tauri signer generate` 命令生成密钥对，私钥保管好（GitHub Secrets），公钥贴这里
- `desktop-daemon/src-tauri/Cargo.toml`
  - tauri features 加 `updater`
- `desktop-daemon/src-tauri/src/main.rs`
  - setup 钩子里加 `tauri::async_runtime::spawn` 起一个 30 秒 timer，调 `app.app_handle().updater().check()`
- `desktop-daemon/src/components/SettingsPanel.tsx`
  - "关于"区块（如果没有就新加）显示当前版本 + "检查更新"按钮
  - 按钮调 `invoke('check_update_manual')`
- `desktop-daemon/src-tauri/src/commands.rs`
  - 加 `check_update_manual` 命令调 updater API
- `.github/workflows/release.yml`（如果还没有）
  - 简化版：tag push 触发 → cargo tauri build → 生成 `latest.json` + 把 setup.exe 上传到 release
  - 用 `tauri-action` 官方 GitHub Action 简化

## 约束

- **公钥/私钥不要 commit 进仓库**——`.gitignore` 加 `*.key` `tauri_priv.key`，私钥放 GitHub Secrets
- `dialog: false` —— Tauri 自带的更新对话框丑，我们自己用 toast UI
- 检查更新失败不要弹错——静默写日志（[[task-25]] 的日志文件）
- 更新检查间隔：启动 30 秒检查一次，运行中不再轮询（避免烦用户）
- 用户点"检查更新"按钮 → 即使刚检查过也立刻再查一次
- 在没有 GitHub Release 之前，updater endpoint 设成一个合理的 `https://omni-context-updates.local/<...>`占位 + 写注释说明，让代码能 compile 但实际不会查到东西（避免硬卡死流程）

## 验收标准

1. ✅ `cargo check` 通过
2. ✅ 桌面 App 启动后 30 秒，看 brain-server 日志 / Tauri 控制台有 "Checking for updates..." 类输出
3. ✅ 手动改本地 `latest.json` mock 一个新版本（用本地静态 server 或修改 endpoints 指向本地文件）→ App 弹 toast 提示更新可用
4. ✅ 点 toast 触发下载 → 下载完成 → 提示重启
5. ✅ 设置面板"关于"区块显示当前版本 + 有"检查更新"按钮
6. ✅ 检查更新失败时不弹错误，日志里有记录
7. ✅ 写一份 `docs/RELEASING.md` 说明发版流程（生成密钥、设 GitHub Secret、tag push）

## 进度文档

`docs/progress/2026-05-26-task-28-tauri-auto-update.md`

包含：
- 公钥/私钥生成步骤 + 用户该把什么贴进哪里
- 本地测试 mock update 的方法
- 实测：是否能完整走通"启动 → 检查 → 下载 → 重启"流程
- 遗留：是否需要发版自动化（CI）

## 不要做的事

- 不要做"强制更新"——用户可以拒绝
- 不要做 delta 更新——全包替换够用
- 不要做"测试版/稳定版"分支选择——MVP 只一个 channel
- 不要把签名公钥放到代码里硬编码 —— 走 tauri.conf.json
- 不要把发版自动化做太复杂，能用 `tauri-action` 就用
