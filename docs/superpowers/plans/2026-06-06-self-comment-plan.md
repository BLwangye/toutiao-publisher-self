# 种子评论独立命令 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为已发布文章自动生成并提交有吸引力的种子评论，通过 `--self-comment` 独立命令触发。

**Architecture:** 新增 `src/self-comment.ts` 自包含模块，从 `src/interact.ts` 导出 `extractArticleInfo` 和 `typeComment` 供复用，`src/cli.ts` 新增 `--self-comment` 分支。DeepSeek 种子评论 prompt 独立设计（争议提问 + 金句共鸣策略自动选择），不共享 interact 的中立评论 prompt。

**Tech Stack:** TypeScript, Playwright CDP, DeepSeek API, Commander

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/self-comment.ts` | **Create** | 文章列表抓取、种子评论生成、主流程编排 |
| `src/interact.ts` | **Modify** | 导出 `extractArticleInfo` 和 `typeComment` |
| `src/cli.ts` | **Modify** | 新增 `--self-comment` 选项和分支 |

---

### Task 1: Export shared functions from interact.ts

**Files:**
- Modify: `src/interact.ts:121` (extractArticleInfo)
- Modify: `src/interact.ts:298` (typeComment)

- [ ] **Step 1: Add `export` to `extractArticleInfo`**

Change line 121 from:
```typescript
async function extractArticleInfo(page: Page): Promise<{ title: string; content: string }> {
```
to:
```typescript
export async function extractArticleInfo(page: Page): Promise<{ title: string; content: string }> {
```

- [ ] **Step 2: Add `export` to `typeComment`**

Change line 298 from:
```typescript
async function typeComment(page: Page, comment: string): Promise<boolean> {
```
to:
```typescript
export async function typeComment(page: Page, comment: string): Promise<boolean> {
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors related to these exports.

- [ ] **Step 4: Commit**

```bash
git add src/interact.ts
git commit -m "refactor: export extractArticleInfo and typeComment for reuse"
```

---

### Task 2: Create self-comment module

**Files:**
- Create: `src/self-comment.ts`

- [ ] **Step 1: Write `src/self-comment.ts`**

```typescript
import { Page } from "playwright";
import * as child_process from "child_process";
import { extractArticleInfo, typeComment } from "./interact.js";

// ── Env ──

function getEnv(key: string): string | undefined {
  const val = process.env[key];
  if (val) return val;
  if (process.platform === "win32") {
    try {
      return child_process.execSync(
        `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('${key}','User')"`,
        { encoding: "utf-8" }
      ).trim();
    } catch { /* not set */ }
  }
  return undefined;
}

const DEEPSEEK_API_KEY = getEnv("DEEPSEEK_API_KEY");

// ── Article list scraping ──

interface ArticleItem {
  title: string;
  url: string;
}

export async function listPublishedArticles(page: Page): Promise<ArticleItem[]> {
  await page.goto("https://mp.toutiao.com/profile_v4/graphic/articles", {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await page.waitForTimeout(5000);

  return page.evaluate(() => {
    const items: { title: string; url: string }[] = [];
    // Target: links on the management page that point to published articles.
    // The page may have edit links (mp.toutiao.com) or public links (toutiao.com).
    // We collect public article links first, falling back to any article-related links.
    const links = document.querySelectorAll(
      'a[href*="/article/"], a[href*="/graphic/articles"]'
    );
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      const title = a.textContent?.trim() || "";
      if (title.length < 3) continue;
      // Normalize relative URLs
      const full = href.startsWith("http")
        ? href
        : `https://mp.toutiao.com${href.startsWith("/") ? "" : "/"}${href}`;
      items.push({ title, url: full });
    }
    return items;
  });
}

// ── Seed comment generation ──

const SEED_COMMENT_PROMPT = `根据以下文章内容，写一条能引发互动的种子评论（严格60-120字）。

策略（根据文章内容自动选择最合适的一种或结合使用）：
- **争议提问**：提炼文中一个存在争议或值得深入的点，用一个引人思考的问题表达，让人忍不住想回答
- **金句共鸣**：把文中最扎心的一句话或观点用大白话重新说出来，加上简短的感叹，让读者觉得"说的就是我"

要求：
- 语气真实，像真实读者的有感而发，不官方、不客气
- 不要用"写得很好""文章不错"这种客套话
- 不要引用原文（别说"文中提到..."）
- 要有互动感——让人觉得不回复都难受
- 即使是赞同的观点，也要表达得有张力

标题：TITLE_PLACEHOLDER
正文：CONTENT_PLACEHOLDER

请只输出评论内容，不要有任何前缀或引号。`;

async function generateSeedComment(title: string, content: string): Promise<string> {
  if (!DEEPSEEK_API_KEY) {
    return fallbackSeedComment(title, content);
  }

  const prompt = SEED_COMMENT_PROMPT
    .replace("TITLE_PLACEHOLDER", title)
    .replace("CONTENT_PLACEHOLDER", content.substring(0, 2000));

  try {
    const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const data = await resp.json() as any;
    const text = data?.choices?.[0]?.message?.content?.trim() || "";
    return text || fallbackSeedComment(title, content);
  } catch {
    return fallbackSeedComment(title, content);
  }
}

// ── Fallback: template-based seed comment ──

function fallbackSeedComment(title: string, _content: string): string {
  // Controversy-question style by default
  const questions = [
    `说实话，这种事换做是你，你能做到吗？`,
    `看完我就一个问题：值得吗？大家怎么看？`,
    `道理都懂，但真正能做到的有几个？`,
    `说得挺对，但现实中真的行得通吗？`,
  ];
  const reflections = [
    `"${title.substring(0, 25)}"——这句话真的戳到我了。有时候我们缺的不是道理，是有人帮我们把话说出来。`,
    `终于有人把这种感觉说清楚了。看完觉得，好像被理解了。`,
    `简单几句话，但每句都像在说我。这才是真正能让人静下来想的东西。`,
  ];
  const pool = [...questions, ...reflections];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Trim ──

function trimComment(text: string, maxLen: number = 120): string {
  if (text.length <= maxLen) return text;
  const slice = text.substring(0, maxLen);
  const match = slice.match(/.*[。！？]/);
  if (match) return match[0];
  return slice;
}

// ── Main pipeline ──

export async function selfCommentPipeline(page: Page): Promise<void> {
  // 1. Fetch article list
  console.log("获取已发布文章列表...");
  const articles = await listPublishedArticles(page);

  if (articles.length === 0) {
    console.log("暂无已发布文章。");
    return;
  }

  // 2. Print list
  console.log(`\n已发布文章 (${articles.length} 篇):\n`);
  for (let i = 0; i < articles.length; i++) {
    console.log(`  [${i + 1}] ${articles[i].title.substring(0, 60)}`);
  }

  // 3. Read user choice from stdin
  const idx = await new Promise<number>((resolve, reject) => {
    const rl = require("readline").createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(`\n选择文章编号 (1-${articles.length}): `, (answer: string) => {
      rl.close();
      const n = parseInt(answer.trim());
      if (isNaN(n) || n < 1 || n > articles.length) {
        reject(new Error(`无效编号: ${answer}`));
      } else {
        resolve(n - 1);
      }
    });
  });

  const chosen = articles[idx];
  console.log(`\n选中: ${chosen.title}`);

  // 4. Navigate to article
  await page.goto(chosen.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(8000);

  // 5. Extract article content
  const { title, content } = await extractArticleInfo(page);
  console.log(`正文: ${content.length} 字`);

  // 6. Generate seed comment
  const comment = await generateSeedComment(title || chosen.title, content);
  const final = trimComment(comment, 120);
  console.log(`种子评论 (${final.length}字): ${final}`);

  // 7. Submit comment
  const commentWrapper = page.locator(".ttp-comment-wrapper, .detail-interaction-comment").first();
  if (await commentWrapper.count() === 0) {
    console.log("未找到评论区");
    return;
  }
  const loginMask = commentWrapper.locator(".login-mask").first();
  if (await loginMask.count() > 0) {
    console.log("未登录，无法评论");
    return;
  }

  let success = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ok = await typeComment(page, final);
    if (ok) {
      console.log("种子评论提交成功");
      success = true;
      break;
    }
    console.log(`评论提交失败，重试 ${attempt}/3...`);
    await new Promise(r => setTimeout(r, 3000));
  }

  if (!success) {
    console.log("种子评论提交失败（已重试3次）");
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/self-comment.ts
git commit -m "feat: add self-comment module for seed comments on own articles"
```

---

### Task 3: Wire --self-comment into CLI

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add import**

Add after the existing `interact.ts` import (line 5):
```typescript
import { selfCommentPipeline } from "./self-comment.js";
```

- [ ] **Step 2: Add option**

Add after line 33 (`--preview` option):
```typescript
  .option("--self-comment", "为自己已发布文章撰写种子评论")
```

- [ ] **Step 3: Add branch in action**

Add after the interact mode block (after line 50-51):
```typescript
      // ---- Self-comment mode ----
      if (options.selfComment) {
        await selfCommentPipeline(session.page);
        exitCode = 0;
        return;
      }
```

The action should now have this order of mode checks:
1. Interact mode
2. Self-comment mode  ← new
3. Rewrite mode (from-url)
4. Publish mode

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add --self-comment CLI option"
```

---

### Task 4: Run tests

- [ ] **Step 1: Run existing tests**

Run: `npm test`
Expected: All existing tests pass.

- [ ] **Step 2: Verify no regressions**

Check that `extractArticleInfo` and `typeComment` exports don't break `interactArticles`.

- [ ] **Step 3: Commit if any test fixes needed**

(Only if tests reveal issues)
