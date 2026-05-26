# Task 06: 系统托盘 + 后台常驻

## 背景

产品定位（`docs/PRODUCT-VISION.md`）写的是"OS 级常驻 AI 记忆中枢"，但现状：

- **没有系统托盘图标**（已确认 Cargo.toml 里没有 tray 相关插件，主窗口配置里也没 tray 设置）
- **主窗口 X 一关就整个进程退出**（带走 brain-server 子进程）
- 没有"最小化到托盘"
- `tauri-plugin-autostart` 已装但**没在 UI 上暴露开关**
- 关掉应用 → AI 记忆服务死了 → 跟"常驻"四个字完全相反

## 目标

让 Omni-Context 真正"常驻":

1. 系统托盘有图标，左键打开/聚焦主窗口，右键弹菜单
2. 主窗口点 X：默认行为是**最小化到托盘**，不是退出整个应用
3. 托盘右键菜单包含：
   - "显示主窗口"
   - "暂停抓取" / "恢复抓取"（如果当前 UDP listener / agent loop 还在跑）
   - "Brain Server 状态：在线/离线"（只读）
   - "重启 Brain Server"
   - "打开数据目录"（`%LOCALAPPDATA%\omni-context\data\`）
   - "设置..."
   - "退出 Omni-Context"（这是真正退出整个应用 + brain-server）
4. 设置面板加"开机自启动"开关，绑定 autostart 插件
5. 设置面板加"关闭窗口时的行为"选项：
   - "最小化到托盘"（默认，常驻）
   - "完全退出"（不想常驻的用户的选项）

## 涉及文件

- `desktop-daemon/src-tauri/Cargo.toml`
  - 不需要新插件，Tauri 1.x 自带 tray API。但如果是用 `tauri-plugin-system-tray` 的形式（不是必须）也行
- `desktop-daemon/src-tauri/tauri.conf.json`
  - `tauri.systemTray` 字段（Tauri 1.x 系统托盘配置）：
    ```json
    "systemTray": {
      "iconPath": "icons/icon.png",
      "iconAsTemplate": true,
      "menuOnLeftClick": false
    }
    ```
  - `tauri.allowlist.window.all` 或具体的 `show / hide / close` 权限需要打开
- `desktop-daemon/src-tauri/src/main.rs`
  - 注册 `SystemTrayMenu` + `SystemTrayEvent` 处理（参考 Tauri 1.x 官方 tray 文档）
  - 处理菜单项点击事件：show_main / quit / restart_brain / pause / resume / open_data_folder
  - 处理 `on_window_event` 的 `CloseRequested`：根据用户设置 → 阻止默认关闭 + `window.hide()`，或者真正退出
  - "完全退出" 时确保 `brain_server::stop()` + `app.exit(0)`
- `desktop-daemon/src-tauri/src/commands.rs`
  - 新增 command `set_close_behavior(behavior: String)` —— "minimize_to_tray" / "exit"
  - 新增 command `quit_app()` —— 触发真正退出
  - 新增 command `open_data_folder()` —— 用 `tauri::api::shell::open` 打开数据目录
- `desktop-daemon/src/components/SettingsPanel.tsx`
  - 新增「常驻 & 启动」区块
  - 包含：开机自启动开关、关闭行为 radio、"打开数据目录"按钮
- `desktop-daemon/src/hooks/useSettings.ts`
  - 新增 `behavior.closeAction: 'minimize_to_tray' | 'exit'`，默认 `'minimize_to_tray'`
  - 持久化到 localStorage（已有的设置存储机制）
- `desktop-daemon/src/locales/zh.ts` + `en.ts`
  - 加 i18n key

## 约束

- **macOS / Linux 也要支持**。macOS 的 tray 是 menubar 图标，行为略不同（不要点击就弹菜单，要左键直接弹）；Linux 取决于 DE，可能图标不显示。每个 OS 跑通了再说。
- **托盘图标用项目现有 `desktop-daemon/src-tauri/icons/icon.png`** 或者其变体。不要新绘制图标。
- 托盘菜单**不要做 i18n**（或者做，但要简单——用户右键托盘菜单的频率很低）。先全英文 / 全中文都行，按当前 UI 默认语言走也行。
- "暂停抓取 / 恢复抓取" 需要 brain-server 那边有对应能力或者 desktop-daemon 这边能停 UDP listener / 屏蔽快捷键触发。如果两端都不好做，**先把这两个菜单项删掉**，进度文档里说明，下次迭代再补。
- 关闭主窗口隐藏到托盘后：用户再点应用图标 / 任务栏图标时，要能恢复主窗口（`app.get_window("main").show().set_focus()`）
- 退出整个应用前一定要 stop brain-server 子进程，不要再留孤儿
- autostart 开关用 `tauri-plugin-autostart` 已有的 `enable / disable / isEnabled` invoke 命令

## 验收标准

1. ✅ 启动应用 → 系统托盘出现 Omni-Context 图标（Windows 任务栏右下角）
2. ✅ 左键点击托盘图标 → 主窗口出现并聚焦
3. ✅ 右键托盘图标 → 弹菜单（包含上面列出的菜单项）
4. ✅ 主窗口点 X → 窗口消失但应用进程还在（任务管理器能看到 Omni-Context.exe）
5. ✅ 这时 brain-server 子进程仍在跑（端口 3001 还在监听）
6. ✅ 右键托盘 → "显示主窗口" → 窗口恢复
7. ✅ 右键托盘 → "退出 Omni-Context" → 整个应用 + brain-server 都退出，托盘图标消失
8. ✅ 设置面板「常驻 & 启动」区块里：开机自启动开关能切换，重启电脑后能验证 Omni-Context 自启
9. ✅ 设置面板里把关闭行为切到"完全退出" → 主窗口点 X → 整个应用退出
10. ✅ macOS / Linux 上图标显示位置正确、菜单能用
11. ✅ `cd desktop-daemon && npm run build` + `cargo check` 都通过

## 构建与运行

```powershell
cd D:\AI_code\Omni-context\omni-context-release\desktop-daemon
npm run tauri:dev
```

dev 模式下托盘行为可能跟 release 模式略不同（特别是 icon），release 版必须再跑一次 `npm run tauri:build` 验证。

## 进度文档

完成后写到 `docs/progress/2026-05-25-task-06-tray-and-persistent-daemon.md`，包含：

1. **任务目标**
2. **改动文件清单**
3. **关键取舍**（特别是：托盘菜单 i18n 选了哪种方案、"暂停抓取"做了还是删了、关闭行为默认值）
4. **自测结果**（11 条）
5. **遗留问题**（macOS menubar、Linux 兼容性、托盘菜单是否能动态更新状态）

## 不要做的事

- 不要做"通知中心 / 系统通知 / 弹气泡提示"——这是另一个独立的功能
- 不要在托盘菜单里塞太多功能项——超过 8 项就显得乱
- 不要让"最小化"按钮也变成最小化到托盘（默认 Windows 行为最小化到任务栏，保持）
- 不要把数据目录路径硬编码——用 `tauri::api::path::data_dir()` 或现有的 `user_data_dir()`（brain_server.rs 已有同名 helper，可以提取共用）
