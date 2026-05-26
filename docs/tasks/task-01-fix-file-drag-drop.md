# Task 01: 修复桌面端文件拖放（拖进去就打开默认应用而不是上传）

## 背景与现状

桌面应用（Tauri 1.x + Next.js）里有一个上传文件面板 `FileDropZone`（`desktop-daemon/src/components/FileDropZone.tsx`）。**点击虚线框选文件可以正常上传**，但**把文件从资源管理器拖进去没反应——Windows 直接用关联程序把文件打开了**。

之前一轮诊断里有人把 `tauri.conf.json` 里 `windows[0].fileDropEnabled` 设成了 `false`，本以为这样 HTML5 原生 `onDrop` 就能拿到事件，结果错了：

- `fileDropEnabled: false` 让 Tauri 不拦截 file drop
- 但 WebView2（Windows 上的 Tauri 1.x WebView）**不会把 OS 级文件拖放转成 HTML5 `DataTransfer.files` 事件**
- WebView2 拒收 → Windows 视该窗口为不接受文件 → 落回"用默认程序打开文件"

正确做法：保留 `fileDropEnabled: true`，**通过 Tauri 的 `tauri://file-drop` 事件**把拖放文件路径取出来，用 Tauri 的 fs API 读文件，再走原来的上传流程。

## 目标

打通"拖文件 / 文件夹到主窗口任意位置"这条路径，**整个 Omni-Context 主窗口都是一个拖放接收区**（不只是上传弹窗里的虚线框）。

成功标准：

1. 从资源管理器拖一个 `.md` 文件到 Omni-Context 窗口的**任何位置**（标题栏、图谱区、空白区都行），自动弹出上传面板并开始处理（任务列表里有该文件名 + spinner → 成功/失败）。
2. 拖多个文件（混合扩展名）一次性批量处理。
3. **拖一个文件夹**：递归扫描该目录，挑出所有支持的扩展名（参考 `FileDropZone.tsx` 的 `ACCEPTED_TYPES`），跳过其他文件，把符合的一批一起上传。文件夹里超过 10MB 的单个文件按现有规则报错跳过。如果递归后筛出来的文件超过 50 个，给一个 confirm dialog "即将上传 N 个文件，确认？" 避免用户误拖整个项目仓库。
4. 拖放时全窗口要有视觉反馈（例如全局加一层 cyan 半透明遮罩 + "释放以上传"提示），release 后遮罩消失。
5. 已经验证支持的所有扩展名都能拖（列表见 `FileDropZone.tsx` 里的 `ACCEPTED_TYPES`）。
6. 单文件 >10 MB 应该跟点击选择一样被拦下来（错误 toast 提示），不能崩。
7. 拖放进来后**自动 setShowUpload(true)** 让上传弹窗可见，让用户看到进度。

## 涉及文件

- `desktop-daemon/src-tauri/tauri.conf.json`
  - 把之前的 `"fileDropEnabled": false` **改回 `true`**（或者直接删掉这行，让它走默认 `true`）。
- `desktop-daemon/src-tauri/src/commands.rs`（可能要新增）
  - 新加一个 Tauri command `scan_folder_for_supported(folder_path: String, extensions: Vec<String>, max_bytes: u64) -> Vec<{ path, size }>`
  - 递归遍历目录，过滤出匹配的扩展名 + 大小不超过限制的文件
  - 注意符号链接处理，避免无限递归
- `desktop-daemon/src/app/page.tsx`
  - 在最外层容器加一个全局拖放层（监听 Tauri `tauri://file-drop-hover` 显示遮罩、`tauri://file-drop` 执行上传、`tauri://file-drop-cancelled` 收起遮罩）
  - 拖入文件后 `setShowUpload(true)`，把现有的上传弹窗打开 + 把文件交给里面的 FileDropZone
  - 或者：把拖放分发逻辑独立到一个 hook（`useFileDrop`），FileDropZone 复用同一份处理函数
- `desktop-daemon/src/components/FileDropZone.tsx`
  - 把 `ingestOne` 提取成可供外部调用的逻辑（或者干脆把 `handleFiles` 暴露给父组件 via ref / props）
  - 现有的 HTML5 `onDragOver / onDrop` 视觉态保留（dev 模式 / 浏览器调试时还有用）
  - 构造一个 "伪 File" 对象给 `ingestOne` 即可（它只用到 `name`、`size`、`type`、`arrayBuffer()`），不要重写整条管线
- 用 `@tauri-apps/api/fs` 的 `readBinaryFile(path)` 把拖进来的文件读成 `Uint8Array`，转 base64

## 约束

- **Tauri 是 1.x 版本**，不是 2.x。`@tauri-apps/api` 的导入路径用 1.x 的（`@tauri-apps/api/event`、`@tauri-apps/api/fs`），不要写成 `@tauri-apps/api/core`。
- **不要破坏现有的点击选择上传**。点击虚线框 → 系统文件选择对话框 → 上传，这条路径目前能用，不要重构掉它。
- **不要把拖放限制成"必须先 hover 在 FileDropZone 上"**。Tauri 的 file-drop 是窗口级事件，整个窗口都会收到。可以判断鼠标位置在 FileDropZone DOM 节点上方时才接收，但即使简单点——只要 FileDropZone 当前可见（modal 打开），就接收所有拖入的文件——也可以。优先级低。
- 拖放路径要能处理**含中文/空格**的路径。
- 对 Tauri fs 的权限：`tauri.conf.json` 的 `tauri.allowlist` 可能需要打开 `fs.readBinaryFile` 或者 `fs.readFile`，配置 `scope` 为 `**`（因为用户可能从任意位置拖文件）。如果当前 allowlist 是空的（用通配的 `"all": true`），那不用改。检查一下 `tauri.conf.json` 当前的 allowlist 状态。

> Tauri 1.x file-drop 事件参考：
> ```ts
> import { listen } from '@tauri-apps/api/event';
> import { readBinaryFile } from '@tauri-apps/api/fs';
>
> const unlisten = await listen<string[]>('tauri://file-drop', async (event) => {
>   const paths = event.payload;
>   for (const p of paths) {
>     const bytes = await readBinaryFile(p);
>     // ... 转 File-like + 调用 ingestOne
>   }
> });
> ```

- React 组件挂载 / 卸载时要 add/remove listener，避免重复绑定。
- 不要在 `tauri.conf.json` 里新增什么 plugin 依赖。

## 验收标准

执行 AI 自测时必须覆盖以下场景，并把结果写进进度文档：

1. ✅ 拖一个 `test.md`（含中文内容）到主窗口标题栏 → 弹出上传面板 + toast "test.md 已抽取"
2. ✅ 拖一个 `notes.txt` 到主窗口的图谱画布区 → 同样能上传（不是只在虚线框区域生效）
3. ✅ 同时拖 3 个文件（`.md` + `.txt` + `.pdf`）→ 三条记录依次出现
4. ✅ 拖一个含 5 个 `.md` 和 3 个图片、还有杂项 `.exe / .DS_Store` 的文件夹 → 自动筛出 8 个支持的文件，跳过 `.exe`
5. ✅ 拖一个含 100+ 文件的项目目录 → 弹 confirm dialog "即将上传 100 个文件，确认？"
6. ✅ 拖一个 12 MB 的文件 → 错误 toast "文件超过 10MB 上限"
7. ✅ 点击虚线框选文件 → 仍然能正常上传（回归没坏）
8. ✅ 拖动过程中主窗口有全屏遮罩 + "释放以上传"提示，松开后遮罩消失
9. ✅ 验证 `tauri.conf.json` 的 `fileDropEnabled` 已恢复为 `true`（或删除该字段）
10. ✅ `cd desktop-daemon && npm run build`（Next.js build）无 type 错误
11. ✅ `cd desktop-daemon/src-tauri && cargo check` 无错误

## 构建与运行

- 桌面端 React 改完后，无需重打整个 Tauri 安装包来验证，可以这样跑：
  ```powershell
  cd D:\AI_code\Omni-context\omni-context-release\desktop-daemon
  npm run tauri:dev
  ```
- brain-server 在 dev 模式下会被 Rust spawn，端口冲突的话先 `Get-Process node | Where-Object Path -like *omni* | Stop-Process -Force`

## 进度文档

完成后写到 `docs/progress/2026-05-25-task-01-file-drag-drop.md`，包含：

1. **任务目标**（一句话）
2. **改动文件清单**（path + 一句话说明）
3. **关键取舍**（特别是：怎么把 path 变成 File-like 喂给 ingestOne；如果用了其他方案请说明为什么）
4. **自测结果**（上面 7 条验收的实测情况，截图或日志摘抄都行）
5. **遗留问题**（已知的边界 case 或需要后续处理的事）

## 不要做的事

- 不要把上传逻辑迁移到 Rust 层（让 Rust 直接读文件 + POST 到 brain-server）。当前架构是 UI 层走 fetch，保持一致。
- 不要顺手"优化"或者重构 FileDropZone 现有的样式、动画、状态机。
- 不要改 brain-server 端（`/api/ingest/file` 协议不变）。
- 不要为了兼容多平台引入 `electron` / `react-dropzone` 等第三方拖放库。Tauri 自己的事件够用。
