# 🧠 Omni-Context — 本地优先的 AI 记忆 / 决策中枢

Omni-Context 是一个**完全本地、跨平台的开源 AI 第二大脑**。你在桌面端或浏览器里捕获的信息，
会被自动结构化成一张持续生长的**知识图谱**；这张图谱既服务于你，也能通过标准 MCP 协议
挂给其他 AI 产品，作为它们的「记忆 / 决策层」。

> **项目状态（桌面端版本 0.1.0）**：桌面端 + 浏览器插件 + 数字脑子（MCP）这条线已完成并经过
> 端到端验证，可打包安装使用。数据全部存放在本地 SQLite——**不含**多用户、密码、加密落盘、
> 云端同步、公网鉴权等能力，这是「本地优先」的刻意取舍。
> 移动端 / ESP32 硬件目前**暂缓**（代码在仓库里，视后续需求再延伸）；桌面端的系统级屏幕捕获
> 仍为实验性。

---

## ✨ 核心特性

* **🕸️ 知识图谱抽取**：文本、文件、图片（OCR）经 GraphRAG 抽取成「实体 + 关系」入图谱。
  正则 + LLM 双层抽取，已用云端模型端到端验证。
* **🧠 数字脑子（MCP 对外接口）**：通过标准 Model Context Protocol，把这张图谱挂给
  Cursor / Claude 等任意兼容 AI。核心工具 `get_decision_context`——给一个处境，一次性返回
  相关原则、历史先例与历史冲突，让外部 AI 基于你的历史做判断。详见
  [docs/MCP-INTEGRATION.md](./docs/MCP-INTEGRATION.md)。
* **⏳ 时序知识图谱**：关系带「有效期」，事实变化时**失效而非删除**；新知识入库时自动检测
  与旧知识的冲突——取代旧的就让它失效，genuine 冲突就显式标记出来。
* **🔔 主动洞见引擎**：Proactive Agent 定期扫描图谱，发现跨记忆的潜在关联后主动推送 Insight。
* **🔍 三层融合检索**：向量（sqlite-vec 原生 KNN）+ 全文（FTS5）+ 图谱遍历，一次查询穿透。
* **📴 全离线、零网络依赖**：embedding 模型与 OCR 语言包都已内置进安装包，断网也能用。
* **🛠️ LLM 可配置**：在设置里填入云端或本地大模型（DeepSeek、GPT-4o、Ollama 等）的
  API 地址与 Key，即时生效。
* **🩺 系统自检**：设置面板内的「系统自检」页如实展示 embedding / LLM / OCR / Agent 的真实
  健康状态，降级（如向量退化）会明确告警。

---

## 📂 架构

- **桌面端 (Desktop)**：Tauri + Next.js + TailwindCSS。主控台 + 3D 知识图谱可视化 + 悬浮 HUD。
- **后台大脑 (Brain Server)**：Node.js + SQLite（sqlite-vec + FTS5）。负责抽取、检索、图谱、
  主动分析，并通过 HTTP API 与 MCP 两个通道对外提供能力。
- **浏览器插件 (Extension)**：原生 Manifest V3（Chrome / Edge），一键沉淀网页内容。
- **MCP 接口**：Brain Server 通过 stdio 暴露 MCP 工具，供 IDE / AI Agent 接入。

> 移动端（React Native）与 ESP32 硬件的代码保留在仓库内，但当前版本不构建、不交付。

---

## 🚀 快速开始

### 📦 打包（Windows）

在项目根目录：

```bash
npm run install:all   # 首次：安装各子项目依赖
npm run package       # 构建并产出 dist/desktop-app/ 下的 .msi 与 .exe 安装包
```

安装包全离线、自带 Node 运行时与模型文件，双击 `.msi` 或 `.exe` 即可安装。
macOS / Linux 暂无打包脚本。

### 🛠️ 开发模式

```bash
# 1. 后台大脑
cd brain-server && npm install && npm run build && npm start

# 2. 桌面端
cd desktop-daemon && npm install && npm run tauri:dev
```

---

## ⚙️ 大模型配置

进入应用内 `设置 → LLM 配置`，填入 API URL、API Key 与模型名。配置会同步到 Brain Server，
即时生效。推荐 DeepSeek 或 GPT-4o 系列以获得较好的抽取与洞见质量。
未配置 LLM 时，图谱抽取会退化为仅正则层（仍可用，但语义深度有限）。

---

## 📄 许可证

本项目基于 **MIT License** 开源。欢迎 Issue 与 Pull Request。
