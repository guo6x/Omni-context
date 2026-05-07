# 🧠 Omni-Context v3.0 — 全域主动智能 AI 记忆操作系统

Omni-Context 是一个跨平台的开源 AI 记忆中枢，它致力于做你的“第二大脑”。在 v3.0 版本中，我们引入了 **Proactive Agent (主动智能引擎)**，它不再仅仅是被动等待指令，而是会主动分析你的知识图谱，为你生成跨越维度的深度洞见。

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

- **桌面端 (Desktop)**: Next.js + Tauri + TailwindCSS (v4) + Radix UI. 包含系统级的屏幕/剪贴板捕获。
- **后台大脑 (Brain Server)**: Node.js + Express + SQLite-vec + Agent Loop. 负责所有计算、检索与主动分析任务。
- **移动端 (Mobile App)**: React Native + Expo + NativeWind. 支持远程同步与洞见查看。
- **浏览器插件 (Extension)**: 全新重构的 Manifest V3 插件，实现网页内容的一键深度沉淀。

---

## 🚀 快速开始与安装

如果您使用的是 Windows 系统，我们提供了全自动的构建脚本。

### 📦 一键打包 (推荐)
在项目根目录下，使用 PowerShell 执行：
```powershell
.\package-windows.ps1
```
该脚本将自动执行以下操作：
1. 环境检查与 Rust 工具链配置
2. Brain Server 编译与依赖封装
3. 前端 Next.js 静态构建
4. 生成完整的 `.msi` 安装包与 `.exe` 绿色安装程序

### 🛠️ 手动开发模式
```bash
# 1. 启动 Brain Server (后端)
cd brain-server && npm install && npm run build && npm start

# 2. 启动 Desktop (前端)
cd desktop-daemon && npm install && npm run tauri dev
```

---

## ⚙️ 大模型 (LLM) 配置
Omni-Context v3.0 现已支持**多模型热切换**。在应用内进入 `Settings -> LLM Configuration`，填入您的 API Key 与端点地址。
> [!TIP]
> 推荐使用 **DeepSeek-V3** 或 **GPT-4o** 以获得最佳的主动分析效果。

---

## 📄 许可证与贡献
本项目基于 **MIT License** 开源。
欢迎任何形式的 Pull Request 与 Issues，让我们一起构建人类最强的第二大脑！
