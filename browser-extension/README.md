# Omni-Context 浏览器插件

基于 Plasmo 框架的浏览器插件，支持 Chrome/Edge/Firefox，为用户提供网页内容捕获和同步功能。

## 技术栈

- **框架**: Plasmo (现代浏览器插件框架)
- **UI**: React 18 + Tailwind CSS
- **存储**: chrome.storage.local
- **通信**: WebSocket + Message Passing
- **多语言**: 中文/英文支持

## 目录结构

```
browser-extension/
├── src/
│   ├── background/
│   │   └── index.ts              # 后台脚本，处理 WebSocket 连接
│   ├── contents/
│   │   └── index.tsx             # 内容脚本，注入到网页
│   ├── popup/
│   │   └── index.tsx             # 弹出窗口 UI
│   ├── options/
│   │   └── index.tsx             # 选项页
│   ├── components/
│   │   ├── HUD.tsx               # HUD 悬浮通知
│   │   ├── CaptureButton.tsx     # 捕获按钮
│   │   └── QuickActions.tsx      # 快捷操作
│   ├── hooks/
│   │   ├── useConnection.ts      # 连接状态 Hook
│   │   └── useCapture.ts         # 捕获 Hook
│   ├── services/
│   │   ├── desktopService.ts     # 桌面应用通信
│   │   ├── contentExtractor.ts   # 内容提取
│   │   └── storage.ts            # 本地存储
│   ├── locales/
│   │   ├── zh.ts                 # 中文
│   │   └── en.ts                 # 英文
│   └── manifest.json             # 插件清单
├── package.json
├── tsconfig.json
├── tailwind.config.js
└── postcss.config.js
```

## 核心功能

### 1. 内容捕获

- **网页捕获**: 一键提取页面主要内容
- **选区捕获**: 捕获用户选择的文字
- **链接捕获**: 快速保存网页链接
- **智能提取**: 自动识别标题、代码、表格等

### 2. HUD 悬浮通知

- 捕获成功/失败提示
- 同步状态显示
- 可配置显示时长

### 3. 快捷操作

- 添加笔记
- 添加标签
- 快速发送到桌面应用

### 4. 多语言

- 中文/英文双语
- 自动检测浏览器语言

## 快速开始

### 安装依赖

```bash
cd browser-extension
npm install
```

### 开发模式

```bash
npm run dev
```

#### Chrome/Edge

1. 打开 `chrome://extensions`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `build/chrome-mv3-dev` 目录

#### Firefox

1. 打开 `about:debugging`
2. 选择"此 Firefox"
3. 点击"临时载入附加组件"
4. 选择 `build/firefox-mv2-dev` 目录下的 `manifest.json`

### 生产构建

```bash
# 构建
npm run build

# 打包
npm run package
```

## 权限说明

```json
{
  "permissions": [
    "activeTab",       // 当前标签页访问
    "storage",         // 本地存储
    "clipboardRead",   // 剪贴板读取
    "clipboardWrite",  // 剪贴板写入
    "contextMenus",    // 右键菜单
    "notifications"    // 通知
  ],
  "host_permissions": [
    "<all_urls>"       // 所有网页访问
  ]
}
```

## 通信协议

浏览器插件与桌面应用通过 WebSocket 通信：

- **端口**: 3030
- **地址**: ws://localhost:3030
- **消息格式**: JSON

```typescript
// 消息类型
type Message = {
  id: string;
  action: 'capture_page' | 'capture_selection' | 'sync_context' | 'get_status';
  data: any;
  timestamp: string;
};
```

## UI 风格

- 深色主题（与桌面应用一致）
- 霓虹绿色主色调
- 玻璃拟态效果
- 流畅动画过渡

## 图标

插件需要以下尺寸的图标：
- icon-16.png
- icon-32.png
- icon-48.png
- icon-128.png

请将图标放置在 `src/` 目录下，或使用 Plasmo 的图标生成功能。

## 隐私与安全

- **数据主权**: 所有数据优先本地处理
- **权限最小化**: 只申请必需的浏览器权限
- **可选连接**: 用户可选择不连接桌面应用
- **无云依赖**: 核心功能完全本地化
