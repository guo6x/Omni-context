# 任务 08：接通 OCR —— 让图片也能进知识图谱

> 项目根目录：`omni-context-release/`。

## 背景

`brain-server/src/ocr/pipeline.ts` 里有一个 `OCRPipeline`（基于 tesseract.js），但它是**死代码**：
- 之前 `tesseract.js` 依赖根本没装（现已装好，见下）。
- 没有任何 handler / 工具调用 `OCRPipeline`，截图永远不会被 OCR。

本任务把 OCR 真正接通：让用户上传图片时，自动 OCR 出文字、走和文本文件一样的抽取流程进图谱。

## 已经做好的部分（你不用做）

- `tesseract.js` 依赖已 `npm install --save` 进 `brain-server`。
- 语言包已下载并内置到 `brain-server/models/tessdata/`：
  `eng.traineddata.gz`、`chi_sim.traineddata.gz`（都是有效 gzip）。
- 已验证：`createWorker('eng+chi_sim', 1, { langPath: <models/tessdata 绝对路径>, gzip: true, cacheMethod: 'none' })`
  可离线 OCR，中英文识别正常，置信度 94。
- 打包脚本（task 05）已经会把 `brain-server/models/` 整个带进包，`tessdata` 在 `models/` 下，**无需改打包脚本**。

## 要做的事

### 1. `brain-server/src/ocr/pipeline.ts` —— 改成离线加载

`_extractLocal()` 里的 `createWorker(this.config.languages)` 改为带上离线选项：

- 传入 `langPath`：指向内置的 `brain-server/models/tessdata` 目录的**绝对路径**，
  用 `import.meta.url` 推算（编译产物在 `dist/ocr/pipeline.js`，目标目录是 `../../models/tessdata`，
  和 embedding 服务 `service.ts` 里推算 `../../models` 是同一套路，可参考）。
- 传 `gzip: true`、`cacheMethod: 'none'`，OEM 参数传 `1`。
- 即：`createWorker(this.config.languages, 1, { langPath, gzip: true, cacheMethod: 'none' })`。
- 保留现有「失败 → `_emptyResult`」的兜底。

### 2. `brain-server/src/api/handlers/ingest.ts` —— 让 `/api/ingest/file` 接受图片

当前 ingest 只认 text/* 和 PDF。加上图片支持：

- 接受的 contentType 增加 `image/png`、`image/jpeg`、`image/webp`（以及 `image/*` 兜底）。
- 当上传的是图片：用 `OCRPipeline` 把图片 OCR 成文字，再把文字喂给现有的
  `ctx.extractor.extract(...)` 流程——和文本文件分支完全一样（实体/关系/原则入库、原文进 archival）。
- OCR 输入：ingest handler 已经有 `Buffer.from(base64,'base64')` 得到的 buffer；
  传给 OCR 时确保 tesseract.js 能识别（用 Buffer，或 data URL `data:image/png;base64,...`）。
- OCR 出来的文字为空时，按 422 返回「图片中未识别到文字」，不要静默成功。
- `OCRPipeline` 用完调 `dispose()` 释放 worker。每次请求新建一个实例即可（上传不频繁，
  不必为复用 worker 改 RequestContext）。

## 约束

- 不引入新依赖（tesseract.js 已装）。
- 不改打包脚本（task 05 已覆盖 models/）。
- `langPath` 用 `import.meta.url` 推算，不要用 `process.cwd()`。
- 遵循现有代码风格；OCR 失败要走兜底、不让整个 ingest 崩。

## 验收标准

- `npx tsc --noEmit` 在 `brain-server` 通过。
- 断网情况下，`OCRPipeline` 能用内置语言包离线 OCR（日志不出现联网下载语言包）。
- `POST /api/ingest/file` 传一张带文字的 PNG → 返回 200，且抽出了实体（图片文字进了图谱）。

## 完成后

在 `docs/progress/` 下新建 `2026-05-21-wire-ocr.md`，内容包含：
任务目标、改动文件清单（每文件一句话）、关键实现说明、自测结果（命令+结果）、已知遗留。
