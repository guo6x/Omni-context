# Task 24: 抓屏隐私控制（暂停 + 敏感应用排除）

## 背景

桌面 App 的"沉淀"快捷键会截屏 + 抓剪贴板。当前**没有**：

- "暂停抓取"开关 —— 用户在做敏感操作时（看银行、聊隐私）无法暂停
- 敏感应用排除列表 —— 不管前台是什么应用都抓

这是隐私敏感的硬伤。

## 目标

### A. 全局"暂停抓取"开关

- 设置面板 + 系统托盘菜单都加"暂停抓取"切换
- 暂停时：沉淀快捷键 / 物理按钮触发都不抓屏不抓剪贴板，HUD 显示"已暂停"
- 状态用 localStorage 持久化，重启 App 保留

### B. 敏感应用排除列表

- 设置面板加一个"敏感应用排除列表"输入框（多行 textarea），每行一个匹配规则
- 沉淀触发时先获取**当前前台窗口标题 + 进程名**，匹配列表里任一规则就跳过
- 匹配方式：**子串匹配 + 大小写不敏感**（不做正则避免用户写错）
- 默认列表（开箱即用）：
  ```
  KeePass
  1Password
  Bitwarden
  WeChat
  微信
  QQ
  Telegram
  Signal
  Bank
  ```
- 被排除时 HUD 显示"已跳过：检测到敏感应用 {名字}"，让用户知道发生了什么

## 涉及文件

- `desktop-daemon/src-tauri/src/screen_capture.rs` 或 `commands.rs`
  - 新增 `get_foreground_window_info() -> Result<{ title, process_name }>` Tauri 命令
  - Windows: GetForegroundWindow + GetWindowText + GetWindowThreadProcessId + QueryFullProcessImageName
  - macOS: 用 NSWorkspace.frontmostApplication（如果做 macOS 的话，本期可仅 Windows）
- `desktop-daemon/src/hooks/useSettings.ts`
  - 新增 `behavior.capturePaused: boolean`，默认 false
  - 新增 `behavior.captureBlocklist: string[]`，默认上面的 9 条
- `desktop-daemon/src/app/page.tsx`
  - `handlePrecipitate` 开头：
    - 检查 capturePaused → 跳过 + HUD 提示
    - 调 `invoke('get_foreground_window_info')` → 跟 blocklist 匹配 → 跳过 + HUD 提示
- `desktop-daemon/src/components/SettingsPanel.tsx`
  - 加"隐私"区块 / Tab，含暂停 toggle + blocklist textarea
- `desktop-daemon/src-tauri/src/main.rs`
  - 托盘菜单加"暂停/恢复抓取"项（动态文案）
- `desktop-daemon/src/locales/zh.ts` + `en.ts`
  - 加 `privacy.title`、`privacy.pause`、`privacy.blocklist_label`、`privacy.blocklist_placeholder`、`hud.capture_paused`、`hud.capture_blocked`

## 约束

- **不存截图原图到文件系统** —— 当前流程是 base64 直传 brain-server，保持
- **暂停状态要清晰可见** —— 设置面板和托盘图标都要反映（托盘图标可以叠加暗化 / 红点提示，简单的话只改菜单文字也行）
- 匹配规则用子串 + lowercase，不要引入正则 / glob 库
- 默认 blocklist 不可清空 —— 如果用户全删了，恢复成空数组（不强制塞默认），但 placeholder 提示"留空表示不排除任何应用"
- 不要做"自动学习"敏感应用 —— 用户显式配置，避免误判
- Windows API 调用需要在 Cargo.toml 加 windows crate 子模块 features

## 验收标准

1. ✅ 设置面板新增"隐私"区块
2. ✅ 暂停切换：开 → 沉淀快捷键无效 + HUD 显示"已暂停"
3. ✅ 暂停切换在托盘菜单也能看到 + 切换
4. ✅ 把记事本进程名加进 blocklist → 前台是记事本时按沉淀 → 跳过 + HUD 提示"已跳过：检测到敏感应用 Notepad"
5. ✅ blocklist 大小写不敏感（输入 `notepad` 也能匹配 Notepad.exe）
6. ✅ 状态刷新后保留
7. ✅ macOS 上前台窗口检测可以暂时 skip（写 TODO 注释）
8. ✅ `cargo check` 通过

## 进度文档

`docs/progress/2026-05-26-task-24-capture-privacy-controls.md`

## 不要做的事

- 不要把"暂停"做成 modal 弹窗
- 不要尝试自动识别"这个窗口现在显示的内容包含敏感词" —— OCR 自身就敏感，做这事会变得很怪
- 不要在 brain-server 加任何隐私相关逻辑 —— 所有控制在桌面端拦截，brain-server 拿不到敏感数据就行
- macOS / Linux 的前台窗口检测本期不做（写 TODO 留待 macOS/Linux 包做完后补）
