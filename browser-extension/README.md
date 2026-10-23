# Omni-Context 浏览器插件

手写的 Manifest V3 浏览器插件，当前面向 Chrome / Edge；Firefox 兼容性尚未验证。
扩展自身只把捕获内容发送到本机 Brain Server（`http://localhost:3001`）。若 Omni 配置了云端模型，Brain 可能会把相关资料片段发送给该模型提供方；请先查看 Omni 中的模型与隐私设置。

## 技术栈

- **Manifest**: Chrome Manifest V3（service worker 后台 + content script 注入）
- **样式**: Tailwind CSS（`src/input.css` → 编译为 `content.css`）
- **存储**: `chrome.storage.local`
- **通信**: 普通 HTTP fetch → `http://localhost:3001`

## 实际目录结构

```
browser-extension/
├── manifest.json          # MV3 清单
├── background.js          # service worker（后台逻辑、消息分发、ingest 提交+轮询）
├── extractor.js           # ChatGPT/Claude/Gemini 对话提取器（按角色拆 Q&A，content+popup 共用）
├── content.js             # 注入页面的捕获脚本
├── content.css            # tailwind 编译产出（不要手改）
├── popup.html             # 工具栏弹窗
├── popup.js               # 弹窗逻辑
├── icons/                 # icon16.png / icon48.png / icon128.png
├── src/
│   └── input.css          # tailwind 源文件（编译入口）
├── tailwind.config.js
└── package.json
```

## 实际权限（详见 manifest.json）

```json
{
  "permissions": [
    "activeTab",
    "storage",
    "contextMenus",
    "notifications",
    "alarms"
  ],
  "host_permissions": [
    "http://localhost:3001/*",
    "http://127.0.0.1:3001/*"
  ],
  "content_scripts": [
    { "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*", "https://claude.ai/*", "https://gemini.google.com/*"], "js": ["privacy.js", "extractor.js", "content.js"], "css": ["content.css"] }
  ]
}
```

常驻 content script 仅注入清单中的 AI 对话站点。其他网页只能在用户主动点击扩展、选择捕获或使用右键菜单时，通过 `activeTab` 临时读取当前标签页；插件不申请任意域名的 host 权限，也未声明 `clipboardRead/Write`、`tabs`、`webRequest` 等权限。

## 对话捕获（跨 AI）

在 **ChatGPT / Claude / Gemini** 页面，`extractor.js` 会识别各自的对话 DOM，按角色拆成「我 / AI」轮次；其他网页仅在用户主动捕获时读取当前页面文本。

- **手动**：用户从弹窗或右键菜单发起捕获；支持的 AI 站点会尝试按对话轮次提取。默认要求预览确认并启用敏感字段脱敏。
- **自动**（`settings.autoCapture`，默认关）：仅在支持的 AI 站点、用户主动开启自动捕获并把域名加入允许列表后运行；暂停或阻止列表仍优先生效。对话稳定后自动提交，并按会话内容签名去重。

## 通信协议

content / popup / background 通过 HTTP 调用本机 Brain Server，实际用到：

```
GET  http://localhost:3001/health                 # 连接状态
GET  http://localhost:3001/api/stats              # 记忆/关系数量
POST http://localhost:3001/api/ingest/file        # 提交捕获（base64 文本，异步 job）
GET  http://localhost:3001/api/ingest/job/:jobId  # 轮询抽取结果
POST http://localhost:3001/api/mcp/tool/ask_memory # 弹窗「问大脑」
```

所有扩展请求带 `Authorization: Bearer <本地 token>`（`/health` 除外）。扩展传输不使用 WebSocket 或云端中转；Brain 后续处理仍遵循 Omni 已配置的模型提供方与数据流设置。

## 开发与构建

```bash
cd browser-extension
npm install
npm run build       # 编译 tailwind → content.css
npm run watch       # 开发期热编译
```

加载方式：

- **Chrome / Edge**: `chrome://extensions` → 开发者模式 → "加载已解压的扩展程序" → 选 `browser-extension/` 根目录
Firefox 尚未列为已验证支持的平台。

## 发布打包

由仓库根目录的 `npm run package` 统一生成：

- `dist/browser-extension/unpacked/` —— 可直接加载的解压目录
- `dist/browser-extension/omni-context-extension.zip` —— 上架商店或分发用

打包脚本位于 `scripts/package-all.js`，仅复制发布所需文件，不会带上 `node_modules` / `src` / `tailwind.config.js`。

## 隐私与安全

- 扩展只与本机 Brain Server 通信；Brain Server 默认只听 `127.0.0.1:3001`，但所选云端模型可能接收相关资料片段
- host_permissions 限定 localhost / 127.0.0.1
- 常驻 content script 仅覆盖 manifest 列出的 AI 对话站点；其他页面由用户主动发起的当前标签页捕获读取
- 自动捕获默认关闭；启用时仍要求用户显式允许站点，并遵守暂停、阻止列表和敏感站点规则
- 未连接 Brain Server 时插件功能优雅降级（仅本地 chrome.storage）
