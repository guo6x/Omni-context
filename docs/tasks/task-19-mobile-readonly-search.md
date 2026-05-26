# Task 19: 移动端只读搜索 MVP（P4）

## 背景

`mobile-app/src/screens/` 当前只有 4 个文件，且 [QuickCaptureScreen.tsx](D:\AI_code\Omni-context\omni-context-release\mobile-app\src\screens\QuickCaptureScreen.tsx) 只有 316 字节（占位）。产品定位是"全域物理级 AI 记忆操作系统"，但**移动端基本是空的**。

用户最常见的诉求是"在手机上查一下之前沉淀的知识"。完整的截屏沉淀能力放移动端复杂（权限多、电量敏感），先做**只读搜索**就有产品价值。

## 目标

把移动端从占位升级到"能查"的状态。

成功标准：

1. 启动移动端 App → 配置 Brain Server 地址（默认 `http://<局域网 IP>:3001`，或者远程公网 URL）
2. 主页是搜索框 + 结果列表（跟桌面 Spotlight 风格类似但适配移动）
3. 输入查询 → 调 `/api/entities/search` + `/api/memory/archival/search` + `/api/memory/core/search`
4. 结果点开看详情（实体描述 / archival 全文 / core 内容）
5. 实体详情页能看到相关图谱（邻居节点列表）
6. 不做：截屏沉淀、上传、HUD、AgentLoop 等桌面端能力

## 涉及文件

- `mobile-app/src/screens/`
  - 改 / 新建：`SearchScreen.tsx`（主搜索）、`MemoryDetailScreen.tsx`（结果详情）、`SettingsScreen.tsx`（已有，加 brain-server URL 配置）
  - 删 / 改：`QuickCaptureScreen.tsx`（移除占位）
- `mobile-app/src/lib/`（新建）
  - `brainServerClient.ts`：封装 fetch 调用 brain-server 三个搜索 API
  - `config.ts`：存 brain-server URL，用 AsyncStorage
- `mobile-app/src/App.tsx`（或 navigator 入口）
  - 路由调整：默认进 SearchScreen，可去 Settings 改 URL

## 约束

- **移动端不要 spawn brain-server**——它就是个 HTTP client，brain-server 跑在用户的电脑 / 公网服务器上
- **不要做截屏 / 拖文件上传 / OCR**——本期只读
- **不要做账号系统**——用户填 URL 直连就行（局域网信任模型）
- 网络层错误友好提示（"无法连接，请检查 Brain Server 地址"）
- 中英文 i18n 至少支持两种
- React Native（看 mobile-app 当前用的是不是 RN 还是别的）—— 跟现有技术栈一致就好，不要换框架
- 不要追求 UI 多酷炫，能用就行

## 验收标准

1. ✅ 移动端能跑起来（emulator / 真机）
2. ✅ 第一次启动引导用户填 brain-server URL
3. ✅ 配好 URL 后能搜，三个 API 都通
4. ✅ 实体结果点进去看详情 + 相关节点
5. ✅ archival 结果点进去看全文
6. ✅ brain-server 关掉时显示连接错误，不崩
7. ✅ 中英切换可用

## 进度文档

`docs/progress/2026-05-25-task-19-mobile-readonly-search.md`

包含：
- 当前 mobile-app 用的什么技术栈 / 现有结构梳理
- 改动 / 新增文件
- 怎么调试（emulator 命令 / 真机连接说明）
- 自测结果（建议附几张截图）

## 不要做的事

- 不要把移动端做成完整功能镜像——只读搜索是 MVP 范围
- 不要做推送通知 / 后台同步——这些是后续 task
- 不要做账号系统 / 多用户支持
- 不要顺便把浏览器扩展也改了
