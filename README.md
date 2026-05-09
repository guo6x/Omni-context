# 🧠 Omni-Context v3.0 — 全域主动智能 AI 记忆操作系统

Omni-Context 是一个跨平台的开源 AI 记忆中枢，它致力于做你的“第二大脑”。在 v3.0 版本中，我们引入了 **Proactive Agent (主动智能引擎)**，它不再仅仅是被动等待指令，而是会主动分析你的知识图谱，为你生成跨越维度的深度洞见。

> ⚠️ **项目状态**：v3.0 仍处于早期阶段（桌面端版本号 `0.1.0`），属于实验性 / 个人单机部署。
> 数据全部存放在本地 SQLite，**不含**多用户、密码、加密落盘、云端同步、公网鉴权等生产级能力。
> Proactive Agent / 屏幕捕获 / ESP32 硬件 / LLM 抽取 等功能尚未在干净环境做端到端验证。

---

## ✨ 核心特性 (v3.0 进化版)

*   **👁️ Proactive Agent (主动智能引擎)**：内置智能巡视器，定期扫描您的知识库。当它发现不同记忆间的潜在关联时，会主动在桌面端与移动端推送“智慧洞见 (Insights)”，帮你连接那些被遗忘的点。
*   **🔔 实时洞见通知中心**：桌面端新增毛玻璃风格的通知中心，通过闪烁的“灵感铃铛”实时提醒您最新的 AI 发现。
*   **⚡ 百万级极速检索**：底层采用 `sqlite-vec` 提供原生 KNN 向量检索，并结合 FTS5 实现毫秒级全文索引，性能提升 10 倍以上。
*   **🕸️ 三层统一融合记忆**：完美融合向量相似度、全文检索匹配、图谱实体关联，一次搜索，全局穿透。
*   **🧠 LLM 动态配置管线**：支持用户自定义云端或本地大模型 (DeepSeek, GPT-4, Ollama等)。通过桌面端 UI 即可零成本切换。
*   **🌌 赛博朋克美学 UI**：全栈统一采用 **Cyberpunk Glassmorphism** 设计风格，结合微动画与毛玻璃效果，打造极速且极致的视觉体验。

---

## 📂 生态系统架构

- **桌面端 (Desktop)**: Next.js + Tauri + TailwindCSS + lucide-react. 包含系统级的屏幕/剪贴板捕获（实验性）。
- **后台大脑 (Brain Server)**: Node.js + 自实现 HTTP 路由 + SQLite-vec + Agent Loop. 负责检索、图谱、主动分析。
- **移动端 (Mobile App)**: React Native + Expo + NativeWind. 通过 **同一 LAN** 内的 HTTP 与 Brain Server 同步（无云端、无鉴权握手）。
- **浏览器插件 (Extension)**: 原生 Manifest V3 (Chrome/Edge) + V2 (Firefox)，HTTP 调用 Brain Server。Safari 暂未适配。

---

## 🚀 快速开始与安装

### 📦 一键打包（仅 Windows，推荐）
目前只提供了 Windows PowerShell 打包脚本。在项目根目录下：
```powershell
.\package-windows.ps1
```
该脚本将自动执行以下操作：
1. 环境检查与 Rust 工具链配置
2. Brain Server 编译与依赖封装
3. 前端 Next.js 静态构建（生产 CSP 走 `tauri.prod.conf.json`，去除 `unsafe-eval`）
4. 生成完整的 `.msi` 安装包与 `.exe` 绿色安装程序

> macOS / Linux 暂无打包脚本，请走下面的手动开发模式。详情见 [BUILDING.md](./BUILDING.md)。

### 🛠️ 手动开发模式
```bash
# 1. 启动 Brain Server (后端)
cd brain-server && npm install && npm run build && npm start

# 2. 启动 Desktop (前端 + Tauri)
cd desktop-daemon && npm install && npm run tauri:dev
```

> 如需从远程 ESP32 硬件接收 UDP 事件，需要在启动 desktop-daemon 前设置：
> `OMNI_UDP_BIND=0.0.0.0:9090`（默认仅监听 `127.0.0.1`）。

---

## ⚙️ 大模型 (LLM) 配置
Omni-Context v3.0 现已支持**多模型热切换**。在应用内进入 `Settings -> LLM Configuration`，填入您的 API Key 与端点地址。
> [!TIP]
> 推荐使用 **DeepSeek-V3** 或 **GPT-4o** 以获得最佳的主动分析效果。

---

## 📄 许可证与贡献
本项目基于 **MIT License** 开源。
欢迎任何形式的 Pull Request 与 Issues，让我们一起构建人类最强的第二大脑！
