# Task 32: 设置面板细节打磨（快捷键冲突检测 + Embedding 重载按钮）

## 背景

设置面板已经做得挺完整了（LLM 预设、MCP 接入、系统自检、关闭行为、自启动等），还差两个小但影响体验的细节：

1. **快捷键冲突检测缺失**：用户改快捷键时，不检查是否跟现有快捷键 / 系统快捷键冲突。改完 Ctrl+S 才发现跟"保存"冲突。
2. **Embedding 降级了只能重启 brain-server**：[[task-18]] 把降级状态显示出来了，但没法原地恢复——只能"关掉桌面 App → 重新打开"。

## 目标

### A. 快捷键冲突检测

- 用户在快捷键编辑框里录入新组合时（按住 Ctrl+Alt+X 之类）：
  - 实时检测是否跟当前其他 omni 快捷键重复（开同一个 hotkey）
  - 实时检测是否跟常见系统快捷键冲突（白名单已知冲突如 Ctrl+C / Ctrl+V / Alt+F4 / Win+L 等）
  - 冲突时输入框下方显示橙色提示 "⚠️ 跟 '触发沉淀' 冲突" 或 "⚠️ 跟系统快捷键 '复制' 冲突"
  - 仍然允许保存（用户知道在做什么）—— 不强阻止，只警告
- 保存后如果冲突，确认对话框 "确定保存？这会覆盖之前的设置 / 可能跟系统冲突"

### B. Embedding 模型"重新加载"按钮

- "系统自检" Tab 里 Embedding 引擎那一行：
  - 状态是 `hash-fallback` 或 `pending` 时显示一个 "重新加载模型" 按钮
  - 点击 → 调 `POST /api/admin/embedding/reload`
  - brain-server 端：销毁当前 pipeline，重跑 `_initialize()`，返回新状态
  - 桌面端：显示"加载中..."loading 状态，结果出来后刷新自检状态

## 涉及文件

- `desktop-daemon/src/components/SettingsPanel.tsx`
  - 快捷键编辑：当前可能用 `useState` 收集 key 组合 + 一个 input 显示。加 useMemo 计算冲突
  - 系统自检 Tab：embedding 行加重载按钮
- `desktop-daemon/src/hooks/useSettings.ts`
  - 保留所有快捷键的 ref/state，给冲突检测访问
- `desktop-daemon/src/lib/known-system-shortcuts.ts`（新建）
  - 导出 KNOWN_SYSTEM_SHORTCUTS = [{ keys: ['ctrl', 'c'], label: 'Copy' }, ...]
  - 不需要全（覆盖 20-30 个常用的就够），按 OS 分组
- `brain-server/src/api/handlers/admin.ts`
  - 加 `POST /api/admin/embedding/reload` handler
- `brain-server/src/embedding/service.ts`
  - 新增 `reload()` 方法：dispose 当前 pipeline + 重置 initialized + 调 ensureInitialized
- `desktop-daemon/src/locales/zh.ts` + `en.ts`
  - 加 `shortcuts.conflict_with_omni`、`shortcuts.conflict_with_system`、`settings.embedding_reload`、`settings.embedding_reloading`

## 约束

- 冲突检测**只警告不强阻止** —— 用户可能故意覆盖
- 已知系统快捷键列表保持简短（20-30 个），不要试图覆盖所有
- macOS 上 Cmd 跟 Windows 上 Ctrl 等价 —— 检测时按 OS 转换
- Embedding 重载可能耗时几秒（重新加载 model）—— 加 loading 状态 + 超时（15 秒）
- 重载失败不要 crash brain-server，状态仍是 hash-fallback
- 不要做"全局快捷键托管平台" —— 还是 Tauri 默认机制

## 验收标准

1. ✅ 设置面板改快捷键 → 录入 Ctrl+K → 提示 "⚠️ 跟 '打开搜索浮层' 冲突"
2. ✅ 录入 Ctrl+C → 提示 "⚠️ 跟系统快捷键 '复制' 冲突"
3. ✅ 录入一个不冲突的 → 没有警告
4. ✅ 强行保存冲突的 → 二次确认 dialog
5. ✅ 系统自检 → embedding 降级到 hash-fallback → 出现"重新加载模型"按钮
6. ✅ 点重载 → loading 几秒 → 成功后状态变绿
7. ✅ 故意删除一个 model 文件再点重载 → 仍然降级，但不 crash
8. ✅ `cd brain-server && npm run build` 通过
9. ✅ `cd desktop-daemon && npm run build` 通过

## 进度文档

`docs/progress/2026-05-26-task-32-settings-polish.md`

## 不要做的事

- 不要把已知系统快捷键做成可编辑——硬编码就行
- 不要做"快捷键 cheatsheet"打印功能
- 不要在 embedding 重载时把 API URL / model 名也改了 —— reload 就是 reload，配置不变
- 不要做模型下载 / 替换功能 —— 现有 model 装好了就用，没装到极端 fallback 状态
