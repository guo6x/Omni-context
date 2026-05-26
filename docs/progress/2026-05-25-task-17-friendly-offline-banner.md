# Task 17: Brain Server 离线横幅文案友好化 — 进度

## 完成时间

2026-05-25

## 完成内容

### 1. i18n key 新增

`desktop-daemon/src/locales/zh.ts` + `en.ts`:
- `status_banner.brain_offline_simple`: 简短用户友好文案
  - zh: "后台服务未启动，部分功能暂时不可用。"
  - en: "Background service is not running — some features are temporarily unavailable."
- `status_banner.show_details`: "详细信息" / "Details"
- `status_banner.hide_details`: "收起" / "Hide"
- 保留原有 `status_banner.brain_offline` 作为展开后的技术细节

### 2. 离线横幅改造

`desktop-daemon/src/app/page.tsx`:
- 新增 `showOfflineDetails` state
- 新增 `ChevronDown` / `ChevronUp` 图标导入
- 横幅默认显示简短文案 + 「详细信息 ▼」按钮 + 「重启」按钮
- 点击「详细信息」展开折叠区域，显示原有技术细节（Node.js PATH / dist 等）
- 展开后按钮文字变为「收起 ▲」
- 横幅保持原有橙红色警告色

### 3. 构建验证

- ✅ `desktop-daemon` — `next build` 编译通过
