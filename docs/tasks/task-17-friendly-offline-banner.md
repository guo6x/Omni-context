# Task 17: Brain Server 离线横幅文案友好化（P3）

## 背景

[desktop-daemon/src/app/page.tsx:605-618](D:\AI_code\Omni-context\omni-context-release\desktop-daemon\src\app\page.tsx) 当 Brain Server 离线时显示：

```
Brain Server 离线 —— 文件上传 / 知识图谱 / 通知等功能不可用。
可能原因：Node.js 不在 PATH，或 brain-server/dist 未构建。
```

普通用户根本不知道什么是 PATH、dist。这文案是给开发者看的，不是给用户看的。

## 目标

把横幅文案改成两层：默认显示给用户看的简短文案，可展开"详细信息"给开发者看的诊断信息。

成功标准：

1. 默认显示：「后台服务未启动，部分功能暂时不可用。」+ 「重启」按钮
2. 旁边有一个小按钮「详细信息 ▼」，点开折叠显示原来那段技术细节（可能原因 + 当前 brain-server PID / 端口状态）
3. 文案走 i18n（结合 task-16，但本任务也要先给 zh / en key）
4. 横幅样式保持现在的橙红色警告色

## 涉及文件

- `desktop-daemon/src/app/page.tsx`
  - L605-L618 横幅部分改造
  - 加 state `showOfflineDetails: boolean`
  - 用 lucide `ChevronDown` / `ChevronUp` 切换图标
- `desktop-daemon/src/locales/zh.ts` + `en.ts`
  - 加 `offline.banner_simple`、`offline.banner_details`、`offline.show_details`、`offline.hide_details`

## 约束

- 不要把横幅做成 modal
- 不要在用户每次启动时弹什么"教程"
- 「重启」按钮逻辑不动（已经在调 `restart_brain_server`）
- 详细信息折叠默认关闭（保持简洁）

## 验收标准

1. ✅ 故意关掉 brain-server → 横幅显示简短文案 + 重启按钮
2. ✅ 点「详细信息 ▼」→ 展开看到技术原因
3. ✅ 切英文 → 全英文
4. ✅ `npm run build` 通过

## 进度文档

`docs/progress/2026-05-25-task-17-friendly-offline-banner.md`

## 不要做的事

- 不要做"自动尝试修复"按钮——保留手动重启就够
- 不要顺便改其他错误提示文案（那是 task-16 的事）
