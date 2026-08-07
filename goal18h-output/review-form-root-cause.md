# Goal 18H-R · Review Form 运行 Bug 根因报告（Root Cause）

状态：已修复（v2 表单经真实浏览器 E2E 验证）
日期：2026-08-07（Asia/Shanghai）

## 1. 现象

人工检查发现 v1 人审包 `human-review-package/review-form.html` 存在确定性运行 Bug：
打开表单、填写开始信息后，样本无法正常渲染，页面出现未捕获的 JavaScript 异常。

## 2. 根因

v1 表单的 `renderMeta()` 按「扁平 schema」读取字段：

```js
s.query_time
s.authority_level
s.risk_classification.level
s.risk_classification.reversibility
```

而 Goal 18 v2 样本的真实结构是嵌套的 `scenario` 对象（machine schema）：

```js
s.scenario.query_time
s.scenario.authority_level
s.scenario.risk_classification.level
s.scenario.risk_classification.reversibility
```

因此 `s.risk_classification` 为 `undefined`，读取 `.level` 时抛出 `TypeError`，
渲染中断。旧版 build 脚本从扁平字段构造表单数据，但 45 个 gold-blind 样本文件
保留了嵌套 `scenario` 结构，两处不一致导致确定性故障。

## 3. 为什么 static/syntax tests 没发现

- `node --check` 只能验证 JS 语法，无法验证运行时字段读取路径；
- 旧测试只做了静态 HTML 扫描与样本文件泄漏检查，没有真实浏览器渲染；
- 该 Bug 属于「schema 形状与读取路径不一致」，只有 DOM 级执行才会暴露。

## 4. 修复（v2）

1. `renderScenario()` 改为读取 `s.scenario.query_time` /
   `s.scenario.authority_level` / `s.scenario.risk_classification.level|reversibility`；
2. 全部 45 个样本统一使用 machine schema（嵌套 scenario），不再做扁平化；
3. 新增真实浏览器 E2E（见 `browser-e2e-report.md`），断言 `#sMeta` 渲染
   「查询时间 / 权限 / 风险」三项，Edge 与 Chrome 均 34/34 通过；
4. v2 表单内嵌 JS 通过 `node --check`，页面无未捕获异常（E2E 收集 `pageerror` 为 0）。

## 5. 影响范围

- 仅影响人审工具（presentation 层）；validation fixture/gold 未因此改动；
- v1 包保留为失败版本（`human-review-package/DEPRECATED.md`），不再供人填写。
