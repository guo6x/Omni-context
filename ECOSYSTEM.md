# Omni-Context 完整生态系统

Omni-Context 是一个全域 AI 记忆操作系统，通过桌面应用、浏览器插件、移动端和可选硬件，打造无缝的知识管理体验。

## 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        Omni-Context Ecosystem                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌──────────────────┐    ┌────────────┐  │
│  │   Desktop App   │    │  Browser Plugin  │    │ Mobile App │  │
│  │  (Tauri + React)│◄──►│ (Chrome/Edge/Ff) │◄──►│ (iOS/Android)│
│  └─────────┬───────┘    └────────┬─────────┘    └────────────┘  │
│            │                     │                               │
│            │                     │                               │
│            └─────────┬───────────┘                               │
│                      │                                           │
│           ┌──────────▼───────────┐                              │
│           │  Brain Server (MCP)  │                              │
│           └──────────┬───────────┘                              │
│                      │                                           │
│          ┌───────────▼────────────┐                            │
│          │  SQLite + Knowledge    │                            │
│          │       Graph DB         │                            │
│          └────────────────────────┘                            │
│                                                                 │
│  ┌───────────────────┐  ┌─────────────────────┐                │
│  │ ESP32 Hardware    │  │  MCP Clients (IDE)  │                │
│  │ (Optional)        │  │ (Trae/Cursor/VS Code)│                │
│  └───────────────────┘  └─────────────────────┘                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 完整项目结构

```
omni-context/
├── desktop-daemon/         # 桌面应用（核心）
│   ├── src-tauri/         # Rust 后端 + Brain Server
│   │   ├── src/           # Rust 源代码
│   │   └── icons/         # 应用图标
│   ├── src/               # React 前端
│   │   ├── components/    # UI 组件
│   │   ├── hooks/         # React Hooks
│   │   ├── locales/       # 多语言
│   │   └── app/           # Next.js 页面
│   └── package.json
├── brain-server/          # Brain Server（已集成到桌面应用）
│   ├── src/
│   │   ├── graphrag/      # 知识图谱引擎
│   │   ├── memory/        # Letta 多级内存
│   │   ├── db/            # 数据库
│   │   └── mcp-server.ts  # MCP 服务器
│   └── package.json
├── browser-extension/     # 浏览器插件
│   ├── src/
│   │   ├── contents/      # 内容脚本
│   │   ├── popup/         # 弹出窗口
│   │   ├── background/    # 后台脚本
│   │   └── components/    # 插件组件
│   └── package.json
├── mobile-app/            # 移动端应用
│   ├── src/
│   │   ├── screens/       # 移动端页面
│   │   ├── components/    # 移动端组件
│   │   ├── services/      # 移动端服务
│   │   └── hooks/         # 移动端 Hooks
│   ├── android/
│   └── ios/
├── hardware/              # 硬件神经末梢（可选）
│   └── esp32-firmware/    # ESP32 固件
├── shared/                # 共享代码
│   ├── types.ts           # 共享类型
│   └── constants.ts       # 共享常量
├── README.md              # 主文档
├── ECOSYSTEM.md           # 本文档
└── BUILDING.md            # 构建文档
```

## 各组件详细说明

### 1. 桌面应用（核心）

**状态**: ✅ 架构已设计完成，代码已实现

**功能**:
- ✅ 一体化启动（包含 Brain Server）
- ✅ 键盘快捷键（可自定义）
- ✅ 知识图谱可视化
- ✅ 系统控制台
- ✅ HUD 悬浮通知
- ✅ 设置面板
- ✅ 多语言支持（中文/英文）
- ✅ 深色主题
- 🔄 屏幕捕获（需要完善）
- 🔄 ESP32 硬件集成（可选）

**技术栈**:
- Tauri (Rust)
- Next.js + React
- React Flow
- Tailwind CSS

### 2. Brain Server（核心）

**状态**: ✅ 架构已设计完成，代码已实现，已集成到桌面应用

**功能**:
- ✅ MCP 协议服务器
- ✅ GraphRAG 知识图谱引擎
- ✅ Letta 多级内存系统
- ✅ SQLite 本地存储
- ✅ 可独立运行
- ✅ 可集成到桌面应用

**技术栈**:
- Node.js + TypeScript
- MCP SDK
- SQLite3

### 3. 浏览器插件

**状态**: ✅ 架构已设计完成，待实现

**功能**:
- 网页内容捕获和沉淀
- HUD 悬浮通知
- 智能建议和知识卡片
- 右键菜单集成
- 键盘快捷键
- 本地缓存和离线模式

**技术栈**:
- 原生 Manifest V3 (Chrome/Edge) 与 V2 (Firefox)
- Chrome Extensions API
- 通过 HTTP REST 调用 Brain Server（3001）

**支持浏览器**:
- ✅ Chrome / Edge (Manifest V3)
- ✅ Firefox (Manifest V2)
- ✅ Brave / Vivaldi 等 Chromium 系
- ⚠️ Safari 未实现（需要 Safari Web Extension 适配）

### 4. 移动端应用

**状态**: ✅ 架构已设计完成，待实现

**功能**:
- 知识图谱浏览
- 快速拍照捕获
- 语音输入
- 时间线记忆浏览
- 与桌面应用同步
- 离线模式
- 3D Touch 快捷操作

**技术栈**:
- React Native / Expo
- NativeWind (Tailwind for Native)
- React Navigation
- HTTP 同步（同 LAN 内访问 Brain Server 3001）
- SQLite 本地存储 (expo-sqlite)

**支持平台**:
- ✅ iOS
- ✅ Android

### 5. ESP32 硬件（可选）

**状态**: ✅ 架构已设计完成，待实现

**功能**:
- 物理按键触发沉淀
- 物理按键触发决策查询
- 物理按键触发重置
- UDP 低延迟通信
- 状态 LED 指示
- 极低功耗待机

**硬件清单**:
- ESP32 开发板
- 3 个按键开关
- 1 个状态 LED
- 面包板和跳线

## 通信协议

### 组件间通信

```
┌───────────────────────────────────────────────────────────┐
│                    通信协议矩阵（实际实现）                 │
├───────────────┬─────────────────────┬────────────────────┤
│  From\To      │  Brain Server       │  Note              │
├───────────────┼─────────────────────┼────────────────────┤
│ Desktop UI    │ HTTP (3001)         │ fetch + bearer     │
├───────────────┼─────────────────────┼────────────────────┤
│ Browser Ext   │ HTTP (3001)         │ 同 LAN，CORS 允许  │
├───────────────┼─────────────────────┼────────────────────┤
│ Mobile App    │ HTTP (3001)         │ LAN 内可达即可     │
├───────────────┼─────────────────────┼────────────────────┤
│ ESP32         │ UDP (本机 9090)     │ 远程需 OMNI_UDP_BIND │
├───────────────┼─────────────────────┼────────────────────┤
│ MCP Clients   │ stdio (MCP)         │ IDE 直连           │
└───────────────┴─────────────────────┴────────────────────┘
```

> ⚠️ 实现说明：当前不存在跨进程 WebSocket 推送通道。早期文档描述的
> `WebSocket 9999` / `mDNS` 只是设计草稿，实际通信是各客户端各自轮询
> Brain Server 的 HTTP API（3001）。UDP 9090 默认仅监听 `127.0.0.1`，
> ESP32 等远程硬件需要在 desktop-daemon 启动前设置
> `OMNI_UDP_BIND=0.0.0.0:9090`。

### 统一消息格式

```typescript
// 消息类型
type MessageType = 
  | 'PRECIPITATE'        // 沉淀知识
  | 'SEARCH'             // 搜索记忆
  | 'GET_GRAPH'          // 获取知识图谱
  | 'SYNC'               // 数据同步
  | 'PING'               // 心跳检测
  | 'SETTINGS'           // 设置更新
  | 'NOTIFICATION';      // 通知

// 通用消息格式
interface Message {
  type: MessageType;
  id: string;
  timestamp: number;
  payload: any;
  client: 'desktop' | 'browser' | 'mobile' | 'esp32' | 'mcp';
}
```

## 数据同步策略

### 同步模型

- **中心**: 桌面应用是同步中心
- **增量**: 所有同步使用增量 JSON patch
- **离线**: 所有组件支持完全离线使用
- **冲突**: 使用时间戳 + 用户选择解决冲突
- **暂存**: 未同步的内容暂存在本地，等连接后自动同步

### 同步流程

```
用户沉淀知识
       ↓
    [本地 SQLite 缓存（移动端 / 浏览器扩展）]
       ↓
    [HTTP POST → Brain Server 3001（自动重试）]
       ↓
    [Brain Server]
       ↓
    [SQLite + 向量索引 + GraphRAG]
       ↓
    [其他客户端通过 GET / SSE 拉取]
```

## 多语言支持

**已支持语言**:
- ✅ 中文 (zh)
- ✅ 英文 (en)

**扩展方式**:
- 在对应项目的 `locales/` 目录添加新语言文件
- 自动检测用户语言
- 支持运行时切换

## 主题系统

**主题类型**:
- 深色主题（默认，黑客风格）
- 浅色主题
- 跟随系统

**强调色选项**:
- 青色 (#22d3ee) - 默认
- 紫色 (#a855f7)
- 粉色 (#f472b6)
- 绿色 (#10b981)
- 琥珀色 (#f59e0b)

## 安全与隐私

### 安全原则

1. **数据主权**: 所有数据存储在本地，不经过云端
2. **可选同步**: 用户可选择是否启用跨设备同步
3. **最小权限**: 只申请必需的系统权限
4. **加密传输**: 所有本地通信可以选择启用 TLS
5. **本地加密**: 本地数据可以设置密码加密（可选）

### 权限说明

| 组件 | 权限 | 用途 |
|-----|------|------|
| 桌面应用 | 屏幕捕获 | 沉淀当前屏幕内容 |
| 桌面应用 | 剪贴板 | 读取/写入剪贴板内容 |
| 桌面应用 | UDP 监听 | 监听 ESP32 硬件事件 |
| 浏览器插件 | 标签页访问 | 分析网页内容 |
| 浏览器插件 | 活动标签页 | 捕获当前页面 |
| 浏览器插件 | 右键菜单 | 添加入口 |
| 浏览器插件 | 通知 | 显示 HUD 提示 |
| 移动端 | 相机 | 拍照沉淀知识 |
| 移动端 | 麦克风 | 语音输入（可选） |
| 移动端 | 本地网络 | 与桌面应用同步 |

## 开发与构建

### 开发模式

#### 桌面应用
```bash
cd desktop-daemon
npm run tauri:dev
```

#### 浏览器插件
```bash
cd browser-extension
npm run dev
```

#### 移动端
```bash
cd mobile-app
npm start
```

### 生产构建

完整构建请参考 [BUILDING.md](./BUILDING.md)

## 产品呈现方式

产品可以以下方式呈现：
1. **桌面应用** - 完整功能
2. **浏览器插件** - 网页集成
3. **移动端** - 随时随地
4. **MCP 集成** - IDE 内的智能助手
5. **硬件按键** - 物理控制（可选）

## 开发路线图

### Phase 1: 核心功能（当前）
- ✅ 桌面应用架构
- ✅ Brain Server 集成
- ✅ 多语言支持
- ✅ 设置面板
- ✅ 键盘快捷键
- 🔄 完善 UI 交互
- 🔄 完善屏幕捕获

### Phase 2: 浏览器插件
- ⏳ 基础插件结构
- ⏳ 网页内容捕获
- ⏳ 智能建议
- ⏳ 与桌面应用同步

### Phase 3: 移动端
- ⏳ iOS/Android 应用
- ⏳ 知识图谱浏览
- ⏳ 拍照沉淀
- ⏳ 数据同步

### Phase 4: 硬件与生态
- ⏳ ESP32 硬件
- ⏳ 更多 MCP 集成
- ⏳ 高级知识提取

## 贡献

欢迎贡献！请阅读项目文档和代码约定。

## 许可证

MIT License
