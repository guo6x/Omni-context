# Experimental Features / 实验性功能

> **These features are community-maintained and not part of the core product focus.**
> 这些功能由社区维护，不属于核心产品重心（MCP-native 本地记忆层）。

Omni-Context 的核心是 **MCP-native 本地知识图谱**（Brain Server + 桌面端 + 浏览器插件 + 对外 MCP 接口）。
以下功能作为实验性扩展存在，代码已提交但 **未经充分真机验证**。
欢迎社区贡献者测试、反馈和改进。

---

## 1. Mobile App / 移动端

| 项目 | 详情 |
|---|---|
| 技术栈 | React Native + Expo + NativeWind |
| 代码位置 | `mobile-app/` |
| 当前状态 | 只读搜索 MVP，仅通过 `tsc` typecheck，**未在真机或模拟器上验证** |
| 功能范围 | 搜索框 + 三路并发搜索 + 实体/记忆详情 + 邻居关联 |
| 鉴权方式 | LAN 内 6 位配对码（`Authorization: Bearer <code>`），`127.0.0.1` 免鉴权 |
| 打包状态 | Android `android/` 工程已生成，未出 APK；iOS 无 `ios/` 工程 |

**贡献者可以做什么 / What contributors can do：**
- 在 Android 真机或模拟器上运行 `npx expo start`，验证搜索→详情全链路
- 在 iOS 设备上生成 `ios/` 工程并测试
- 提交真机截图和 bug report

---

## 2. ESP32 Physical Button / 物理硬件按钮

| 项目 | 详情 |
|---|---|
| 代码位置 | `hardware/esp32-firmware/` |
| 当前状态 | Arduino 固件源码已提交，**未编译验证** |
| 工作原理 | 按下物理按钮 → ESP32 发送 UDP 包到 `UDP:9090` → 桌面端触发截屏沉淀 |
| 接线/BOM | 文档已完善，可复现 |
| 桌面端支持 | UDP 监听已在桌面端就绪（默认仅 `127.0.0.1`；设 `OMNI_UDP_BIND=0.0.0.0:9090` 可远程） |

**贡献者可以做什么 / What contributors can do：**
- 按 BOM 文档焊板、烧录固件
- 验证 按钮→UDP→截屏→入图谱 全链路
- 提交编译日志和实测结果

---

## 3. Screen Capture / 屏幕抓取

| 项目 | 详情 |
|---|---|
| 定位 | 桌面端核心捕获能力之一 |
| 首启默认 | **关闭**（`capturePaused=true`），出于隐私考虑 |
| 开启方式 | 设置面板 → 隐私 中手动开启 |
| 隐私保护 | 支持 **敏感应用排除名单**（blocklist），在排除名单中的应用窗口激活时自动暂停抓取 |

> [!NOTE]
> 屏幕抓取功能代码已完成且在 Windows 上验证通过，但因其涉及隐私，首启默认关闭。
> 用户需主动在设置面板中开启，并可配置排除名单以保护敏感应用。

---

## 关于这些功能 / About these features

These features are **not part of the core product focus** (MCP-native local memory layer).
They are maintained by the community. **Issues and PRs welcome!**

这些功能 **不属于核心产品重心**（MCP-native 本地记忆层），由社区维护。
欢迎提交 Issue 和 Pull Request！

- 📋 [Issues](https://github.com/guo6x/Omni-context/issues) — 报告 bug、提出改进建议
- 💬 [Discussions](https://github.com/guo6x/Omni-context/discussions) — 讨论想法、寻求帮助
- 🔧 [Contributing](./BUILDING.md) — 开发环境搭建、架构概览
