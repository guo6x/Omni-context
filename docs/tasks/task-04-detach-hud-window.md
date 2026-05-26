# Task 04: 悬浮 HUD 独立窗口化，主窗口最小化时仍可见

## 背景

用户反馈："悬浮窗还是只能在桌面 APP 页面显示，一旦最小化，跟着一起没了。"

排查发现：

- `tauri.conf.json` 里**已经定义了**一个独立的 `hud` 窗口（`label: "hud"`，`alwaysOnTop: true`，`skipTaskbar: true`，`transparent: true`），初始 `visible: false`
- 但 `page.tsx` 里实际渲染的是 `<FloatingHUD />` 组件（DOM 浮层，**属于主窗口的一部分**），不是那个独立 Tauri 窗口
- 所以主窗口最小化时，`<FloatingHUD />` 这个 DOM 元素跟着主窗口一起隐藏

`pushFloatingHUD()` 函数（`page.tsx:39`）已经在 `appWindow.emit('hud-update', ...)` 推事件给 HUD 窗口，说明原本就是按"独立 HUD 窗口"设计的，但 UI 实际渲染走了 DOM 浮层方案，没切换过来。

## 目标

让 HUD 真正独立于主窗口：

1. 把 HUD 渲染到 tauri.conf.json 里定义的那个独立 `hud` 窗口里
2. 主窗口最小化 / 失焦 / 隐藏时，HUD 仍可见（前提是它当前处于"应该显示"状态）
3. HUD 显示 / 隐藏由设置面板里那个 `auto_hud` 开关 + 用户主动触发的快捷键（已有 `toggle_hud`）控制

成功标准：

1. 主窗口打开 → 触发一次沉淀操作 → HUD 在屏幕左上角短暂显示状态文字（如"处理中..."）→ 自动隐藏
2. **把主窗口最小化** → 触发任何操作 → HUD 依然在桌面左上角浮现
3. **把主窗口隐藏（关 X）** → HUD 还能浮现（如果应用本身没退出）
4. HUD 窗口任务栏不出现图标（`skipTaskbar: true`）
5. HUD 窗口背景透明（`transparent: true`），文字清晰可读
6. HUD 窗口位置可拖（用户可以挪到屏幕任意位置），下次启动记住位置（可以靠 Tauri 的 window state 插件，或者写入本地配置）
7. HUD 窗口不抢焦点（`focus: false`）

## 涉及文件

- `desktop-daemon/src-tauri/tauri.conf.json`
  - 检查 `hud` 窗口配置，可能要调整初始 `visible: false` + 添加 `decorations: false` 已有 / 确认 `alwaysOnTop: true` 已有
  - HUD 窗口需要加载一个**单独的 HTML 页面**（不是主窗口的 page.tsx）
- 新建 `desktop-daemon/src/app/hud/page.tsx`
  - 一个独立的 Next.js 路由，专门给 HUD 窗口用
  - 监听 `hud-update` 事件，渲染 status + message
  - 用 transparent 背景 + 圆角 + 半透明卡片
- `desktop-daemon/next.config.js`（如果有）
  - 确认 Next.js 静态导出能输出 `/hud/index.html` 让 Tauri 加载
  - tauri.conf.json 的 `hud` 窗口 `url` 字段要指向这个静态页面（`hud/index.html`）
- `desktop-daemon/src/app/page.tsx`
  - 移除当前的 `<FloatingHUD />` DOM 浮层渲染
  - 保留 `pushFloatingHUD()` 推事件给 HUD 窗口
  - `showHUD` 状态切换 HUD 窗口的 visible（用 Tauri API：`WebviewWindow.getByLabel('hud').show() / hide()`）
- `desktop-daemon/src/components/FloatingHUD.tsx`
  - 这个组件可以保留（dev 模式 / 网页版仍可用），但不在 Tauri prod 里渲染
  - 或者整个文件改成 HUD 窗口里用的组件

## 约束

- **Tauri 1.x**，不是 2.x。多窗口 API 用 1.x 的：`appWindow`、`WebviewWindow.getByLabel()`
- 不要因为 HUD 切换到独立窗口就破坏现有的快捷键、auto_hud 开关、settings 里的相关配置项
- HUD 内容要跟主窗口数据流同步——靠 Tauri event bus（`emit` + `listen('hud-update')`），不要重新建一套状态管理
- 不要让 HUD 窗口在用户没触发任何操作时一直显示——只在"有事说"时浮起来，几秒后自动隐藏（现有逻辑就这样，保持）
- Windows 上透明窗口要用合适的 layered window 设置——Tauri 1.x 默认应该已支持，如果不行需要研究
- 不要为了让 HUD 永远显示就把 `visible: true` 写死——按交互逻辑控制

## 验收标准

1. ✅ 打开主窗口，触发沉淀操作 → HUD 出现 → 几秒后自动消失
2. ✅ **最小化主窗口** → 再触发操作 → HUD 在桌面浮现，主窗口仍是最小化状态
3. ✅ **关闭主窗口（X 不退出，仅隐藏到托盘 / 留在内存）** → HUD 仍能显示（看产品当前是怎么处理 X 的，可能直接退出整个 app，那这条改成"应用没退出的前提下"）
4. ✅ HUD 不出现在任务栏
5. ✅ HUD 背景透明（看得到桌面），文字清晰
6. ✅ HUD 可以用鼠标拖动位置（可选，如有时间）
7. ✅ HUD 不抢焦点（用户在其他应用打字时，HUD 出现不会切焦点）
8. ✅ 设置面板的 `auto_hud` 开关关掉后，操作不再触发 HUD
9. ✅ 快捷键 `toggle_hud` 能强制显示 / 隐藏 HUD
10. ✅ `cd desktop-daemon && npm run build` 无 type 错误
11. ✅ `cd desktop-daemon/src-tauri && cargo check` 无错误

## 构建与运行

```powershell
cd D:\AI_code\Omni-context\omni-context-release\desktop-daemon
npm run tauri:dev
```

Next.js 静态导出后产物在 `desktop-daemon/out/`，HUD 页面在 `out/hud/index.html`。

## 进度文档

完成后写到 `docs/progress/2026-05-25-task-04-detach-hud-window.md`，包含：

1. **任务目标**
2. **改动文件清单**
3. **关键取舍**（特别是：HUD 的 HTML 页面是单独 Next.js 路由还是单独的 HTML 文件；事件 bus 用 `appWindow.emit` 还是 Tauri 的 global event）
4. **自测结果**
5. **遗留问题**（特别是 HUD 位置持久化、多屏处理等是否做了）

## 不要做的事

- 不要做"HUD 永远显示"——保持当前的"按需浮现 + 自动隐藏"交互
- 不要给 HUD 加复杂交互（按钮、菜单、设置入口）——它就是一个状态显示器
- 不要因为 HUD 独立化就改主窗口的关闭 / 最小化行为
- 不要把 HUD 做成全屏蒙版
