# 全品类 DeepSeek 事实校验 — 设计文档

**日期**: 2026-06-03
**状态**: 已确认

## 背景

`src/rewrite.ts` 的改写管线中，事实提取与校验仅对 `体育` 品类生效。其余 15 个品类使用 `emptyFactSet()`，DeepSeek 改写后完全没有事实一致性检查，存在数据被篡改或虚构的风险。

## 目标

将所有 16 个品类的事实校验统一为 DeepSeek 提取 + 程序校验方案，确保改写后关键事实零差异。

## 管线流程

```
抓取原文
  ↓
DeepSeek 提取事实 (结构化 JSON)
  ↓ 失败 → 重试一次 → 仍失败 → 终止不发布
DeepSeek 改写 (prompt 附带事实清单)
  ↓ 失败 → 重试一次 → 仍失败 → 终止不发布
程序校验 (对比改写前后事实)
  ↓ 有差异
DeepSeek 二次修正
  ↓ 仍有差异 → 终止不发布，输出差异报告
发布
```

**关键原则**: 原文禁止直接发布（涉嫌抄袭），改写/校验任一环节底线不达标即终止。

## 事实提取 Schema

DeepSeek 将原文事实输出为以下 JSON：

```json
{
  "title": "原标题",
  "facts": {
    "numbers":    [{ "value": "12.3%", "context": "同比增长率" }],
    "dates":      [{ "value": "2026年6月2日", "context": "事件发生日" }],
    "persons":    [{ "value": "黄仁勋", "context": "NVIDIA CEO" }],
    "locations":  [{ "value": "云南大理", "context": "执法冲突地" }],
    "orgs":       [{ "value": "英伟达", "context": "芯片公司" }],
    "events":     [{ "value": "发生肢体冲突", "context": "执法队与商户冲突" }]
  }
}
```

每个 fact 包含：
- `value`: 事实的原始文本值（用于字符串精确匹配）
- `context`: 语义语境（用于人工审查差异报告时有意义）

## 校验逻辑

对改写后文本执行：

1. **Missing** — fact.value 在改写文本中完全不存在 → 缺失
2. **Altered** — 数字部分相同但文本不同（如 "12.3%" → "12.30%"）→ 篡改嫌疑
3. **Extra** — 改写文本中出现了原文没有的关键数字/实体 → 幻觉

三类差异必须全部为空，校验才算通过。

## Prompt 设计策略

### 提取 prompt
> "从以下文章中提取所有关键事实...输出为 JSON，不添加原文没有的内容"

### 改写 prompt（改造现有）
> "请润色以下文章。以下是原文的关键事实清单，你**严禁修改、删除或添加**任何事实：[facts_json]。可以调整句式、去掉冗余..." 

在源头上将事实清单注入改写 prompt，减少事后修正。

## 错误处理矩阵

| 环节 | 失败策略 |
|------|----------|
| 事实提取 | 重试一次 → 仍失败 → 终止不发布，输出错误信息 |
| 改写 | 重试一次 → 仍失败 → 终止不发布，输出错误信息 |
| 校验 failing | DeepSeek 二次修正 → 仍不通过 → 终止不发布，输出差异报告 |
| JSON 解析失败 | 重试一次提取 → 仍非法 JSON → 终止 |

**没有降级到原文发布的路径。**

## 改动范围

- `src/rewrite.ts`: 
  - 新增 `extractFactsViaDeepSeek()` — 通用事实提取
  - 新增 `validateFactsUniversal()` — 通用校验（复用现有 missing/altered/extra 逻辑）
  - 修改 `rewritePipeline()` — 移除 `category === "体育"` 硬编码，所有品类统一走新管线
  - 修改改写 prompt — 注入事实清单
- 不影响文件: `src/cli.ts`, `src/editor.ts`, `src/publish.ts` 等

## 测试策略

- 单元测试: `extractFactsViaDeepSeek` 返回的 JSON 结构校验
- 集成测试: 拿一篇已知事实的文章走完整管线，验证 missing/altered/extra 检测
- 边界测试: 原文无事实可提取（纯观点/情感文）→ 应返回空 fact set，校验自动通过
