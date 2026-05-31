# 互动功能 Implementation Plan

**Goal:** 自动在头条文章页面执行关注作者、点赞、评论三个操作

**Architecture:** 新增 `src/interact.ts` 模块，命令行 `interact --count 5`

---
### Task 1: 互动模块 (src/interact.ts)

- 新增 `src/interact.ts`，导出 `interactArticles(count)`
- 流程：浏览头条首页 → 随机点击文章 → 读标题+摘要 → 生成评论 → 关注 → 点赞 → 评论
- UI 选择器：关注=`.user-subscribe-wrapper`, 评论=`.ttp-comment-input`→`.comment-textarea`, 提交=`.submit-btn`
- 新增 CLI 命令：`cli.ts interact --count 5`

### Task 2: 评论生成 (src/comment.ts)

- 新增 `src/comment.ts`，导出 `generateComment(title, content)`  
- 基于文章标题/内容生成 15-30 字自然评论
- 不依赖外部 API，纯模板+随机

### Task 3: 本地测试

- 编译通过 + 单篇文章互动测试
- Commit + Push
