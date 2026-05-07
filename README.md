# 🧠 Omni-Context v2.0 - 全域物理级 AI 记忆操作系统

Omni-Context 是一个跨平台的开源 AI 记忆中枢，它致力于做你的“第二大脑”。通过桌面端、浏览器插件、移动端和可选硬件的配合，它可以随时随地捕获你的屏幕、剪贴板、网页内容，并将它们提炼为结构化的知识图谱（基于 GraphRAG），实现永久沉淀与极速检索。

---

## ✨ 核心特性 (v2.0 最佳形态)

*   **⚡ 百万级极速检索**：底层采用 `sqlite-vec` 提供原生 KNN 向量检索 (Float32)，并结合 FTS5 (Unicode61) 实现毫秒级全文倒排索引，彻底告别内存扫描的性能瓶颈。
*   **🕸️ 三层统一融合记忆**：首创融合向量相似度、全文检索匹配、图谱实体关联的三层检索系统，一次搜索即可获得所有维度相关的完整上下文。
*   **🧠 LLM 双轨提取管线**：知识抽取采用“正则规则先行，大模型 (LLM) 语义增强”的双层架构，兼顾了提取的稳定性与语义的深度理解。原生支持接入 OpenAI/Ollama 等兼容 API。
*   **⏳ 艾宾浩斯智能遗忘引擎**：内置自动化记忆衰减调度器 (`MemoryDecayScheduler`)，根据你的访问频次与时间衰减曲线自动调整知识的活跃权重，让图谱始终保持“鲜活”。
*   **🌌 3D 知识可视化**：内置基于 `react-force-graph-3d` 的全景 3D 渲染引擎，复杂知识体系一览无余。
*   **🔌 MCP 多维融合协议**：后端大脑同时通过标准 `stdio` (供桌面端) 与 `HTTP` (供浏览器/移动端) 暴露 MCP 协议与 REST API，实现全生态的无缝接入。

---

## 📂 生态系统架构

Omni-Context 由以下几个主要模块构成：

*   **`desktop-daemon/`**：【核心】桌面主程序 (基于 Tauri + Next.js)，内置 3D 图谱视图与设置面板。
*   **`brain-server/`**：【大脑】核心知识处理中心 (基于 Node.js)，包含 LLM 提取管线、多模态 OCR 以及 SQLite 知识库。
*   **`browser-extension/`**：【终端】浏览器插件，实现网页内容的快速剪藏与捕捉。
*   **`mobile-app/`**：【终端】移动端应用 (React Native)，让你在离线或户外依然可以沉淀想法。
*   **`hardware/`**：【终端】基于 ESP32 的一键沉淀实体按钮固件。

> 📖 关于项目架构设计的深入解析，请查看 [ECOSYSTEM.md](./ECOSYSTEM.md)。

---

## 🚀 快速开始与安装

如果您使用的是 Windows 系统，并且希望直接获取最新的可执行程序：

在项目根目录下直接使用 PowerShell 运行我们提供的全自动打包脚本：
\`\`\`powershell
.\package-windows.ps1
\`\`\`
*(该脚本将自动帮您检测并安装 Rust 环境，自动编译 Brain Server 并打出完整的 .exe 和 .msi 安装包！)*

### 🛠️ 手动开发与运行

如果您想进行二次开发或本地测试，可以按照以下步骤操作：

1. **安装依赖**
   \`\`\`bash
   # 为桌面端安装依赖
   cd desktop-daemon
   npm install

   # 为后端大脑安装依赖
   cd ../brain-server
   npm install
   \`\`\`

2. **启动本地开发服务器**
   \`\`\`bash
   cd desktop-daemon
   npm run tauri dev
   \`\`\`
   *(Tauri 启动时，会自动在后台启动并接管 `brain-server`)*

> 详细的构建打包说明，请参考 [docs/PACKAGE.md](./docs/PACKAGE.md) 与 [docs/BUILDING.md](./docs/BUILDING.md)。

---

## ⚙️ 大模型 (LLM) 配置说明

Omni-Context 需要配合云端或本地的 LLM 来实现高质量的图谱提取。
在成功运行桌面端后，您可以在 **设置 (Settings) -> 大模型配置 (LLM)** 选项卡中，自由填入：
*   **API URL**: 例如 \`https://api.openai.com/v1\` 或是 \`http://localhost:11434/v1\`
*   **API Key**: 您获取的专属密钥 (Ollama 等免秘钥本地模型留空即可)
*   **Model**: 您的目标模型名称 (例如: \`gpt-4o\`, \`qwen2.5:7b\`)

配置保存后，重启应用即可生效，您的每次“沉淀”操作都将由该 LLM 进行智能总结并存入 3D 知识图谱！

---

## 📄 许可证

本项目基于 [MIT License](./LICENSE) 开源。
欢迎任何形式的 Pull Request 与 Issues！
