# Task 16: 全量国际化扫描（P2）

> ⚠️ **本任务建议放到最后做**——其他 task 会继续添加新 UI 字符串，先做 i18n sweep 会被后续 task 引入新硬编码字符串"污染"。等所有功能 task 完成后再做这一遍。

## 背景

项目有完整的 i18n 基础设施（`desktop-daemon/src/hooks/useTranslation.tsx` + `locales/zh.ts` + `locales/en.ts`），但**大量 UI 文本没走 `t()` 函数**。

报告里列的不完全样本：

| 文件 | 行号示例 | 内容 |
|------|--------|------|
| page.tsx | 609, 615, 670 | `Brain Server 离线 —— ...`、`重启`、`上传文件` |
| SearchPalette.tsx | 214, 221, 311-314, 331-443 | `扫描记忆库中...`、`搜索出错`、`上下键 ↑↓ 选择`、`长期记忆`、`核心上下文`、`返回列表` |
| SettingsPanel.tsx | 936 | `⚠️ 连接提示：LLM 未连接，只有正则抽取...` |
| GraphViewer.tsx | 1242 | `· 近期未访问` |
| 其他组件 | —— | 自查 |

英文用户切到 en 后会看到大段中文夹杂英文，体验很差。

## 目标

把 `desktop-daemon/src/` 下所有 `.tsx` 文件里的中文字面量迁移到 i18n。

成功标准：

1. JSX 内的中文文本（`<div>中文</div>`、`<button>中文</button>`、`placeholder="中文"`、`title="中文"`、`aria-label="中文"` 等）全部走 `t('...')`
2. JS / TS 代码中 toast.success / toast.error 这类用户可见的字符串也走 `t()`
3. **保留**：注释、console.log（开发者看的）、代码里的常量名、Tauri command 名等不动
4. 切到 English 时，整个 UI 没有中文残留（除了用户数据本身）

## 涉及文件

- 扫一遍 `desktop-daemon/src/**/*.{tsx,ts}`，识别中文字面量
- 把所有命中处替换为 `t('namespace.key')` 调用
- 新 key 加进 `desktop-daemon/src/locales/zh.ts` 和 `en.ts`
- key 命名按模块分 namespace：`header.*` / `search.*` / `settings.*` / `hud.*` / `toast.*` 等

## 约束

- **不要重写组件逻辑**——只换字符串
- **不要遗漏** placeholder / title / aria-label / alt 这种 attribute 里的中文
- 一些动态字符串（`\`已添加 ${n} 个\``）要拆成 i18n 的 interpolation 形式：`t('toast.added_count', { n })`
- 英文翻译要**精确**，不要直译机翻；不确定的去 lucide 官方组件 / GitHub / Linear 等参考表述
- **保留** Emoji（如 ⚠️、✓）原样
- 不要改现有 i18n 的 key 命名规范——按已有的看，跟进
- key 不能跟现有冲突——先 grep 看是否已存在

## 验收标准

1. ✅ `npm run build` 通过
2. ✅ 切英文：主窗口 header、上传按钮、搜索浮层、设置面板、HUD 文案、toast 通知**全英文**
3. ✅ 切中文：所有界面全中文，没有英文残留（除了 LLM model 名等数据）
4. ✅ Brain Server 离线横幅切英文时**完整翻译**
5. ✅ 验证至少 10 处之前硬编码的中文，确认都走了 t() （进度文档里列改了哪些）
6. ✅ grep `'[一-龥]'` 在 src/ 下应该几乎只命中 locale 文件和 *.test.* 文件

## 进度文档

`docs/progress/2026-05-25-task-16-i18n-sweep.md`

包含：
- 改动文件数 / 新增 key 数 / namespace 划分理由
- 抽查 5-10 个组件的"中英切换"截图或日志
- 残留情况（如果有动态字符串处理不了的）

## 不要做的事

- 不要顺手改 i18n 基础设施（useTranslation hook）
- 不要新增第三方 i18n 库（如 react-i18next）—— 现有的够用
- 不要把 commit message / git tag / 代码注释也翻译
- 不要在 task-09 ~ task-15 还没完成时跑这个任务（会和它们的新字符串冲突）
