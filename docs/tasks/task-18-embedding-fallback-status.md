# Task 18: Embedding 降级状态在 UI 暴露（P2）

## 背景

[brain-server/src/embedding/service.ts:78-82](D:\AI_code\Omni-context\omni-context-release\brain-server\src\embedding\service.ts) 当本地模型加载失败时：

```ts
} catch (error) {
  console.warn(`[EmbeddingService] 本地模型加载失败，回退到简单哈希 embedding:`, error);
  this.pipeline = null;
}
```

然后所有 embedding 都走 `embedFallback`（service.ts:175-210）——基于字符频率的简单哈希。**这玩意儿连 cosine similarity 的语义含义都没有了，但向量搜索照样返回"看起来像结果"的东西。用户根本不知道自己的"语义搜索"已经退化成了"字符哈希匹配"。**

## 目标

让 EmbeddingService 暴露自己的当前模式（`'local' | 'api' | 'hash-fallback'`），设置面板的"系统自检"区块要显示这个状态，hash-fallback 时给醒目警告。

成功标准：

1. 后端：EmbeddingService 暴露 `getStatus()` 方法返回 `{ mode, model, healthy }`
2. 后端：新增 `GET /api/admin/embedding/status` 端点（或扩展已有的自检接口）
3. 前端：设置面板"系统自检"Tab 显示一行 "Embedding 引擎"，绿色/橙色/红色按状态
4. hash-fallback 时：红色 + 文案"⚠️ 向量模型加载失败，已降级为简单哈希向量。语义搜索已不准确。"
5. local + 模型已加载 → 绿色"本地模型 Xenova/all-MiniLM-L6-v2 已就绪"
6. api 模式 → 绿色"远程 Embedding API (https://...)"

## 涉及文件

- `brain-server/src/embedding/service.ts`
  - 加 `getStatus()` 方法：返回当前模式 / 模型名 / 是否健康
  - 关键判断：mode === 'local' && pipeline === null → `'hash-fallback'`
- `brain-server/src/api/handlers/`（settings 或 admin handler 里）
  - 新增 / 扩展端点返回 embedding status
  - 看现有 `/api/settings/diagnostics`（如果有）能不能拼一起
- `desktop-daemon/src/components/SettingsPanel.tsx`
  - 系统自检 Tab 里加一行 "Embedding 引擎"
  - 用 lucide 图标按状态着色：CheckCircle2 绿 / AlertTriangle 橙 / XCircle 红
  - 加重新加载模型按钮（点了之后调后端 `POST /api/admin/embedding/reload`，如果实现）

## 约束

- **不要改 embedding 算法本身**——只是暴露状态
- 不要在用户没要求时弹 modal 警告——只在自检 Tab 显示就够
- "重新加载模型"按钮**本期可以不做**，进度文档里说留待后续
- 后端检测 healthy 的判断只看 pipeline 对象是否非 null，不做主动 ping
- 不要破坏现有自检 Tab 布局

## 验收标准

1. ✅ 模型正常加载 → 自检 Tab 显示绿色"本地模型已就绪"
2. ✅ 故意把 models/Xenova/ 目录删一个文件 → 重启 brain-server → 自检显示红色降级警告
3. ✅ 切到 api 模式（设置里配 EMBEDDING_API_URL）→ 自检显示远程 API
4. ✅ `cd brain-server && npm run build` 通过
5. ✅ `cd desktop-daemon && npm run build` 通过

## 进度文档

`docs/progress/2026-05-25-task-18-embedding-fallback-status.md`

## 不要做的事

- 不要做 embedding 模型自动下载 / 修复——超出本期范围
- 不要把 embedding 状态做成顶部全局横幅（自检 Tab 显示就够）
- 不要顺便改其他自检项
