# 批量热点改写发布流水线

> 状态: 待审核 | 日期: 2026-06-04

## 一、目标

将工具从"手动喂 URL → 单篇发布"升级为"自动拉热榜 → 批量改写 → 人工审核 → 定时发布"的全自动化流水线。

## 二、整体架构

```
每天一次: --batch-generate          随时可以: --batch-publish
  │                                      │
  拉热榜 → 筛选 → 抓取 → 改写 → 存文件     读取 pending/ → 逐篇发布 → 归档
  │                                      │
  全自动，不连接 Chrome                   需要 Chrome + 已登录
```

两条命令之间插入人工审核环节：用户在 `articles/pending/` 中编辑或删除 JSON 文件，确认无误后手动执行 `--batch-publish`。

## 三、目录结构

```
项目根目录/
└─ articles/
    ├─ pending/        ← --batch-generate 产物放这里
    └─ published/      ← --batch-publish 成功后移到这里
```

`articles/` 目录加入 `.gitignore`（不上传已生成的文章）。

## 四、文章存储格式

文件名: `YYYY-MM-DD-NNN-分类-标题缩略.json`

```json
{
  "title": "某地这事闹了3天，最终方案让人意外",
  "content": "<h2>🔍 事件始末</h2><p>据多方消息...</p>",
  "category": "社会",
  "topics": ["社会热点", "民生", "基层治理"],
  "source_url": "https://example.com/article/123",
  "narrative_angle": "impact",
  "fact_count": 8,
  "generated_at": "2026-06-04T08:00:00+08:00"
}
```

字段说明：

| 字段 | 类型 | 来源 |
|------|------|------|
| `title` | string | DeepSeek 按叙事角度生成 |
| `content` | string (HTML) | DeepSeek 改写输出 |
| `category` | string | `detectCategory()` 自动检测 |
| `topics` | string[] | DeepSeek 生成 8-10 个候选 |
| `source_url` | string | 热榜原文 URL |
| `narrative_angle` | string | 改写时选的角度: `event`/`why`/`impact`/`debate` |
| `fact_count` | number | 事实校验通过条数 |
| `generated_at` | string (ISO 8601) | 生成时间戳 |

用户审核操作 = 文件操作：
- **删除文件** → 不发这篇
- **编辑 title/content** → 改标题、加内容
- **不动** → 审核通过

## 五、CLI 命令设计

### 5.1 `--batch-generate`

```bash
npx tsx src/cli.ts --batch-generate --count 5 --category 社会
```

新增参数：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--batch-generate` | - | 启用批量生成模式 |
| `--count <n>` | `5` | 最多生成篇数 |
| `--category <name>` | 无（不限） | 限定热榜分类 |
| `--no-llm` | `false` | 跳过 DeepSeek，仅抓取原文不改写 |

不连接 Chrome——只调 DeepSeek API 和糖果梦 API + 网页抓取。

### 5.2 `--batch-publish`

```bash
npx tsx src/cli.ts --batch-publish
```

新增参数：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--batch-publish` | - | 启用批量发布模式 |
| `--publish-interval <min>` | `30` | 篇间间隔（分钟） |

## 六、生成流水线 (`--batch-generate`)

### 步骤 1：拉取热榜

复用 `src/trend.ts` 的 `fetchToutiaoItems()`（RSS）和 `searchHotItems()`（糖果梦 API）。

- 拉 30-50 条热榜条目
- 按 rank 排序
- 提取 normalized URL 用于去重

### 步骤 2：去重

- 扫描 `articles/published/` 下所有 JSON
- 提取 `source_url` 并 normalize
- 排除已发布过的 URL
- 同时排除 `commented.json` 中已互动过的 URL（避免重复碰）

### 步骤 3：逐条生成（取前 N 条）

每条执行：

1. 用 Playwright 打开原文 URL → 跑 `scrapeArticle(page, url)` 抓取标题+正文
2. 正文 > 3000 字 → 截断（保持已有策略）
3. **随机选叙事角度**：从 `["event", "why", "impact", "debate"]` 随机取一个
4. 跑 `extractFactsViaDeepSeek(content, title)` 提取事实
5. 跑改写（见第七节升级后的 prompt）
6. 跑 `validateFacts(rewritten, originalFacts)` → 不通过则 `fixDiscrepancies()` → 仍不通过则丢弃
7. 跑 `generateTopicsViaDeepSeek()` 生成话题候选
8. 跑 `detectCategory()` 确定分类
9. 写入 `articles/pending/<文件名>.json`

**中间如果任何一步抛异常（除事实校验），记录错误日志后 continue 下一条。**

### 步骤 4：输出清单

```
=== 批量生成完成 (5/8 篇) ===
🔴 3 篇丢弃（事实校验未通过）
🟢 5 篇待审核（articles/pending/）:
  1. 2026-06-04-001-社会-某地这事闹了3天.json (8条事实, impact角度)
  2. 2026-06-04-002-财经-这笔钱每月都在扣.json (6条事实, why角度)
  ...
请审核后执行: npx tsx src/cli.ts --batch-publish
```

## 七、改写 Prompt 升级

### 七.1 叙事角度定义

| 角度 | key | 说明 |
|------|-----|------|
| 事件梳理型 | `event` | 从始至终发生了什么，时间线清晰 |
| 追问解读型 | `why` | 为什么会发生，背后原因和逻辑 |
| 影响分析型 | `impact` | 对普通人意味着什么，切身影响 |
| 争议展示型 | `debate` | 支持和反对的观点各是什么 |

### 七.2 升级后的 System Prompt

```
你是新闻编辑。请按以下叙事角度重写这篇文章。

【角度：{angle_label}】
{angle_instruction}

【规则】
1. 全文 600-900 字，简洁有力
2. 输出 HTML 格式：<h2> 做小标题（搭配 emoji），<p> 做段落，<ol>/<ul> 做列表
3. <strong> 加粗关键数据、核心结论
4. 严禁修改任何数字、百分比、人名、地名、机构名、专有名词
5. 严禁虚构数据、增删事实
6. 不要用"这篇文章""作者认为"等套话

【关键事实清单 — 严禁修改】
{facts_block}
```

### 七.3 标题生成策略

升级后的改写 prompt 同时要求 DeepSeek 生成 3 个备选标题，程序选第一个。标题要求：

- 12-25 字
- 包含数字或具体细节
- 引发好奇心但不能是纯粹标题党
- 符合头条推荐算法的点击偏好

## 八、发布流水线 (`--batch-publish`)

### 步骤

1. 扫描 `articles/pending/`，按文件名排序（即按生成时间）
2. 数量为 0 → 提示 "无待发布文章" 退出
3. 连接 Chrome（`createSession()`），确保登录
4. 逐篇发布：
   - 读取 JSON → 提取 title/content/category/topics
   - 打开发布页面
   - `typeTitle()` → `insertContent()` → 检测建议配图 → `insertTopics()`
   - 选封面（单图/无封面） → `setDeclarations()`
   - 如果没有 topics 可用 → 跳过话题步骤
   - 发布 → 等待验证
   - 成功 → 文件移动到 `articles/published/`
   - 失败 → 文件保留在 `pending/`，打印错误信息，continue 下一篇
5. 关闭 Chrome page

### 篇间间隔

每篇发布完成后 `await setTimeout(interval * 60 * 1000)`。

- 默认 30 分钟
- 可配置 `--publish-interval`
- 发布最后一篇后不需要等待

### 输出

```
=== 批量发布完成 ===
✅ 3 篇成功（已移至 articles/published/）
❌ 1 篇失败（保留在 articles/pending/）：
  - 2026-06-04-003-社会-xxx.json: 确认发布按钮未找到
```

## 九、浏览器会话管理

### --batch-generate 的浏览器

不需要连接用户 Chrome。内部使用 Playwright 的 `chromium.launch({ headless: true })` 启动一个独立的无头浏览器实例，专门用于抓取原文。生成完成后立即关闭该浏览器，不保留任何 profile 数据。

```
batch-generate 启动 → chromium.launch(headless) → scrapeArticle() × N → browser.close()
```

这跟用户 Chrome 的 CDP 连接是完全独立的两个东西。

### --batch-publish 的浏览器

需要连接用户已登录的 Chrome（`createSession()`）。发布完关闭 page 但保持 Chrome 运行。**如果 --batch-publish 时 CDP 不通，报错提示用户手动启动 Chrome。**

## 十、错误处理

| 场景 | 行为 |
|------|------|
| 原文抓取失败（超时/404） | 跳过这篇文章，继续下一篇 |
| DeepSeek API 限流/超时 | 重试 2 次，仍失败则跳过 |
| 事实校验一次不通过 | 发 fix prompt 修正 |
| 事实校验二次不通过 | 丢弃，不存文件 |
| 发布时元素找不到 | 文件保留在 pending/，不阻塞后续 |
| CDP 不通 | 报错退出（不自动启动 Chrome） |
| `articles/pending/` 为空 | 提示无待发布文章，退出 |

所有非致命错误打印到控制台，不中断整体流程。

## 十一、测试

新增测试文件 `tests/batch-generate.test.ts`：

- 热榜拉取 + 去重逻辑（mock API 返回）
- JSON 文件读写正确性
- 文件名生成格式
- validate 不过 → 丢弃的逻辑
- 叙事角度随机选择覆盖全部 4 种

新增测试文件 `tests/batch-publish.test.ts`：

- pending 目录扫描和排序
- 成功后文件归档
- 失败后文件保留
- 空目录行为

`tests/rewrite.test.ts` 补充：

- 升级后 rewrite prompt 包含角度参数
- 标题生成为 3 选 1 格式

## 十二、实现顺序

| 阶段 | 内容 | 文件 |
|------|------|------|
| 1 | 目录结构 + JSON 读写工具 | `src/article-store.ts` |
| 2 | 改写 Prompt 升级（角度驱动） | `src/rewrite.ts` |
| 3 | 生成流水线 | `src/batch-generate.ts` |
| 4 | 发布流水线 | `src/batch-publish.ts` |
| 5 | CLI 集成（两条新命令） | `src/cli.ts` |
| 6 | 测试 | `tests/batch-generate.test.ts`, `tests/batch-publish.test.ts` |
| 7 | `.gitignore` 更新 | `.gitignore` |

每个阶段独立提交。

## 十三、不变的部分

- Chrome CDP 连接逻辑（`browser.ts`）
- 编辑器交互（`editor.ts`）
- 现有的 `--from-url` 单篇流程完全不改
- 登录检测（`login.ts`）
- 图片相关（`jimeng.ts`, `images.ts`, `suggestions.ts`）
- 互动模式（`interact.ts`）
- config.ts 配置项
