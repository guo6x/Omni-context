# 任务 07：实现「开机自启」

> 项目根目录：`omni-context-release/`。这是一个穿插小活，改动小、范围明确。

## 背景

设置面板「行为」分类里有一个 `startWithSystem`（开机自启）开关，但目前它被**禁用**并标着
「未实现」——因为缺后端支持。`desktop-daemon/src/components/SettingsPanel.tsx` 里有
`const isUnimplemented = item.key === 'startWithSystem'` 这样的特殊处理把它灰掉。

本任务把这个开关真正接通。

## 要做的事

用 Tauri 官方的 autostart 插件实现（OS 集成用官方插件是正解，别手写注册表）。

### 1. Rust 侧（`desktop-daemon/src-tauri/`）

- `Cargo.toml`：加入 `tauri-plugin-autostart` 依赖，**选用与 Tauri 1.5 兼容的版本**。
- `src/main.rs`：在 `tauri::Builder::default()` 链上注册该插件
  （`.plugin(tauri_plugin_autostart::init(...))`，参数按插件 1.x 文档）。

### 2. 前端侧（`desktop-daemon/src/`）

- 装上对应的 JS 包 `tauri-plugin-autostart-api`（与 Rust 插件同系列、Tauri 1.x 版本）。
- `SettingsPanel.tsx`：去掉 `startWithSystem` 的「未实现」特殊处理（`isUnimplemented`
  那段逻辑里把它移除），让这个开关正常可点。
- 接通开关行为：用户打开 → 调插件 `enable()`；关闭 → 调 `disable()`。
  同时仍走 `onUpdateBehavior` 把 `startWithSystem` 存进设置（UI 状态）。
- 启动时对账：以操作系统的实际自启状态（插件 `isEnabled()`）为准，
  和设置里的 `startWithSystem` 同步一下，避免两者不一致。合适的接入点在
  `useSettings.ts` / `page.tsx` / `SettingsPanel.tsx` 之间自行判断。
- 非 Tauri 环境（`next dev` 浏览器调试）下，插件调用会失败——要 try/catch 静默降级，
  参考项目里已有的 `tauriMinimize()` 等函数的写法。

## 约束

- 只为实现这一个功能而改动，不顺带重构。
- 除 autostart 插件本身，不引入其它新依赖。
- 遵循现有代码风格；非 Tauri 环境要优雅降级、不报错。

## 验收标准

- `cargo check` 在 `desktop-daemon/src-tauri` 通过。
- `npx tsc --noEmit` 在 `desktop-daemon` 通过。
- 设置面板里 `startWithSystem` 开关不再灰、不再标「未实现」，可正常切换。
- 切换开关会真正调用插件的 enable/disable。

## 完成后

在 `docs/progress/` 下新建 `2026-05-21-launch-at-startup.md`，内容包含：
任务目标、改动文件清单（每文件一句话）、关键实现说明、自测结果（命令+结果）、已知遗留。
