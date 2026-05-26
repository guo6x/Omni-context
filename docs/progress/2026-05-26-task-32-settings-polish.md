# Task 32: 设置面板细节打磨（快捷键冲突检测 + Embedding 重载按钮）

## A. 快捷键冲突检测

### 实现

- **已知系统快捷键**：新建 `desktop-daemon/src/lib/known-system-shortcuts.ts`
  - 覆盖 25 个 Windows/Linux 通用快捷键 + 5 个 macOS 专用快捷键
  - macOS 上 Cmd → Ctrl 做等价转换（`normalizeShortcut` 函数）
  - 每个快捷键带中/英文标签，按当前语言显示
- **实时检测**：`SettingsPanel.tsx` 中使用 `useMemo` 计算 `shortcutConflict`
  - 编辑时每按一次键，`tempShortcut` 变化 → useMemo 重新计算
  - 先查 omni 快捷键（排除自身 id），再查系统快捷键
  - 冲突信息用 `graph.conflict_with_omni` / `graph.conflict_with_system` 渲染
- **UI 提示**：编辑按键下方显示橙色警告条（amber-950/30 背景 + AlertTriangle 图标）
- **二次确认**：保存冲突快捷键时 `window.confirm` 对话框，用户可选择放弃或强制保存

### 验收路径

- Ctrl+K → 提示"⚠️ 跟快捷键「打开搜索浮层」冲突"
- Ctrl+C → 提示"⚠️ 跟系统快捷键「复制」冲突"
- 不冲突的组合 → 无警告
- 强行保存冲突 → 二次确认 dialog

## B. Embedding 模型重载按钮

### 后端

- **`brain-server/src/embedding/service.ts`**：新增 `reload()` 方法
  - 清空 `pipeline` / `initialized` / `initPromise`
  - 重新调用 `_initialize()` 加载模型
- **`brain-server/src/api/handlers/admin.ts`**：新增 `POST /api/admin/embedding/reload`
  - 调用 `embeddingService.reload()`，返回新状态
  - 失败时返回 500 但仍带当前 status（不 crash）

### 前端

- **`SettingsPanel.tsx`** 诊断 Tab：Embedding 行
  - 状态为 `hash-fallback` 或 `pending` 时，显示"重新加载模型"按钮（cyans 主题）
  - 点击 → loading 动画（RefreshCw 旋转），15 秒超时
  - 成功后 toast 提示 + 刷新诊断数据
  - 失败后 toast 错误提示，按钮保持可见（可重试）

### 验收路径

- 诊断面板 embedding 降级 → 出现"重新加载模型"按钮
- 点击 → loading → 成功后状态变绿
- 故意删除 model 文件再点 → 仍降级，不 crash

## 涉及文件

| 文件 | 变更 |
|------|------|
| `desktop-daemon/src/lib/known-system-shortcuts.ts` | 新建：已知系统快捷键列表 + 标准化函数 |
| `desktop-daemon/src/components/SettingsPanel.tsx` | 冲突检测 useMemo + UI 警告 + 确认保存 + Embedding 重载按钮 |
| `brain-server/src/embedding/service.ts` | 新增 `reload()` 方法 |
| `brain-server/src/api/handlers/admin.ts` | 新增 `POST /api/admin/embedding/reload` 端点 |
| `desktop-daemon/src/locales/zh.ts` + `en.ts` | 新增 6 个 i18n key |

## 构建状态

- [x] `cd brain-server && npm run build` 通过
- [x] `cd desktop-daemon && npm run build` 通过
