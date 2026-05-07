# 📋 Omni-Context v3.0 — 项目记忆文档

## 当前状态
- **项目阶段**: Phase 4: Production Release & Verification ✅
- **已完成模块**: 
  - [x] **Proactive Agent Engine**: 周期性巡视知识图谱，生成主动洞见。
  - [x] **Insight Notification System**: 桌面端实时推送通知，支持毛玻璃通知中心。
  - [x] **Cross-platform UI Fixes**: 修复了移动端 TS 报错、样式加载问题。
  - [x] **Automated Build Pipeline**: 成功生成 Windows 安装包 (`.msi`, `.exe`)。
  - [x] **Rust Environment Setup**: 配置了稳定版的 Rust 编译器与 Tauri 工具链。
- **当前任务**: 交付成果，准备归档。
- **下一步计划**: 
  - [x] **Local Test & Verification**: 验证并修复了 Tauri 构建的资源路径依赖，可以顺利打包本地测试。
  - [x] GitHub 仓库全面封板 (准备上传)。
  - [ ] 性能大规模基准测试 (10w+ 节点)。
  - [ ] 多模态视觉记忆抽取 (Phase 5 规划)。

## 架构决策

- **主动智能引擎**: 采用 `AgentLoop` 单独线程运行，避免阻塞主业务流程。通过 `SQLite` 的 `notifications` 表进行状态持久化。
- **前端状态流**: 洞见数据通过轮询 `get-latest` 接口获取，未来可升级为 WebSocket 以进一步降低延迟。
- **打包策略**: 移除了脆弱的 PowerShell 环境变量检查，通过 `scripts/build-desktop-only.js` 脚本统一环境变量 (`.cargo/bin`)，显著提升了 Windows 环境下的构建成功率。

## 重要约定

- **命名规范**: 前端组件采用 PascalCase，后端 API 遵循 RESTful 规范，数据表名复数形式。
- **UI 风格**: 强制遵循 **Cyberpunk Glassmorphism**，主色调为 `#00f2fe` (Neon Cyan) 与 `#7000ff` (Electric Purple)。
- **错误处理**: 后端必须返回 `anyhow::Result` 风格的 JSON 响应，前端通过全局 Toast 捕捉。

## 技术债务 / 待办事项

- [ ] **Mobile Sync**: 移动端目前仅能查看设置，需打通离线沉淀的同步接口。
- [ ] **Wix Bundler**: 虽然构建成功，但依赖 GitHub 稳定连接。未来建议将 Wix 离线化集成到安装目录。
- [ ] **Memory Decay**: 艾宾浩斯引擎的参数目前为硬编码，需开放 UI 配置。

---
*最后更新日期: 2026-05-07*
