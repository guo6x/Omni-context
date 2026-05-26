# Task 03 进度文档: 上传入口常驻可见

## 1. 任务目标
解决用户在数据图谱有数据或关闭 EmptyState 后找不到文件上传入口的问题。本次任务的目的是在应用的主窗口 header 区新增一个常驻的“上传文件”按钮，使用户在任意图谱状态下都可以随时发起文件上传。

## 2. 改动文件清单
- **[page.tsx](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/app/page.tsx)**: 在顶部 header 右侧的操作按钮组（Actions Button Group）的开头，添加常驻的上传按钮。点击按钮触发现有的上传弹窗，且按钮配置为在小分辨率屏幕下自动隐藏文字、仅保留图标。
- **[zh.ts](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/locales/zh.ts)**: 新增中文国际化翻译词条 `header.upload = '上传文件'`。
- **[en.ts](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/locales/en.ts)**: 新增英文国际化翻译词条 `header.upload = 'Upload File'`。

## 3. 关键取舍
* **按钮位置的选择**：
  我们最终将上传按钮放置在 header 右侧按钮组（即 HUD 切换、最小化、Insights 通知、设置、视图切换）的最左侧。
  * *原因*：
    1. **全局可见性**：右侧的这一组操作按钮在所有屏幕尺寸（包括小尺寸）下都不会被整体隐藏，这保证了“上传”按钮在任意分辨率下都常驻可见（利用 Tailwind 样式 `hidden sm:inline` 实现在宽屏下显示文字“上传文件”，而在小屏下仅保留上传图标以节省空间）。而 header 中部的状态指示器（如 Brain Server、UDP 监听）在小于 `xl` 分辨率时会被隐藏，不适合作为常驻按钮的锚点。
    2. **交互流协调**：放置在此处非常自然，不会与右侧极度紧凑的“图谱/控制台”视图切换按钮或最小化按钮产生干扰，视觉上作为独立的功能按钮十分醒目。
* **样式设计**：
  * 使用了青色强调色（`text-cyan-400`、`text-cyan-400` 图标），搭配了微弱的青色边框 `border border-cyan-800/40`。
  * 相比于普通灰色按钮更加醒目，吸引用户注意但又不至于像全局悬浮按钮（FAB）那样突兀而破坏现有的 **Cyberpunk Glassmorphism** 设计风格。

## 4. 自测结果
1. **类型校验与生产构建**：已运行 `npm run build` 进行编译验证，本地 TypeScript 类型校验无任何报错且成功生成 Next.js 静态输出。
2. **i18n 确认**：中英文 i18n 词条匹配正常。
3. **开发环境启动**：已在后台拉起 `tauri:dev` 以确保启动流程和 Rust 侧编译链路通畅。

## 5. 遗留问题
无。
