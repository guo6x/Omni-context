# 任务 05：内置 embedding 模型，去掉运行时下载依赖

> 项目根目录：`omni-context-release/`。

## 背景

embedding 服务（`brain-server/src/embedding/service.ts`）本地模式用 `@xenova/transformers`，
首次使用时从 `huggingface.co` 下载模型。该站点在中国网络下经常不可达 → 模型加载失败 →
回退成「哈希假向量」→ **向量检索失效**（语义召回变成噪音）。

修法：把模型文件**内置进项目**，运行时从本地磁盘加载、彻底不联网。

**模型文件已经下载好并放到位了**，无需你下载。路径：
```
brain-server/models/Xenova/all-MiniLM-L6-v2/
  config.json
  tokenizer.json
  tokenizer_config.json
  special_tokens_map.json
  vocab.txt
  onnx/model_quantized.onnx   (~23MB)
```
已验证：设 `env.allowRemoteModels=false` + `env.localModelPath` 指向 `brain-server/models`
后，可离线加载、产出正常的 384 维向量。

## 要做的事

### 1. `brain-server/src/embedding/service.ts`

在 `_initialize()` 里、调用 `pipeline(...)` 之前，配置 transformers.js 走本地模型：

- 从 `@xenova/transformers` 额外导入 `env`。
- 设 `env.allowRemoteModels = false`（禁止任何网络请求）。
- 设 `env.localModelPath` 为 `brain-server/models` 的**绝对路径**，用 `import.meta.url` 推算，
  不要用 `process.cwd()`（cwd 在打包后不可靠）。
  编译产物是 `dist/embedding/service.js`，模型目录是 `dist` 的同级 `models/`，
  所以路径是「当前文件目录」的 `../../models`。dev 模式（tsx 跑 `src/embedding/service.ts`）
  同样是 `../../models`，一致。
- 保留现有的「加载失败 → 回退哈希」逻辑作为兜底，不要删。

### 2. `scripts/package-all.js`

打包时要把 `brain-server/models/` 一起带上。脚本里 brain-server 在两处组装，两处都要加：

- 步骤 1：`dist/brain-server/`（`copyDir(brain-server/dist → dist/brain-server)` 之后，
  再 `copyDir(brain-server/models → dist/brain-server/models)`）。
- 步骤 2：`desktop-daemon/src-tauri/brain-server/`（`copyDir(brain-server/dist → .../dist)`
  之后，再 `copyDir(brain-server/models → src-tauri/brain-server/models)`）。

两处都保证 `models/` 与 `dist/` 同级——这样上面 `../../models` 的路径推算在打包后依然成立。

### 3. .gitignore

确认 `.gitignore` 没有把 `brain-server/models/` 排除掉（这套模型文件需要随仓库提交）。
如果有相关规则，加一条例外让 `models/` 能被提交。

## 约束

- 不引入新依赖。
- 不改 embedding 的 API 模式分支、不动哈希回退逻辑（只是确保它仍是兜底）。
- 遵循现有代码风格。

## 验收标准

- `npx tsc --noEmit` 在 `brain-server` 通过。
- 断网（或保持 `allowRemoteModels=false`）情况下，EmbeddingService 能加载本地模型并产出
  384 维向量，日志不再出现「回退到简单哈希 embedding」。
- `scripts/package-all.js` 两处组装都包含 `models/` 目录。

## 完成后

在 `docs/progress/` 下新建 `2026-05-21-bundle-embedding-model.md`，内容包含：
任务目标、改动文件清单（每文件一句话）、关键实现说明、自测结果（命令+结果）、已知遗留。
