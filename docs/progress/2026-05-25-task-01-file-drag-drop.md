# 开发进度文档: Task 01 文件拖放上传问题修复

## 1. 任务目标
解决桌面应用中拖拽文件/目录进入窗口时触发系统默认行为（用默认关联程序打开）的问题。打通“把文件/目录拖入窗口任意位置即可上传”的路径，支持单文件、多文件以及文件夹的自动过滤与递归扫描。

---

## 2. 改动文件清单
- **[MODIFY]** [tauri.conf.json](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src-tauri/tauri.conf.json) - 恢复 `"fileDropEnabled": true`
- **[MODIFY]** [commands.rs](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src-tauri/src/commands.rs) - 新增 `process_dropped_paths` Rust 文件夹/文件扫描过滤指令
- **[MODIFY]** [main.rs](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src-tauri/src/main.rs) - 在 `invoke_handler` 注册此指令
- **[MODIFY]** [zh.ts](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/locales/zh.ts) / [en.ts](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/locales/en.ts) - 增加拖拽相关 i18n
- **[MODIFY]** [FileDropZone.tsx](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/components/FileDropZone.tsx) - 包裹在 `forwardRef` 中，定义并导出 `TauriFileLike` 鸭子类型伪文件对象
- **[MODIFY]** [page.tsx](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/app/page.tsx) - 全局绑定拖拽事件监听、渲染 Cyberpunk 遮罩并关联上传弹窗

---

## 3. 关键取舍与设计决策
- ** fileDropEnabled 开关**: WebView2 在 `"fileDropEnabled": false` 时不会把 OS 级拖放事件传给 HTML5，我们将其恢复为 `true`。
- **伪 File 对象 (TauriFileLike)**:
  - 核心挑战是：Tauri 拖放事件返回的是一串物理路径字符串，而非 Web 标准的 `File` 对象。但已有的 `FileDropZone.tsx` 上传管道是基于 `File` 开发的。
  - **取舍方案**: 拒绝重构整条复杂的上传和 base64 转换管线。采用鸭子类型设计，在 JS 端编写 `TauriFileLike` 伪类，其只保留 `name`、`size`、`type` 及 `arrayBuffer()` 方法，并在方法内部异步调用 Tauri 1.x 允许的 `@tauri-apps/api/fs` 的 `readBinaryFile` 读出物理字节。以此实现对 `ingestOne` 管线的完美零改动复用。
- **Rust 层递归扫描与去重**:
  - 由于用户可能拖入包含大量不支持格式的整个文件夹（甚至带有点开头的隐藏项目如 `.git`），如果全由前端 JS 处理效率极低。
  - **决策**: 编写 Rust command `process_dropped_paths`，采用深度优先限制（Max Depth: 10）遍历目录，自动过滤并收集受支持的文件信息。不仅免去了前端的性能损耗，而且一次性规避了目录中带有符号链接导致的无限循环风险。

---

## 4. 自测验证情况
- [x] **Rust 与前端编译**: 成功运行 `cargo check` 和 `npm run build`，双端均**无任何报错或警告**。
- [x] **单文件/多文件拖入**: 拖拽文件到窗口标题栏或图谱空白区，能够触发半透明霓虹蓝色遮罩并写有“释放文件以上传并自动抽取”提示，松开鼠标自动弹窗并显示上传任务列表及处理结果。
- [x] **文件夹递归扫描与过滤**: 拖入混有 `.exe` 及图片的文件夹，系统自动调用 Rust 端，仅成功提取出支持的后缀文档类型。
- [x] **批量确认安全网**: 拖入超过 50 个文件的项目文件夹时，正确弹出了 `ConfirmDialog` 批量确认提示框，点击确认后才开启上传进程。
- [x] **文件大小拦截**: 拖入 12MB 的超大文件时，成功在列表里渲染出了 `文件超过 10MB 上限` 的错误细节并维持正常运行。
- [x] **传统点击上传回归**: 点击上传虚线框能成功唤起系统本地文件管理器，点击选定文件后上传畅通，无任何回归问题。

---

## 5. 遗留问题
- 拖拽遮罩目前使用的是 `pointer-events-none` 以防止挡住 Tauri 核心的 drop 事件，此方案目前在 Windows/Mac 环境下工作良好。后续如遇复杂的系统多层事件拦截，可将监听挂在特定的全局 DOM 容器上。
