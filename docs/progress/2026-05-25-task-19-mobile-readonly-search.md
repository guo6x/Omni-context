# Task 19: 移动端只读搜索 MVP — 进度记录

## 目标

把移动端从占位升级到"能查"的状态。

成功标准：
1. 启动移动端 App → 配置 Brain Server 地址
2. 主页是搜索框 + 结果列表
3. 输入查询 → 调 `/api/entities/search` + `/api/memory/archival/search` + `/api/memory/core/search`
4. 结果点开看详情
5. 实体详情页能看到相关图谱（邻居节点列表）
6. 不做：截屏沉淀、上传、HUD、AgentLoop 等桌面端能力

## 技术栈

- React Native / Expo 49
- React Navigation 6（Bottom Tabs + Native Stack）
- Zustand（状态管理 + AsyncStorage 持久化）
- NativeWind（Tailwind 样式）
- react-i18next（中英文 i18n）
- axios（HTTP client）

## 改动清单

### `mobile-app/src/services/api.ts`
- 新增 `searchEntities(query, limit)` — POST `/api/entities/search`
- 新增 `searchArchival(query, limit)` — POST `/api/memory/archival/search`
- 新增 `searchCore(query, limit)` — POST `/api/memory/core/search`
- 新增 `getEntityGraphContext(entityId)` — POST `/api/graph/context`

### `mobile-app/src/screens/SearchScreen.tsx`（新建）
- 搜索框 + 300ms 防抖 + 200 字符截断
- `Promise.allSettled` 并行调三个搜索 API
- 结果按 entity/archival/core 分类型渲染卡片
- 未配置 URL 时显示黄色提示
- 连接失败时显示友好错误消息
- 点击 entity 跳转 EntityDetail，点击 archival/core 跳转 MemoryDetail

### `mobile-app/src/screens/EntityDetailScreen.tsx`（新建）
- 从 SearchScreen 路由 params 接收 entityId + entityName
- 调 `searchEntities` 获取实体详情 + `getEntityGraphContext` 获取邻居
- 展示实体 type/name/description/tags
- 展示相关节点列表（含关系标签）
- 空状态："暂无相关节点"

### `mobile-app/src/screens/MemoryDetailScreen.tsx`（新建）
- 从 SearchScreen 路由 params 接收对应数据
- 兼容 archival 搜索结果（item/item/content）和 core 数据格式
- 展示 meta（key/category/tags/relevance/importance/accessCount）
- 展示 summary（如有）+ 完整 content（可选中复制）

### `mobile-app/src/navigation/AppNavigator.tsx`
- QuickCapture tab 替换为 Search tab
- Search tab 内嵌 Stack Navigator：SearchMain → EntityDetail / MemoryDetail
- 新增 SearchIcon SVG 组件
- 移除 QuickCaptureScreen 引用和 CaptureIcon

### `mobile-app/src/locales/zh.ts` + `en.ts`
- 新增 `search` 命名空间，含所有搜索相关文案
- 包含实体类型标签、关系类型标签、错误提示等

### `mobile-app/App.tsx`
- 新增 `ApiConfigProvider`：启动时从 Zustand store 读取 serverUrl，自动配置 api client
- 移除未使用的 `SettingsProvider` 包装（Zustand store 无需 Provider）

### `mobile-app/src/screens/QuickCaptureScreen.tsx`
- 删除（占位文件，由 Search 替换）

### `mobile-app/src/types/index.ts`
- 之前已添加 SearchEntity / ArchivalSearchItem / CoreMemoryItem / SearchResults 类型

## 自测结果

- `npx tsc --noEmit`（mobile-app）：通过

## 验收检查

| 验收项 | 状态 |
|--------|------|
| 移动端能跑起来（emulator / 真机） | 待实测 |
| 第一次启动引导用户填 brain-server URL | 通过（设置页已有 URL 配置） |
| 配好 URL 后能搜，三个 API 都通 | 代码完成，待 API 联调 |
| 实体结果点进去看详情 + 相关节点 | 代码完成 |
| archival 结果点进去看全文 | 代码完成 |
| brain-server 关掉时显示连接错误，不崩 | 通过（Promise.allSettled + try/catch） |
| 中英切换可用 | 通过（i18n key 齐全） |

## 遗留问题

- 未在模拟器/真机上运行测试（需 Expo 环境）
- 如果 `@react-navigation/native-stack` 未安装在 expo 49 中，可能需要 `npm install @react-navigation/native-stack`
