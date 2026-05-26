# Task 03: 上传入口常驻可见

## 背景

用户反馈："没有点击上传的按钮，没看到。"

排查发现：上传按钮（`onUploadClick={() => setShowUpload(true)}`）当前**只挂在 `<EmptyState />` 里**（见 `desktop-daemon/src/app/page.tsx:477`）。`EmptyState` 只在图谱为空 + 没被用户 dismiss 时才渲染：

- 一旦用户已经上传过任何内容 → 图谱有数据 → EmptyState 消失 → 上传按钮没了
- 一旦用户点过 EmptyState 上的"我知道了"（`setEmptyDismissed(true)`）→ EmptyState 消失 → 上传按钮没了

结果就是用户找不到上传入口，只能开着空图谱才能看到。

## 目标

在主窗口加一个**常驻的"上传"入口**，不管图谱是不是空都能看到。

成功标准：

1. 主窗口顶部（header 区）或侧边一直有一个明显的「上传」按钮（图标 + 文字 "上传文件" / "Upload"）
2. 点击 → 打开现有的上传弹窗（`setShowUpload(true)`）
3. 即使图谱已经有数据、EmptyState 被 dismiss，按钮依然可见
4. 按钮要醒目（cyan 强调色 + 适当大小），不要被埋在角落里
5. EmptyState 里那个"上传"按钮可以保留作为新手引导，不冲突

## 涉及文件

- `desktop-daemon/src/app/page.tsx`
  - 在 header 区（约 360 行附近的工具栏 / 状态指示器旁）加一个 `<button onClick={() => setShowUpload(true)}>` 
  - 用 lucide 的 `Upload` icon（已 import）
  - 风格跟 header 里其他按钮（设置、HUD 切换、最小化等）保持一致
- `desktop-daemon/src/locales/zh.ts` + `en.ts`
  - 加 i18n key：`header.upload` = "上传文件" / "Upload"

## 约束

- **不要重新设计 header 布局**。在现有结构里加一个按钮。
- **不要改 `<EmptyState />`**，那个组件的上传按钮保留。
- 按钮位置要符合 Fitts's Law：放在 header 显眼处，不要塞到设置面板里。
- 不要新增第三方 UI 库。

## 验收标准

1. ✅ 打开主窗口 → 不管图谱有没有数据，header 区都能看到「上传」按钮
2. ✅ 点击「上传」按钮 → 上传弹窗弹出
3. ✅ 上传一个文件 → 图谱有数据后，按钮**依然可见**
4. ✅ 关掉 EmptyState 后按钮依然可见
5. ✅ 按钮的样式跟 header 其他按钮协调（同样大小、间距、hover 效果）
6. ✅ 中英文 i18n 都对
7. ✅ `cd desktop-daemon && npm run build` 无 type 错误

## 构建与运行

```powershell
cd D:\AI_code\Omni-context\omni-context-release\desktop-daemon
npm run tauri:dev
```

## 进度文档

完成后写到 `docs/progress/2026-05-25-task-03-persistent-upload-entry.md`，包含：

1. **任务目标**
2. **改动文件清单**
3. **关键取舍**（特别是：按钮放在 header 哪个位置、为什么选这里）
4. **自测结果**
5. **遗留问题**（如果有）

## 不要做的事

- 不要做"拖拽进窗口自动弹上传"——那是 task-01 的范围
- 不要加额外的浮动按钮 / FAB / 圆形操作按钮，跟现有风格不合
- 不要把按钮做成下拉菜单（"上传文件" / "上传文件夹" 两选项），单点直接弹现有弹窗就行
