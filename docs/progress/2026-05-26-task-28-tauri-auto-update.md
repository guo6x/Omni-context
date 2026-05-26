# Task 28 进度: Tauri 自动更新（updater）

## 完成内容

### 1. Tauri updater 启用

**Cargo.toml**
- tauri features 新增 `updater`

**tauri.conf.json**
- `tauri.updater.active: true`
- `tauri.updater.dialog: false` — 使用自定义 toast UI，不用内置对话框
- `tauri.updater.endpoints` — 指向 GitHub Release latest.json（含占位 owner/repo，实际使用需替换）
- `tauri.updater.pubkey` — 占位 `PLACEHOLDER_PUBKEY_BASE64`（需运行 `tauri signer generate` 生成真实密钥对）

### 2. 启动自动检查（main.rs）

- setup 钩子中 `tauri::async_runtime::spawn` 起一个 30 秒延迟任务
- sleep 30s → 调用 `app_handle.updater().check().await`
- 有更新 → emit `update-available` 事件（含 version, body, date）
- 无更新 → 静默跳过
- 网络失败 → 静默写日志（eprintln），不弹窗

### 3. 前端更新 UI

**全局事件监听** (`page.tsx`)
- 监听 `update-available` 事件 → 显示 toast 通知 "Omni-Context vX.Y.Z 可用，点此更新"
- 用户点击 → 动态导入 `@tauri-apps/api/updater` → 调用 `installUpdate()` 下载安装
- 下载失败 → toast 错误提示

**设置面板 "关于" 标签** (`SettingsPanel.tsx`)
- 新增 `about` 标签页
- 显示当前版本号 (v0.1.0)
- "检查更新" 按钮 → 调用 `checkUpdate()` from `@tauri-apps/api/updater`
- 三种状态：idle / available（绿色，点击下载）/ no-update / error

### 4. i18n

zh.ts / en.ts 新增键：
- `settings.about`, `settings.version`
- `settings.update_title`, `settings.update_available`, `settings.update_click_to_update`
- `settings.update_downloading`, `settings.update_complete`, `settings.update_no_update`
- `settings.update_check_failed`, `settings.update_download_failed`, `settings.update_refresh`

### 5. 发版自动化

**`.github/workflows/release.yml`**
- tag push (`v*`) 触发
- 构建 brain-server + desktop-daemon (Next.js) → bundle → Tauri build
- 使用 `tauri-apps/tauri-action@v0` 官方 Action
- `includeUpdaterJson: true` → 自动生成 `latest.json`
- `updaterJsonPreferNsis: true` → Windows 用 NSIS 安装包格式

**`.gitignore`**
- 新增 `*.key` 和 `tauri_priv.key` 排除规则

### 6. 文档

**`docs/RELEASING.md`**
- 首次配置：生成密钥对、配置公钥、设置 GitHub Secrets
- 发版流程：`npm version patch && git push --follow-tags`
- 本地测试：mock `latest.json` + 静态 HTTP 服务器
- 更新流程图

## 构建结果

| 项目 | 结果 |
|------|------|
| desktop-daemon `cargo check` | ✅ (仅 dead_code 警告) |
| desktop-daemon `npx tsc --noEmit` | ✅ |
| desktop-daemon `npm run build` (Next.js) | ✅ |

## 测试方法

1. 启动桌面 App → 等待 30 秒 → 查看控制台输出 "检查更新..."
2. 设置面板 → 关于 → 点击"检查更新"按钮
3. Mock 更新测试：修改 `tauri.conf.json` endpoints 为本地 `http://localhost:8080/latest.json`，启动本地 HTTP 服务器，构造 `latest.json` 指向新版本签名包

## 遗留

- 真实端点需用户替换 `tauri.conf.json` 中的 `<owner>/<repo>` 占位符
- 签名密钥对需用户手动运行 `tauri signer generate` 生成
- GitHub Secrets (`TAURI_PRIVATE_KEY`, `TAURI_KEY_PASSWORD`) 需用户手动配置
- 仅配置了 Windows 平台构建（macOS/Linux 按需扩展 matrix）
