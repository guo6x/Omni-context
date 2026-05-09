# Omni-Context 浏览器插件

手写的 Manifest V3 浏览器插件，兼容 Chrome / Edge / Firefox 109+。
默认仅与本机 Brain Server（`http://localhost:3001`）通信，**不向任何第三方发送请求**。

## 技术栈

- **Manifest**: Chrome Manifest V3（service worker 后台 + content script 注入）
- **样式**: Tailwind CSS（`src/input.css` → 编译为 `content.css`）
- **存储**: `chrome.storage.local`
- **通信**: 普通 HTTP fetch → `http://localhost:3001`

## 实际目录结构

```
browser-extension/
├── manifest.json          # MV3 清单
├── background.js          # service worker（后台逻辑、消息分发）
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
    { "matches": ["<all_urls>"], "js": ["content.js"], "css": ["content.css"] }
  ]
}
```

注：`<all_urls>` 仅出现在 `content_scripts.matches`（划词捕获要在所有页面工作），
插件**不申请任意域名的 host 权限**——所有出站 fetch 都被限制在 localhost。
也未声明 `clipboardRead/Write`、`tabs`、`webRequest` 等敏感权限。

## 通信协议

content / popup / background 通过 HTTP 调用本机 Brain Server，例如：

```
POST http://localhost:3001/api/graph/extract
POST http://localhost:3001/api/memory/archival
GET  http://localhost:3001/api/notifications
```

不使用 WebSocket，没有云端组件。

## 开发与构建

```bash
cd browser-extension
npm install
npm run build       # 编译 tailwind → content.css
npm run watch       # 开发期热编译
```

加载方式：

- **Chrome / Edge**: `chrome://extensions` → 开发者模式 → "加载已解压的扩展程序" → 选 `browser-extension/` 根目录
- **Firefox 109+**: `about:debugging` → 此 Firefox → 临时载入附加组件 → 选 `manifest.json`

## 发布打包

由仓库根目录的 `npm run package` 统一生成：

- `dist/browser-extension/unpacked/` —— 可直接加载的解压目录
- `dist/browser-extension/omni-context-extension.zip` —— 上架商店或分发用

打包脚本位于 `scripts/package-all.js`，仅复制发布所需文件，不会带上 `node_modules` / `src` / `tailwind.config.js`。

## 隐私与安全

- 仅与本机 Brain Server 通信；Brain Server 默认只听 `127.0.0.1:3001`
- host_permissions 限定 localhost / 127.0.0.1
- content_scripts 的 `<all_urls>` 仅用于划词触发，不向外上传页面正文
- 未连接 Brain Server 时插件功能优雅降级（仅本地 chrome.storage）
