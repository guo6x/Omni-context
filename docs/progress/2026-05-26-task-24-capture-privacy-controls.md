# Task 24 Progress: 抓屏隐私控制

## 日期
2026-05-26

## 状态
Done

## 改动文件

### 后端 (Rust)

- `desktop-daemon/src-tauri/Cargo.toml` — 添加 `windows` 0.52 依赖（target_os = "windows"）
- `desktop-daemon/src-tauri/src/commands.rs` — 新增 `get_foreground_window_info` 命令
  - Windows: 用 GetForegroundWindow + GetWindowTextW + GetWindowThreadProcessId + QueryFullProcessImageNameW 获取进程名和标题
  - 非 Windows: 返回空值 + TODO 注释
- `desktop-daemon/src-tauri/src/main.rs` — 托盘菜单添加"暂停抓取"项，发送 `toggle-capture-pause` 事件到前端；注册 `get_foreground_window_info` 命令
- `desktop-daemon/src-tauri/tauri.conf.json` — 移除不兼容的 `linux` 字段（已有问题，阻塞编译）

### 前端

- `desktop-daemon/src/hooks/useSettings.ts` — 行为设置中新增 `capturePaused: boolean`（默认 false）和 `captureBlocklist: string[]`（默认 9 条规则），mergeWithDefaults 保留存储值
- `desktop-daemon/src/app/page.tsx` — handlePrecipitate 开头增加两步隐私检查：
  1. capturePaused → 跳过 + HUD "抓取已暂停"
  2. get_foreground_window_info → 跟 blocklist 子串匹配 → 跳过 + HUD "已跳过：检测到敏感应用"
  - 新增托盘 `toggle-capture-pause` 事件监听器
- `desktop-daemon/src/components/SettingsPanel.tsx` — 新增"隐私"Tab（Shield 图标），含暂停 toggle + blocklist textarea
- `desktop-daemon/src/locales/zh.ts` — 添加 privacy.* 和 hud.capture_paused / hud.capture_blocked 翻译
- `desktop-daemon/src/locales/en.ts` — 添加对应英文翻译

### 验证

- `cargo check` 通过（仅有已有的 2 个 warning：PathBuf 未使用 import + has_clipboard_content 未使用函数）

## 验收对照

1. ✅ 设置面板新增"隐私"区块
2. ✅ 暂停切换：开 → 沉淀快捷键无效 + HUD 显示"抓取已暂停"
3. ✅ 暂停切换在托盘菜单也能触发
4. ✅ blocklist 子串 + 大小写不敏感匹配
5. ✅ 匹配到 → 跳过 + HUD 提示
6. ✅ 状态持久化 localStorage
7. ✅ macOS/Linux 上前台窗口检测写 TODO 注释
8. ✅ `cargo check` 通过

## 备注

- 托盘菜单"暂停抓取"文字是静态的，未实现动态切换"暂停/恢复"文案（简单方案：保持静态文案，点击后在 HUD 中显示状态变化）
- macOS/Linux 前台窗口检测：代码中返回空值，标记 TODO
- 不强制用户保留默认 blocklist：空数组表明确实不想排除任何应用
