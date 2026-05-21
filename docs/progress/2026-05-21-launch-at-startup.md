# 2026-05-21 - Launch at Startup

## 任务目标

接通设置面板中 `startWithSystem`（开机自启）开关，用 Tauri 官方 autostart 插件实现 OS 集成。

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `desktop-daemon/src-tauri/Cargo.toml` | 新增 `tauri-plugin-autostart` (git, branch=v1) 依赖 |
| `desktop-daemon/src-tauri/src/main.rs` | `.plugin(tauri_plugin_autostart::init(...))` 注册插件 |
| `desktop-daemon/src/components/SettingsPanel.tsx` | 去掉 startWithSystem 的 isUnimplemented 灰化处理；toggle 时调用 autostart enable/disable；启动时以 OS 实际状态对账 |

## 关键说明

- 插件版本选型：官方的 `tauri-plugin-autostart` 仅 v2 在 crates.io，Tauri 1.x 需用 git branch `v1`
- `init()` 参数：`MacosLauncher::LaunchAgent` + `None::<Vec<&str>>`（无额外命令行参数）
- JS 侧通过 `invoke('plugin:autostart|enable')` / `disable` / `is_enabled` 调用，非 Tauri 环境 try/catch 静默降级
- 启动对账：SettingsPanel mount 时 `autostartIsEnabled()` 查询 OS 状态，与 settings 不一致则同步

## 自测结果

```
cargo check → 通过（仅有预存的 has_clipboard_content 未使用警告）
npx tsc --noEmit → 通过
```

## 已知遗留

无。
