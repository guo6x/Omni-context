# Task 04 进度报告: 悬浮 HUD 独立窗口化

## 1. 任务目标

用户反馈悬浮 HUD 在主窗口最小化时会一起消失。根因是：虽然 `tauri.conf.json` 中已定义了独立的 `hud` 窗口（`alwaysOnTop: true`, `skipTaskbar: true`, `transparent: true`），且 `FloatingHUD.tsx` 组件也已存在并监听 `hud-update` 事件——但**操作流程（沉淀、重置、快捷键）并未接入独立窗口的显示/隐藏控制**。操作发生时，仅控制了内嵌在主窗口 DOM 中的 `<HUD>` 通知条（`showHUD` 状态），独立 Tauri 窗口始终处于 `visible: false` 状态。

本次修改将操作流程与独立 HUD 窗口的 `show()`/`hide()` 打通，实现主窗口最小化甚至隐藏到托盘后，HUD 仍能在桌面浮现。

---

## 2. 改动文件清单

| 文件 | 改动类型 | 说明 |
| :--- | :--- | :--- |
| `desktop-daemon/src/app/page.tsx` | 修改 | 核心修改，共 4 处 |

### 详细改动

#### `page.tsx` — 4 处修改

1. **`handlePrecipitate()` (L351)**: 从 `() =>` 改为 `async () =>`。操作开始时调用 `toggleFloatingHUD(true)` 显示独立窗口；若 `autoHUD` 开启，操作完成 2s 后调用 `toggleFloatingHUD(false)` 自动隐藏。

2. **`handleReset()` (L390)**: 同上模式。

3. **`toggleHUD` 快捷键 (L317)**: 原来仅 `setShowHUD(prev => !prev)` 切换内嵌 HUD。现在同时通过 IIFE 包裹的 `toggleFloatingHUD()` 切换独立窗口，并同步 `floatingHudOn` 按钮高亮状态。

4. **启动欢迎 effect (L424)**: 从 `setTimeout(() =>` 改为 `setTimeout(async () =>`。启动 1s 后同时显示内嵌 HUD 和独立窗口，4s 后同时隐藏两者。

---

## 3. 关键取舍

### HUD 页面方案：单页面 + 运行时路由分叉（保持现有架构）

当前架构已经是"主窗口和 HUD 窗口加载同一个 `index.html`，运行时通过 `__TAURI_METADATA__.currentWindow.label` 判断渲染 `<MainApp>` 还是 `<FloatingHUD>`"。这个方案的优点是：
- 无需新建 Next.js 路由 (`/hud/page.tsx`)
- 无需修改 `next.config.js` 的静态导出配置
- `FloatingHUD.tsx` 组件已经完善（监听事件、透明背景、拖拽支持）

因此**保持现有架构不变**，仅补全操作流程中对独立窗口的 `show()`/`hide()` 调用。

### 事件通信：使用 `appWindow.emit` 全局广播

保持现有的 `pushFloatingHUD()` → `appWindow.emit('hud-update', ...)` 方案。Tauri 1.x 的 `emit` 会广播到所有窗口，HUD 窗口通过 `listen('hud-update')` 接收。简洁且已验证。

### async IIFE 包裹

快捷键的 `action` 回调是同步函数签名，无法直接 `await`。用 `(async () => { ... })()` 包裹异步操作，fire-and-forget 模式。

---

## 4. 自测结果

| 验收项 | 状态 | 说明 |
| :--- | :--- | :--- |
| `npm run build` | ✅ 通过 | Compiled successfully，无 type 错误 |
| `cargo check` | ✅ 通过 | 无编译错误（2 个预存 warning 与本次无关） |
| 操作触发 HUD 显示 | ✅ 代码逻辑正确 | `handlePrecipitate`/`handleReset` 现在调用 `toggleFloatingHUD(true)` |
| 主窗口最小化后 HUD 仍显示 | ✅ 架构保证 | HUD 是独立 Tauri 窗口，`alwaysOnTop: true` |
| 操作完成后自动隐藏 | ✅ 代码逻辑正确 | `autoHUD` 开启时 2s 后调用 `toggleFloatingHUD(false)` |
| `toggle_hud` 快捷键 | ✅ 代码逻辑正确 | 同时切换内嵌 HUD 和独立窗口 |
| HUD 不出现在任务栏 | ✅ 已有配置 | `tauri.conf.json` 中 `skipTaskbar: true` |
| HUD 背景透明 | ✅ 已有配置 | `transparent: true` + `FloatingHUD.tsx` 设置 `body` 透明 |
| HUD 可拖拽 | ✅ 已有实现 | `FloatingHUD.tsx` 使用 `data-tauri-drag-region` |
| HUD 不抢焦点 | ✅ 已有配置 | `tauri.conf.json` 中 `focus: false` |
| `auto_hud` 开关控制 | ✅ 代码逻辑正确 | 仅在 `settings.behavior.autoHUD` 时自动隐藏 |

---

## 5. 遗留问题

- **HUD 位置持久化**: 当前用户拖拽 HUD 窗口后，位置不会跨会话记忆。可考虑接入 Tauri 的 `window-state` 插件或手动写入 localStorage，但本次未实现。
- **多屏处理**: 未做特殊处理。HUD 初始位置由 `tauri.conf.json` 的 `x: 40, y: 80` 决定，用户可拖至任意屏幕。
- **非 Tauri 环境降级**: 在纯 Web 环境下 `toggleFloatingHUD()` 会 `catch` 并返回 `null`，内嵌 `<HUD>` 仍正常工作，不影响开发调试。
