# Task 25 Progress: brain-server stderr/stdout 落盘

**日期**: 2026-05-26  
**状态**: 已完成

## 变更摘要

### 新建文件

- `desktop-daemon/src-tauri/src/log_writer.rs` — 日志写入 + 5MB 轮转逻辑
  - `logs_dir()`: 返回 `%LOCALAPPDATA%/omni-context/logs` 路径
  - `log_file_path()`: 返回 `brain-server.log` 完整路径
  - `write_line()`: 线程安全写入，加 `[ISO8601Z]` 时间戳，stderr 加 `[STDERR]` 前缀，失败静默 swallow
  - `rotate_if_needed()`: 超过 5MB 自动 rename 轮转（保留 3 份）

### 修改文件

- **`Cargo.toml`**: 添加 `chrono` 依赖（UTC ISO 8601 时间戳）
- **`brain_server.rs`**:
  - spawn 成功后，在 `store_process()` 前取出 stdout/stderr 句柄
  - 启动两个后台线程实时读取 stdout/stderr 并写入日志文件
  - 新增 `open_logs_folder()` 函数（跨平台 explorer/open/xdg-open）
- **`commands.rs`**: 新增 `open_logs_folder` Tauri 命令
- **`main.rs`**:
  - 注册 `mod log_writer`
  - 托盘菜单新增"打开日志目录"项 + 事件处理
  - invoke_handler 注册 `commands::open_logs_folder`
- **`SettingsPanel.tsx`**: 系统自检 Tab 标题行新增"打开日志目录"按钮
- **`zh.ts`** / **`en.ts`**: 新增 `settings.open_logs_dir` 和 `settings.open_logs_dir_desc` 文案

## 验收对照

| 标准 | 状态 |
|------|------|
| 日志实时写入 `%LOCALAPPDATA%\omni-context\logs\brain-server.log` | ✅ 后台线程 BufReader::lines() 逐行写入 |
| 格式 `[ISO8601Z] message` | ✅ chrono::Utc 格式化为 `%Y-%m-%dT%H:%M:%SZ` |
| stderr 有 `[STDERR]` 前缀 | ✅ `write_line(_, _, true)` 时加前缀 |
| 5MB 轮转，保留 .log.1/.log.2 | ✅ `rotate_if_needed()` 用 rename |
| 重启时追加不 truncate | ✅ `OpenOptions::append(true)` |
| 写入失败不阻塞 brain-server | ✅ 所有 I/O 错误 swallow |
| "打开日志目录"按钮 | ✅ 设置面板 + 托盘菜单都有 |
| `cargo check` 通过 | ✅ 零新增 warning |
