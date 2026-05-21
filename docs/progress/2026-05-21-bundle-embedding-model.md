# 2026-05-21 - Bundle Embedding Model

## 任务目标

将 embedding 模型文件内置进项目，运行时从本地磁盘加载，彻底去掉 huggingface.co 联网下载依赖，解决中国网络环境下向量检索失效的问题。

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `brain-server/src/embedding/service.ts` | 导入 `join`/`dirname`/`fileURLToPath`；`_initialize()` 中配置 `env.allowRemoteModels=false` + `env.localModelPath` 指向内置 models |
| `scripts/package-all.js` | 步骤 1（`dist/brain-server/`）和步骤 2（`src-tauri/brain-server/`）两处 `copyDir` 均加入 `models/` |
| `.gitignore` | 无需改动——`brain-server/models/` 未被任何规则排除 |

## 关键实现说明

- `env.localModelPath` 用 `import.meta.url` 推算绝对路径：`join(dirname(fileURLToPath(...)), '../../models')`，在 dev（`src/embedding/service.ts`）和 build 产物（`dist/embedding/service.js`）下路径一致
- `@xenova/transformers` 的类型声明不完整，`env` 通过 `(transformers as any).env` 访问
- 保留原有「加载失败 → 回退哈希」逻辑作为兜底

## 自测结果

```
brain-server: npx tsc --noEmit → 通过
```

## 已知遗留

无。
