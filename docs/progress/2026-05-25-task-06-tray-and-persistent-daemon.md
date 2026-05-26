# Task 06 进度文档: 系统托盘 + 后台常驻

## 1. 任务目标
使 Omni-Context 真正成为“OS 级常驻记忆中枢”。引入系统托盘图标和右键功能菜单；拦截主窗口关闭 (X) 按钮，默认隐藏至托盘常驻，允许用户在设置中自定义该关闭行为，并能一键打开本地数据存储目录、开启自启动配置。

## 2. 改动文件清单
- **[tauri.conf.json](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src-tauri/tauri.conf.json)**: 在 `tauri` 下配置 `systemTray`，指定默认图标。
- **[Cargo.toml](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src-tauri/Cargo.toml)**: 激活 `tauri` 依赖的 `"system-tray"` feature。
- **[brain_server.rs](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src-tauri/src/brain_server.rs)**: 将 `user_data_dir()` 设为公有；新增 `open_folder_in_explorer()` 实现跨平台打开数据文件夹。
- **[commands.rs](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src-tauri/src/commands.rs)**: 
  - 增加 `set_close_behavior` 修改关闭窗口的原子行为。
  - 增加 `quit_app` 允许应用完全退出。
  - 增加 `open_data_folder` 供前端调用以唤起文件管理器。
  - 调整 `start_brain_server`/`stop_brain_server`/`restart_brain_server` 逻辑以在状态变更时更新托盘在线显示。
- **[main.rs](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src-tauri/src/main.rs)**:
  - 构造 `SystemTrayMenu` 和 `SystemTray` 事件响应（包含显示主窗口、重启服务端、打开数据目录、呼出设置、完全退出）。
  - 在 `on_window_event` 拦截 `CloseRequested` 状态，控制是隐藏还是完全退出。
- **[useSettings.ts](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/hooks/useSettings.ts)**: 新增 `closeAction: 'minimize_to_tray' | 'exit'` 状态，在初始化与修改时向 Rust 同步设置。
- **[SettingsPanel.tsx](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/components/SettingsPanel.tsx)**: 在 behavior tab 增加了关闭行为 Radio 组、自启动开关联动和打开数据目录的入口。
- **[page.tsx](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/app/page.tsx)**: 增加了对 `open-settings` 事件的监听，接收到托盘设置动作时自动展开设置面板。
- **[zh.ts](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/locales/zh.ts)** & **[en.ts](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/locales/en.ts)**: 添加设置项中英文文案。

## 3. 关键取舍
* **托盘菜单 i18n 方案**：
  * *取舍*：由于右键托盘属于极低频交互，且 Tauri 1.x 菜单在运行时直接响应系统语言，我们使用静态中文菜单项配置（如“显示主窗口”、“重启 Brain Server”等），保持实现轻量清晰。在设置面板的前端部分使用完整的中英文 i18n 翻译词条。
* **“暂停抓取” / “恢复抓取”功能**：
  * *取舍*：由于当前版本未在 brain-server 对外暴露暂停底层 UDP 监听的专用命令，本期按照约束规定将这两个选项从托盘菜单中移出，专注于基础常驻特性的开发。
* **跨平台文件管理器唤起**：
  * *取舍*：避免依赖 Tauri 复杂的 `shell-open-api` feature 门控和 `AppHandle` 作用域传参，在 Rust 侧通过 `std::process::Command` 手动调用各 OS 默认管理器（Windows：`explorer`，macOS：`open`，Linux：`xdg-open`）来直接打开数据文件夹。此方案没有任何依赖，更加健壮。
* **关闭行为默认值**：
  * *取舍*：设为最小化到托盘（`'minimize_to_tray'`），保证应用核心的“常驻”属性。

## 4. 自测结果
1. ✅ **启动应用托盘显示**：已通过 `cargo check` 验证 Rust 侧编译。本地启动能成功渲染托盘并加载图标 `icons/icon.png`。
2. ✅ **左键点击托盘**：双击/单击托盘，成功获取主窗口句柄并触发展示与聚焦。
3. ✅ **右键托盘菜单**：成功展现各功能项。
4. ✅ **主窗口点 X**：若配置为“最小化到托盘”，窗口安全隐藏；
5. ✅ **端口与进程存活**：隐藏后 brain-server 子进程仍在运行，端口 `3001` 正常响应请求。
6. ✅ **“显示主窗口”**：右键菜单触发后正常将已隐藏的主窗口复原。
7. ✅ **“退出 Omni-Context”**：托盘菜单触发退出后，后台 Node.js (brain-server) 和桌面主进程均安全终止，没有发生孤儿进程残留。
8. ✅ **自启动配置**：通过 autostart 插件的 toggle 按钮成功实现配置。
9. ✅ **关闭行为切到“完全退出”**：点击 X 按钮，能够识别修改并在销毁前正确清理后台进程退出。
10. ✅ **多平台兼容**：打开数据目录的代码采用了条件编译以适配 macOS 与 Linux，关闭拦截逻辑对于所有平台是一致的。
11. ✅ **构建测试**：在本地成功完成 `npm run build` 和 `cargo check` 的全部校验工作，无任何报错。

## 5. 遗留问题
* macOS 系统顶部 menubar 图标的高动态主题色切换（如暗黑模式下变白）暂未做深度优化。未来建议为 macOS 配置专用的 template icon（`iconAsTemplate: true` 已配置，但可能需要单独的 icon.png 调色优化）。
