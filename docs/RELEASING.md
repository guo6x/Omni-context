# 发版流程

## 首次配置（仅需一次）

### 1. 生成签名密钥对

```bash
cargo install tauri-cli --version "^1.5"
tauri signer generate -w ~/tauri_priv.key
```

这会生成：
- `~/tauri_priv.key` — 私钥文件（**绝对保密，不要提交到仓库**）
- 同时输出公钥（base64 字符串）

### 2. 配置公钥

将公钥（base64 字符串）贴到 `desktop-daemon/src-tauri/tauri.conf.json` 的 `tauri.updater.pubkey` 字段，替换占位符 `PLACEHOLDER_PUBKEY_BASE64`。

### 3. 配置 GitHub Secrets

在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加两个 Secret：

| Name | Value |
|------|-------|
| `TAURI_PRIVATE_KEY` | `tauri_priv.key` 文件的内容（整个 base64 字符串，不含换行） |
| `TAURI_KEY_PASSWORD` | 生成密钥时设置的密码（如果没设密码可以留空或填 `""`） |

### 4. 配置 updater endpoint

修改 `desktop-daemon/src-tauri/tauri.conf.json` 中 `tauri.updater.endpoints` 的 URL：
```
"https://github.com/<你的用户名>/<你的仓库名>/releases/latest/download/latest.json"
```

将 `<你的用户名>` 和 `<你的仓库名>` 替换为实际值。

## 发版

### 自动化（推荐）

推送版本 tag 到 GitHub 即可自动触发构建和发布：

```bash
npm version patch  # 或 minor / major
git push --follow-tags
```

GitHub Actions 会自动：
1. 构建 Windows 安装包
2. 生成 `latest.json`（update manifest）
3. 上传到 GitHub Release
4. 已安装的用户启动后 30 秒内检测到新版本

### 手动测试更新

在正式发布前，可以本地 mock 测试更新流程：

1. 在本地启动静态 HTTP 服务器：
   ```bash
   cd /tmp && python -m http.server 8080
   ```

2. 构造一个 `latest.json`（参考 tauri updater manifest 格式）：
   ```json
   {
     "version": "0.2.0",
     "notes": "测试更新",
     "pub_date": "2026-05-26T12:00:00Z",
     "platforms": {
       "windows-x86_64": {
         "signature": "<签名的 base64>",
         "url": "http://localhost:8080/omni-context_0.2.0_x64-setup.exe"
       }
     }
   }
   ```

3. 修改 `tauri.conf.json` 中 endpoints 指向 `http://localhost:8080/latest.json`

4. 启动桌面 App，等待 30 秒 → 应检测到"更新"并弹 toast

注意：正式环境不需要本地测试，改为指向 GitHub Releases。

## 更新流程

```
用户启动 → 30s 延迟 → 检查更新 → 有新版本 → 弹 Toast
                                                ↓
                                       用户点击"点此更新"
                                                ↓
                                       下载 .msi/.exe
                                                ↓
                                       下载完成 → 提示重启
                                                ↓
                                       重启 → 新版本已安装
```

检查更新失败时静默失败（写日志，不弹窗）。
