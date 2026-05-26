# Task 25: brain-server stderr/stdout 落盘

## 背景

桌面 App spawn brain-server 时 `Stdio::piped()` 把子进程的 stdout/stderr 捕获到了管道，但**没有写到文件**。结果：

- 用户机器上 brain-server 出问题 → 没日志可看 → 排查只能靠"再装一次试试"
- 之前 CORS / 模型路径 bug 排查全靠用户复述错误，效率极低
- 用户想给 issue 附日志也找不到

## 目标

把 brain-server 的 stdout/stderr 实时写到 `%LOCALAPPDATA%\omni-context\logs\brain-server.log`，并做轮转避免无限增长。

成功标准：

1. brain-server 启动后所有 console.log/console.error 都进文件
2. 日志按 5MB 轮转，保留最近 3 份（`brain-server.log`、`brain-server.log.1`、`brain-server.log.2`）
3. 设置面板"系统自检"Tab 加"打开日志目录"按钮
4. 托盘菜单也加"打开日志目录"项
5. 重启 brain-server 时**追加**写入（不要 truncate），保留崩溃前的最后日志

## 涉及文件

- `desktop-daemon/src-tauri/src/brain_server.rs`
  - spawn 后的 child 拿到 stdout/stderr 句柄
  - 启动两个后台线程（或 tokio task）：
    - 一个读 stdout，每行追加到日志文件
    - 一个读 stderr，每行追加到日志文件（用 `[STDERR]` 前缀区分）
  - 每条 line 前面加时间戳 `[2026-05-26T12:34:56Z] ...`
  - 写入前检查文件大小，超过 5MB 触发轮转
- `desktop-daemon/src-tauri/src/log_writer.rs`（新建，可选）
  - 把日志写入 + 轮转逻辑封装出来
- `desktop-daemon/src-tauri/src/commands.rs`
  - 新增 `open_logs_folder()` Tauri 命令，同 `open_data_folder` 实现模式（用 std::process::Command 起 explorer/open/xdg-open）
- `desktop-daemon/src-tauri/src/main.rs`
  - 注册 invoke handler
  - 托盘菜单加"打开日志目录"
- `desktop-daemon/src/components/SettingsPanel.tsx`
  - 系统自检 Tab 加按钮 "打开日志目录"
- `desktop-daemon/src/locales/zh.ts` + `en.ts`
  - 加 `settings.open_logs_folder`、托盘菜单文案

## 约束

- **日志写入失败不能阻塞 brain-server**——文件锁定 / 磁盘满之类的错误要 swallow，brain-server 继续跑
- 时间戳用 UTC ISO 8601
- 轮转用文件 rename（不要复制大文件），原 .log 改成 .log.1，原 .log.1 改成 .log.2，原 .log.2 删掉
- **不要把敏感内容加密**——本地日志够用了，要加密就违背简洁原则
- 行长度不限（不要截断），LLM 报错 stack trace 可能很长
- 不要做远程日志上报

## 验收标准

1. ✅ 桌面 App 启动后 `%LOCALAPPDATA%\omni-context\logs\brain-server.log` 出现并实时写入
2. ✅ 日志条目格式：`[2026-05-26T03:21:00Z] [Database] sqlite-vec 扩展加载成功 ✓`
3. ✅ stderr 输出有 `[STDERR]` 前缀
4. ✅ 触发一次错误（比如配错 LLM URL）→ 错误信息能在日志里找到
5. ✅ 日志超过 5MB 时自动轮转，旧文件 .log.1 / .log.2 保留
6. ✅ "打开日志目录"按钮能弹出资源管理器
7. ✅ brain-server 重启时日志追加（不重置文件）
8. ✅ `cargo check` 通过

## 进度文档

`docs/progress/2026-05-26-task-25-brain-server-log-to-file.md`

## 不要做的事

- 不要做 UI 内置的"日志查看器"——点按钮打开资源管理器够了
- 不要做日志级别过滤（DEBUG/INFO/WARN/ERROR）——brain-server 自己的 console.log/warn/error 已经够分辨
- 不要把日志同步上传到任何地方
- 不要把当前正在运行的进程的 PID 加进日志——已经在文件里能看出来
