# Task 18: Embedding 降级状态在 UI 暴露 — 进度

## 完成时间

2026-05-25

## 完成内容

### 1. 后端：EmbeddingService 暴露状态（已有，仅补充）

`brain-server/src/embedding/service.ts`:
- `getStatus()` 方法（已有）：返回 `'local' | 'api' | 'hash-fallback' | 'pending'`
- `getInfo()` 方法（**扩展**）：新增 `apiUrl` 字段，从 `config` 中透出 API URL

### 2. 后端：`GET /api/admin/embedding/status` 端点（新增）

`brain-server/src/api/handlers/admin.ts`:
- 新增端点 `GET /api/admin/embedding/status`
- 返回：`{ mode, status, model, healthy, apiUrl }`
- `healthy` 判断：`status !== 'hash-fallback'`，不做主动 ping

### 3. 后端：`/api/status` 扩展（已有，补充字段）

`brain-server/src/api/handlers/settings.ts`:
- `/api/status` 响应中 embedding 对象新增 `mode` 和 `apiUrl` 字段

### 4. 前端：系统自检 Tab Embedding 行（更新）

`desktop-daemon/src/components/SettingsPanel.tsx`:
- 标题改为 **"Embedding 引擎"**
- **local 模式**（绿色）：显示 "本地模型 Xenova/all-MiniLM-L6-v2 已就绪"
- **api 模式**（绿色）：显示 "远程 Embedding API (https://...)"
- **hash-fallback**（红色）：显示 XCircle 图标 + "哈希降级"，警告文案：
  > ⚠️ 向量模型加载失败，已降级为简单哈希向量。语义搜索已不准确。
- **pending**（琥珀色）：显示 "初始化中"

### 5. 构建验证

- ✅ `brain-server` — `tsc` 编译通过
- ✅ `desktop-daemon` — `next build` 编译通过

## 未完成

- "重新加载模型按钮"留待后续（按任务文档明确说明）
