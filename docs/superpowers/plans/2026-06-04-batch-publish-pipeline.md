# Batch Publish Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--batch-generate` and `--batch-publish` CLI commands that automate the full "热榜抓取→AI改写→人工审核→批量发布" pipeline.

**Architecture:** Two new modules (`src/article-store.ts`, `src/batch-generate.ts`, `src/batch-publish.ts`) plus an upgrade to `src/rewrite.ts` for narrative angles. The existing single-article `--from-url` flow is untouched. Batch generate uses headless Chromium for scraping; batch publish uses the user's CDP-connected Chrome.

**Tech Stack:** TypeScript, Playwright, Commander.js, DeepSeek API, Vitest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/article-store.ts` (NEW) | JSON read/write for `articles/pending/` and `articles/published/` |
| `src/rewrite.ts` (MODIFY) | Add narrative angle parameter to rewrite prompt |
| `src/batch-generate.ts` (NEW) | Hot list → scrape → rewrite → save pipeline (no user Chrome) |
| `src/batch-publish.ts` (NEW) | Read pending → publish one-by-one → archive (needs user Chrome) |
| `src/cli.ts` (MODIFY) | Add `--batch-generate` and `--batch-publish` commands |
| `tests/article-store.test.ts` (NEW) | Tests for JSON read/write |
| `tests/batch-generate.test.ts` (NEW) | Tests for generate pipeline |
| `tests/batch-publish.test.ts` (NEW) | Tests for publish pipeline |
| `tests/rewrite-narrative.test.ts` (NEW) | Tests for narrative angle prompt upgrade |
| `.gitignore` (MODIFY) | Add `articles/` directory |

---

### Task 1: Article Store — data layer for pending/published JSON

**Files:**
- Create: `src/article-store.ts`
- Create: `tests/article-store.test.ts`

**Interface:**

```typescript
// src/article-store.ts

export interface PendingArticle {
  title: string;
  content: string;
  category: string;
  topics: string[];
  source_url: string;
  narrative_angle: string;
  fact_count: number;
  generated_at: string;
}
```

Functions:
- `saveArticle(article: PendingArticle): Promise<string>` — writes JSON to `articles/pending/<filename>.json`, returns the filename
- `buildFilename(article: PendingArticle, index: number): string` — generates filename like `2026-06-04-001-社会-某地这事闹了3天.json`
- `loadPendingArticles(): Promise<{filename: string, article: PendingArticle}[]>` — reads all JSON from `articles/pending/`, sorted by filename
- `archiveArticle(filename: string): Promise<void>` — moves file from `articles/pending/<filename>` to `articles/published/<filename>`
- `getPublishedSourceUrls(): Promise<Set<string>>` — scans `articles/published/`, extracts all `source_url` values, returns as Set for dedup

- [ ] **Step 1: Write the failing tests for article-store**

Create `tests/article-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  buildFilename,
  saveArticle,
  loadPendingArticles,
  archiveArticle,
  getPublishedSourceUrls,
  PendingArticle,
} from "../src/article-store.js";

const TEST_DIR = path.join(process.cwd(), "articles_test");

// Redirect article-store to use TEST_DIR during tests
// We'll add a setArticlesDir() function for testability

describe("buildFilename", () => {
  it("produces correct format with index, category, and truncated title", () => {
    const article: PendingArticle = {
      title: "某地这事闹了3天，最终方案让人意外",
      content: "<p>test</p>",
      category: "社会",
      topics: ["社会热点"],
      source_url: "https://example.com/article/123",
      narrative_angle: "impact",
      fact_count: 8,
      generated_at: "2026-06-04T08:00:00+08:00",
    };
    const filename = buildFilename(article, 1);
    expect(filename).toMatch(/^2026-06-04-001-社会-/);
    expect(filename).toMatch(/\.json$/);
    // Title should be truncated
    expect(filename.length).toBeLessThan(100);
  });

  it("handles long titles by truncating", () => {
    const article: PendingArticle = {
      title: "这是一个非常非常非常非常非常非常非常非常非常非常非常非常长的标题".repeat(5),
      content: "<p>test</p>",
      category: "科技",
      topics: [],
      source_url: "https://x.com/1",
      narrative_angle: "event",
      fact_count: 1,
      generated_at: "2026-06-04T08:00:00+08:00",
    };
    const filename = buildFilename(article, 1);
    expect(filename.length).toBeLessThan(120);
  });

  it("sanitizes special characters in title for filename", () => {
    const article: PendingArticle = {
      title: '标题含特殊字符: / \\ : * ? " < > |',
      content: "<p>test</p>",
      category: "社会",
      topics: [],
      source_url: "https://x.com/1",
      narrative_angle: "why",
      fact_count: 0,
      generated_at: "2026-06-04T08:00:00+08:00",
    };
    const filename = buildFilename(article, 1);
    expect(filename).not.toMatch(/[\/\\:*?"<>|]/);
  });
});

describe("saveArticle and loadPendingArticles", () => {
  const testPendingDir = path.join(TEST_DIR, "pending");

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(testPendingDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  it("saves an article and loads it back", async () => {
    const article: PendingArticle = {
      title: "测试文章标题",
      content: "<h2>段落</h2><p>内容</p>",
      category: "科技",
      topics: ["AI", "芯片"],
      source_url: "https://example.com/123",
      narrative_angle: "event",
      fact_count: 5,
      generated_at: "2026-06-04T08:00:00+08:00",
    };

    const filename = await saveArticle(article, testPendingDir);
    expect(fs.existsSync(path.join(testPendingDir, filename))).toBe(true);

    const loaded = await loadPendingArticles(testPendingDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].filename).toBe(filename);
    expect(loaded[0].article.title).toBe("测试文章标题");
    expect(loaded[0].article.topics).toEqual(["AI", "芯片"]);
  });

  it("loads multiple articles sorted by filename", async () => {
    const base: PendingArticle = {
      title: "T", content: "<p>C</p>", category: "社会", topics: [],
      source_url: "https://x.com/X", narrative_angle: "event",
      fact_count: 1, generated_at: "2026-06-04T08:00:00+08:00",
    };

    await saveArticle({ ...base, title: "Third", source_url: "https://x.com/3" }, testPendingDir, "003-third.json");
    await saveArticle({ ...base, title: "First", source_url: "https://x.com/1" }, testPendingDir, "001-first.json");
    await saveArticle({ ...base, title: "Second", source_url: "https://x.com/2" }, testPendingDir, "002-second.json");

    const loaded = await loadPendingArticles(testPendingDir);
    expect(loaded).toHaveLength(3);
    expect(loaded[0].article.title).toBe("First");
    expect(loaded[1].article.title).toBe("Second");
    expect(loaded[2].article.title).toBe("Third");
  });
});

describe("archiveArticle", () => {
  const testPendingDir = path.join(TEST_DIR, "pending");
  const testPublishedDir = path.join(TEST_DIR, "published");

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(testPendingDir, { recursive: true });
    fs.mkdirSync(testPublishedDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  });

  it("moves file from pending to published", async () => {
    // Create a file in pending
    const pendingFile = path.join(testPendingDir, "test-article.json");
    fs.writeFileSync(pendingFile, JSON.stringify({ title: "Test" }));

    await archiveArticle("test-article.json", testPendingDir, testPublishedDir);

    expect(fs.existsSync(pendingFile)).toBe(false);
    expect(fs.existsSync(path.join(testPublishedDir, "test-article.json"))).toBe(true);
  });

  it("throws when source file does not exist", async () => {
    await expect(
      archiveArticle("nonexistent.json", testPendingDir, testPublishedDir)
    ).rejects.toThrow();
  });
});

describe("getPublishedSourceUrls", () => {
  const testPublishedDir = path.join(TEST_DIR, "published");

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(testPublishedDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  });

  it("returns all source_urls from published articles", async () => {
    fs.writeFileSync(
      path.join(testPublishedDir, "a.json"),
      JSON.stringify({ source_url: "https://example.com/1" })
    );
    fs.writeFileSync(
      path.join(testPublishedDir, "b.json"),
      JSON.stringify({ source_url: "https://example.com/2" })
    );

    const urls = await getPublishedSourceUrls(testPublishedDir);
    expect(urls).toEqual(new Set(["https://example.com/1", "https://example.com/2"]));
  });

  it("returns empty set when published dir is empty", async () => {
    const urls = await getPublishedSourceUrls(testPublishedDir);
    expect(urls.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/article-store.test.ts`
Expected: All tests FAIL — module not found

- [ ] **Step 3: Implement article-store.ts**

Create `src/article-store.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";

const DEFAULT_ARTICLES_DIR = path.join(process.cwd(), "articles");

export interface PendingArticle {
  title: string;
  content: string;
  category: string;
  topics: string[];
  source_url: string;
  narrative_angle: string;
  fact_count: number;
  generated_at: string;
}

/** Generate a filesystem-safe filename from article metadata. */
export function buildFilename(article: PendingArticle, index: number): string {
  const dateStr = article.generated_at.slice(0, 10); // "2026-06-04"
  const idx = String(index).padStart(3, "0");
  const cat = article.category || "未分类";

  // Truncate title: keep max 30 chars, strip unsafe filename chars
  const safeTitle = article.title
    .replace(/[\/\\:*?"<>|]/g, "")
    .replace(/\s+/g, "")
    .slice(0, 30);

  return `${dateStr}-${idx}-${cat}-${safeTitle}.json`;
}

/** Save an article JSON to the pending directory. Returns the filename. */
export async function saveArticle(
  article: PendingArticle,
  pendingDir?: string
): Promise<string> {
  const dir = pendingDir ?? path.join(DEFAULT_ARTICLES_DIR, "pending");
  fs.mkdirSync(dir, { recursive: true });

  // Determine next index
  const existing = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
  const index = existing.length + 1;

  const filename = buildFilename(article, index);
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, JSON.stringify(article, null, 2), "utf-8");
  return filename;
}

/** Load all pending articles sorted by filename. */
export async function loadPendingArticles(
  pendingDir?: string
): Promise<{ filename: string; article: PendingArticle }[]> {
  const dir = pendingDir ?? path.join(DEFAULT_ARTICLES_DIR, "pending");
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .sort(); // alphabetical = chronological due to date prefix

  const results: { filename: string; article: PendingArticle }[] = [];
  for (const filename of files) {
    const raw = fs.readFileSync(path.join(dir, filename), "utf-8");
    const article = JSON.parse(raw) as PendingArticle;
    results.push({ filename, article });
  }
  return results;
}

/** Move an article from pending to published. */
export async function archiveArticle(
  filename: string,
  pendingDir?: string,
  publishedDir?: string
): Promise<void> {
  const pending = pendingDir ?? path.join(DEFAULT_ARTICLES_DIR, "pending");
  const published = publishedDir ?? path.join(DEFAULT_ARTICLES_DIR, "published");
  fs.mkdirSync(published, { recursive: true });

  const src = path.join(pending, filename);
  if (!fs.existsSync(src)) {
    throw new Error(`File not found: ${src}`);
  }
  const dest = path.join(published, filename);
  fs.renameSync(src, dest);
}

/** Extract all source_url values from published articles for dedup. */
export async function getPublishedSourceUrls(
  publishedDir?: string
): Promise<Set<string>> {
  const dir = publishedDir ?? path.join(DEFAULT_ARTICLES_DIR, "published");
  if (!fs.existsSync(dir)) return new Set();

  const urls = new Set<string>();
  for (const filename of fs.readdirSync(dir)) {
    if (!filename.endsWith(".json")) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, filename), "utf-8");
      const article = JSON.parse(raw) as PendingArticle;
      if (article.source_url) {
        urls.add(article.source_url);
      }
    } catch {
      // Skip corrupted files
    }
  }
  return urls;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/article-store.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/article-store.ts tests/article-store.test.ts
git commit -m "feat: add article-store module for pending/published JSON management"
```

---

### Task 2: Upgrade rewrite prompt with narrative angles

**Files:**
- Modify: `src/rewrite.ts`
- Create: `tests/rewrite-narrative.test.ts`

Changes: Add `NarrativeAngle` type, `ANGLE_INSTRUCTIONS` map, modify `rewriteViaDeepSeek()` to accept an optional angle parameter.

- [ ] **Step 1: Write failing tests for narrative angle feature**

Create `tests/rewrite-narrative.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getAngleInstruction, NARRATIVE_ANGLES, NarrativeAngle } from "../src/rewrite.js";

describe("NARRATIVE_ANGLES", () => {
  it("has exactly 4 angles", () => {
    expect(NARRATIVE_ANGLES).toHaveLength(4);
  });

  it("each angle has a key, label, and instruction", () => {
    for (const angle of NARRATIVE_ANGLES) {
      expect(angle.key).toBeTruthy();
      expect(angle.label).toBeTruthy();
      expect(angle.instruction).toBeTruthy();
      expect(angle.instruction.length).toBeGreaterThan(20);
    }
  });

  it("keys are unique", () => {
    const keys = NARRATIVE_ANGLES.map(a => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("getAngleInstruction", () => {
  it("returns the instruction for a valid angle key", () => {
    const inst = getAngleInstruction("why");
    expect(inst.label).toBeTruthy();
    expect(inst.instruction).toContain("原因");
  });

  it("returns event angle for unknown keys", () => {
    const inst = getAngleInstruction("nonexistent" as NarrativeAngle);
    expect(inst.key).toBe("event");
  });

  it("returns event angle for undefined", () => {
    const inst = getAngleInstruction(undefined);
    expect(inst.key).toBe("event");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/rewrite-narrative.test.ts`
Expected: FAIL — exports not found

- [ ] **Step 3: Add narrative angle types and constants to rewrite.ts**

Insert after the `FactDiff` interface (around line 49 in current `rewrite.ts`):

```typescript
// ── Narrative Angles ──

export type NarrativeAngle = "event" | "why" | "impact" | "debate";

export interface AngleDefinition {
  key: NarrativeAngle;
  label: string;
  instruction: string;
}

export const NARRATIVE_ANGLES: AngleDefinition[] = [
  {
    key: "event",
    label: "事件梳理型",
    instruction: "按时间线梳理事件的起因、经过、结果。让读者快速了解"发生了什么"，重点突出关键转折点和最新进展。",
  },
  {
    key: "why",
    label: "追问解读型",
    instruction: "聚焦事件背后的原因和逻辑。回答"为什么会发生"，挖掘深层背景、利益关系、制度因素。引导读者理解事件本质。",
  },
  {
    key: "impact",
    label: "影响分析型",
    instruction: "分析事件对普通人的切身影响。回答"这意味着什么"，说明后续可能的变化、涉及的人群、应对策略。让读者觉得"这事和我有关"。",
  },
  {
    key: "debate",
    label: "争议展示型",
    instruction: "客观呈现围绕事件的各方观点。分别列出支持和反对的理由，不断然下结论。让读者了解全貌后自行判断。避免偏袒任何一方。",
  },
];

export function getAngleDefinition(angle?: NarrativeAngle): AngleDefinition {
  const found = NARRATIVE_ANGLES.find(a => a.key === angle);
  return found ?? NARRATIVE_ANGLES[0]; // default to "event"
}

export function randomAngle(): NarrativeAngle {
  return NARRATIVE_ANGLES[Math.floor(Math.random() * NARRATIVE_ANGLES.length)].key;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/rewrite-narrative.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Modify rewriteViaDeepSeek to accept narrative angle**

In `src/rewrite.ts`, modify the `rewriteViaDeepSeek` function signature and body.

Old signature:
```typescript
async function rewriteViaDeepSeek(
  title: string,
  content: string,
  facts: FactItem[]
): Promise<string | null> {
```

New signature (add optional 4th parameter):
```typescript
async function rewriteViaDeepSeek(
  title: string,
  content: string,
  facts: FactItem[],
  angle?: NarrativeAngle
): Promise<string | null> {
```

Replace the existing `REWRITE_SYSTEM_PROMPT` constant (around line 282-291) with:

```typescript
function buildRewriteSystemPrompt(angle?: NarrativeAngle): string {
  const def = getAngleDefinition(angle);

  return `你是新闻编辑。请按以下叙事角度重写这篇文章。

【角度：${def.label}】
${def.instruction}

【规则】
1. 全文 600-900 字，简洁有力
2. 输出 HTML 格式：<h2> 做小标题（搭配 1 个 emoji），<p> 做段落，<ol>/<ul> 做列表
3. <strong> 加粗关键数据、核心结论
4. 严禁修改任何数字、百分比、人名、地名、机构名、专有名词
5. 严禁虚构数据、增删事实
6. 不要用"这篇文章""作者认为"等套话
7. 改写后，在文章末尾单独一行输出 3 个备选标题（每行一个），格式为：
【备选标题】
标题1
标题2
标题3`;
}
```

In the `rewriteViaDeepSeek` function body, replace:
```typescript
messages: [
  { role: "system", content: REWRITE_SYSTEM_PROMPT },
```
with:
```typescript
messages: [
  { role: "system", content: buildRewriteSystemPrompt(angle) },
```

Add a new `RewriteResult` interface and a `rewriteWithAngle` function. Then modify `rewriteViaDeepSeek` to delegate to it, preserving backward compatibility.

Add after the `REWRITE_SYSTEM_PROMPT` constant (replace the old one with `buildRewriteSystemPrompt`):

```typescript
export interface RewriteResult {
  content: string;
  suggestedTitles: string[];
}

async function rewriteWithAngle(
  title: string,
  content: string,
  facts: FactItem[],
  angle?: NarrativeAngle
): Promise<RewriteResult> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("未配置 DeepSeek API Key");
  }

  const factsBlock = formatFactsForPrompt(facts);
  const factsConstraint = factsBlock
    ? `\n\n【关键事实清单 — 严禁修改或删除以下任何内容】\n${factsBlock}\n`
    : "";

  const userPrompt = `标题：${title}\n\n原文：\n${content.substring(0, 4000)}${factsConstraint}`;

  const makeRequest = async (): Promise<RewriteResult> => {
    const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: buildRewriteSystemPrompt(angle) },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 4000,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    const data = (await resp.json()) as any;
    const text = data?.choices?.[0]?.message?.content?.trim() || "";
    if (!text) throw new Error("DeepSeek 返回空内容");

    // Extract suggested titles
    let contentBody = text;
    let suggestedTitles: string[] = [];
    const titleMatch = text.match(/【备选标题】\s*\n([\s\S]*)$/);
    if (titleMatch) {
      contentBody = text.replace(/【备选标题】[\s\S]*$/, "").trim();
      suggestedTitles = titleMatch[1]
        .split("\n")
        .map((s: string) => s.replace(/^[\d\.\s、]+/, "").trim())
        .filter(Boolean);
    }

    return { content: contentBody, suggestedTitles };
  };

  try {
    const result = await withRetry(makeRequest, 2);
    console.log(`DeepSeek 改写完成 (${result.content.length}字), ${result.suggestedTitles.length} 个备选标题`);
    return result;
  } catch (err) {
    console.error("改写失败:", (err as Error).message);
    throw new Error("REWRITE_FAILED: DeepSeek 改写失败，终止发布");
  }
}

// Keep old function signature for backward compat
async function rewriteViaDeepSeek(
  title: string,
  content: string,
  facts: FactItem[],
  angle?: NarrativeAngle
): Promise<string | null> {
  try {
    const result = await rewriteWithAngle(title, content, facts, angle);
    return result.content;
  } catch {
    return null;
  }
}
```

Note: `rewriteViaDeepSeek` now silently returns `null` on failure (matching old behavior), while `rewriteWithAngle` throws (so batch-generate can catch and handle). The `rewritePipeline` function in `rewrite.ts` uses `rewriteViaDeepSeek` internally and will continue to work unchanged — if it returns null, `rewritePipeline` throws `REWRITE_FAILED` as before.

Export `rewriteWithAngle` — it will be used by `batch-generate.ts`.

- [ ] **Step 6: Verify existing rewrite tests still pass**

Run: `npx vitest run tests/rewrite.test.ts`
Expected: All existing tests PASS (backward compatible)

- [ ] **Step 7: Commit**

```bash
git add src/rewrite.ts tests/rewrite-narrative.test.ts
git commit -m "feat: add narrative angle system to rewrite prompt"
```

---

### Task 3: Batch generate pipeline

**Files:**
- Create: `src/batch-generate.ts`
- Create: `tests/batch-generate.test.ts`

`batch-generate.ts` orchestrates the full generation flow. It does NOT connect to user Chrome — it launches its own headless Chromium for scraping.

- [ ] **Step 1: Write tests**

Create `tests/batch-generate.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { filterHotItems, normalizeSourceUrl } from "../src/batch-generate.js";
import type { HotItem } from "../src/trend.js";

describe("normalizeSourceUrl", () => {
  it("extracts article ID from toutiao URLs", () => {
    expect(normalizeSourceUrl("https://www.toutiao.com/article/123456/"))
      .toBe("article/123456");
  });

  it("extracts trending ID", () => {
    expect(
      normalizeSourceUrl("https://www.toutiao.com/trending/999888/")
    ).toBe("trending/999888");
  });

  it("returns URL unchanged if no pattern matches", () => {
    expect(normalizeSourceUrl("https://example.com/news/123"))
      .toBe("https://example.com/news/123");
  });

  it("strips query parameters", () => {
    expect(
      normalizeSourceUrl("https://www.toutiao.com/article/123456/?hot_board_impr_id=abc")
    ).toBe("article/123456");
  });
});

describe("filterHotItems", () => {
  const makeItem = (overrides: Partial<HotItem> = {}): HotItem => ({
    title: "Test Article",
    url: "https://www.toutiao.com/article/1/",
    source: "头条热榜",
    category: "社会",
    rootCategory: "social",
    publishedAt: "2026-06-04T08:00:00Z",
    rank: 1,
    ...overrides,
  });

  it("filters out published URLs", () => {
    const published = new Set(["article/1"]);
    const items = [
      makeItem({ url: "https://www.toutiao.com/article/1/" }),
      makeItem({ url: "https://www.toutiao.com/article/2/", rank: 2 }),
    ];
    const result = filterHotItems(items, published);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://www.toutiao.com/article/2/");
  });

  it("deduplicates by normalized URL within the same batch", () => {
    const published = new Set<string>();
    const items = [
      makeItem({ url: "https://www.toutiao.com/article/1/?a=1" }),
      makeItem({ url: "https://www.toutiao.com/article/1/?a=2", rank: 2 }),
    ];
    const result = filterHotItems(items, published);
    expect(result).toHaveLength(1);
  });

  it("sorts by rank ascending", () => {
    const published = new Set<string>();
    const items = [
      makeItem({ url: "https://www.toutiao.com/article/3/", rank: 3 }),
      makeItem({ url: "https://www.toutiao.com/article/1/", rank: 1 }),
      makeItem({ url: "https://www.toutiao.com/article/2/", rank: 2 }),
    ];
    const result = filterHotItems(items, published);
    expect(result.map(r => r.rank)).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/batch-generate.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement batch-generate.ts**

Create `src/batch-generate.ts`:

```typescript
import { chromium, Browser, Page } from "playwright";
import { fetchToutiaoItems, HotItem } from "./trend.js";
import { scrapeArticle, extractFactsViaDeepSeek, rewriteViaDeepSeek, validateFacts, fixDiscrepancies, withRetry, NarrativeAngle, randomAngle } from "./rewrite.js";
import { generateTopicsViaDeepSeek } from "./topics.js";
import { detectCategory } from "./category.js";
import { saveArticle, getPublishedSourceUrls, PendingArticle } from "./article-store.js";

/** Normalize a source URL for dedup — extract stable ID. */
export function normalizeSourceUrl(url: string): string {
  const m = url.match(/toutiao\.com\/(trending|article|a)\/(\d+)/);
  if (m) return `${m[1]}/${m[2]}`;
  return url;
}

/** Filter and dedup hot items against already-published URLs. */
export function filterHotItems(
  items: HotItem[],
  publishedUrls: Set<string>
): HotItem[] {
  const seen = new Set<string>();
  const result: HotItem[] = [];

  // Sort by rank
  const sorted = [...items].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));

  for (const item of sorted) {
    const normalized = normalizeSourceUrl(item.url);
    if (publishedUrls.has(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(item);
  }
  return result;
}

export interface BatchGenerateOptions {
  count: number;
  category?: string;
  noLLM?: boolean;
}

export interface BatchGenerateResult {
  generated: number;
  discarded: number;
  pendingFiles: string[];
}

/** Main batch generate pipeline. Launches its own headless browser for scraping. */
export async function batchGenerate(
  options: BatchGenerateOptions
): Promise<BatchGenerateResult> {
  const { count, noLLM = false } = options;

  // 1. Fetch hot list
  console.log("正在获取头条热榜...");
  const hotItems = await fetchToutiaoItems();
  console.log(`  获取到 ${hotItems.length} 条热榜条目`);

  // 2. Dedup against published
  const publishedUrls = await getPublishedSourceUrls();
  const filtered = filterHotItems(hotItems, publishedUrls);
  console.log(`  去重后剩余 ${filtered.length} 条 (已排除 ${publishedUrls.size} 条已发布)`);

  if (filtered.length === 0) {
    console.log("无新文章可生成");
    return { generated: 0, discarded: 0, pendingFiles: [] };
  }

  // 3. Launch headless browser for scraping
  console.log("启动无头浏览器用于抓取...");
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  } catch (err) {
    console.error("无法启动无头浏览器:", (err as Error).message);
    return { generated: 0, discarded: 0, pendingFiles: [] };
  }

  let generated = 0;
  let discarded = 0;
  const pendingFiles: string[] = [];
  const targetCount = Math.min(count, filtered.length);

  try {
    for (let i = 0; i < targetCount; i++) {
      const item = filtered[i];
      console.log(`\n[${i + 1}/${targetCount}] ${item.title.substring(0, 40)}`);

      try {
        // 3a. Scrape
        const source = await withRetry(() => scrapeArticle(page!, item.url), 2);
        const text = source.content.substring(0, 4000);

        if (noLLM) {
          // Skip LLM, save raw scrape
          const category = detectCategory(source.title, source.content) ?? "其他";
          const article: PendingArticle = {
            title: source.title,
            content: `<p>${source.content.replace(/\n/g, "</p><p>")}</p>`,
            category,
            topics: [],
            source_url: item.url,
            narrative_angle: "event",
            fact_count: 0,
            generated_at: new Date().toISOString(),
          };
          const filename = await saveArticle(article);
          pendingFiles.push(filename);
          generated++;
          console.log(`  ✅ 已保存 (无 LLM 模式)`);
          continue;
        }

        // 3b. Extract facts
        const facts = await extractFactsViaDeepSeek(text, source.title);
        console.log(`  提取 ${facts.length} 条事实`);

        // 3c. Select random narrative angle
        const angle = randomAngle();
        console.log(`  叙事角度: ${angle}`);

        // 3d. Rewrite
        const rewritten = await rewriteViaDeepSeek(source.title, text, facts, angle);
        if (!rewritten) {
          console.log(`  ⚠ 改写返回空，丢弃`);
          discarded++;
          continue;
        }

        // 3e. Validate
        const diff = validateFacts(rewritten, facts);
        if (diff.missing.length > 0 || diff.altered.length > 0) {
          // Try fix
          try {
            const fixed = await fixDiscrepancies(rewritten, facts, diff);
            const diff2 = validateFacts(fixed, facts);
            const blockingMissing = diff2.missing.filter(f => f.type !== "event");
            if (blockingMissing.length > 0 || diff2.altered.length > 0) {
              console.log(`  🔴 事实校验二次失败，丢弃`);
              discarded++;
              continue;
            }
            // Use fixed version
            const article = await buildArticle(fixed, item.url, angle, facts.length);
            const filename = await saveArticle(article);
            pendingFiles.push(filename);
            generated++;
            console.log(`  ✅ 已保存 (修正后)`);
            continue;
          } catch {
            console.log(`  🔴 修正失败，丢弃`);
            discarded++;
            continue;
          }
        }

        // 3f. Build and save
        const article = await buildArticle(rewritten, item.url, angle, facts.length);
        const filename = await saveArticle(article);
        pendingFiles.push(filename);
        generated++;
        console.log(`  ✅ 已保存 (${facts.length} 条事实)`);

      } catch (err) {
        console.log(`  ⚠ 处理失败: ${(err as Error).message.substring(0, 80)}`);
        discarded++;
      }
    }
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  return { generated, discarded, pendingFiles };
}

async function buildArticle(
  content: string,
  sourceUrl: string,
  angle: NarrativeAngle,
  factCount: number
): Promise<PendingArticle> {
  // Extract suggested titles from the rewrite output
  let title = "";
  let bodyContent = content;

  // DeepSeek may have appended titles at the end — handled in rewriteViaDeepSeek
  // For now, use first h2 or first 30 chars as fallback
  const h2Match = content.match(/<h2[^>]*>(.*?)<\/h2>/);
  if (h2Match) {
    title = h2Match[1].replace(/<[^>]+>/g, "").trim();
  } else {
    const textOnly = content.replace(/<[^>]+>/g, "").trim();
    title = textOnly.substring(0, 30);
  }

  // Generate topics
  let topics: string[] = [];
  try {
    topics = await generateTopicsViaDeepSeek(content, title);
  } catch {
    // Topics are optional
  }

  // Detect category
  const cat = detectCategory(title, content) ?? "社会";

  return {
    title,
    content: bodyContent,
    category: cat,
    topics: topics.slice(0, 5),
    source_url: sourceUrl,
    narrative_angle: angle,
    fact_count: factCount,
    generated_at: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/batch-generate.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/batch-generate.ts tests/batch-generate.test.ts
git commit -m "feat: add batch generate pipeline"
```

---

### Task 4: Batch publish pipeline

**Files:**
- Create: `src/batch-publish.ts`
- Create: `tests/batch-publish.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/batch-publish.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { scanPendingFiles } from "../src/batch-publish.js";

const TEST_DIR = path.join(process.cwd(), "articles_batch_test");

describe("scanPendingFiles", () => {
  const pendingDir = path.join(TEST_DIR, "pending");

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(pendingDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  });

  it("returns empty array when no pending files", async () => {
    const files = await scanPendingFiles(pendingDir);
    expect(files).toEqual([]);
  });

  it("returns sorted JSON files", async () => {
    fs.writeFileSync(path.join(pendingDir, "002-b.json"), JSON.stringify({ title: "B" }));
    fs.writeFileSync(path.join(pendingDir, "001-a.json"), JSON.stringify({ title: "A" }));
    fs.writeFileSync(path.join(pendingDir, "not-json.txt"), "not json");

    const files = await scanPendingFiles(pendingDir);
    expect(files).toHaveLength(2);
    expect(files[0]).toBe("001-a.json");
    expect(files[1]).toBe("002-b.json");
  });

  it("ignores non-JSON files", async () => {
    fs.writeFileSync(path.join(pendingDir, "readme.md"), "# readme");
    fs.writeFileSync(path.join(pendingDir, "001-test.json"), JSON.stringify({ title: "T" }));

    const files = await scanPendingFiles(pendingDir);
    expect(files).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/batch-publish.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement batch-publish.ts**

Create `src/batch-publish.ts`:

```typescript
import type { Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { loadPendingArticles, archiveArticle, PendingArticle } from "./article-store.js";
import { typeTitle, insertContent, insertTopics } from "./editor.js";
import { setDeclarations, publishArticle } from "./publish.js";
import { detectCategory, formatTitle } from "./category.js";
import { detectSuggestions, clickSuggestionImage } from "./suggestions.js";
import { formatContentLists } from "./rewrite.js";
import { CONFIG } from "./config.js";

const DEFAULT_ARTICLES_DIR = path.join(process.cwd(), "articles");

/** Scan the pending directory and return sorted JSON filenames. */
export async function scanPendingFiles(pendingDir: string): Promise<string[]> {
  if (!fs.existsSync(pendingDir)) return [];
  return fs.readdirSync(pendingDir)
    .filter(f => f.endsWith(".json"))
    .sort();
}

export interface BatchPublishOptions {
  intervalMinutes: number;
}

export interface BatchPublishResult {
  succeeded: number;
  failed: number;
  failedFiles: { filename: string; error: string }[];
}

/** Publish all articles in the pending directory, one by one. */
export async function batchPublish(
  page: Page,
  options: BatchPublishOptions
): Promise<BatchPublishResult> {
  const pendingDir = path.join(DEFAULT_ARTICLES_DIR, "pending");
  const publishedDir = path.join(DEFAULT_ARTICLES_DIR, "published");

  const files = await scanPendingFiles(pendingDir);
  if (files.length === 0) {
    console.log("无待发布文章");
    return { succeeded: 0, failed: 0, failedFiles: [] };
  }

  console.log(`找到 ${files.length} 篇待发布文章\n`);

  let succeeded = 0;
  let failed = 0;
  const failedFiles: { filename: string; error: string }[] = [];

  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    console.log(`\n[${i + 1}/${files.length}] 发布: ${filename}`);

    try {
      // Read article
      const filepath = path.join(pendingDir, filename);
      const raw = fs.readFileSync(filepath, "utf-8");
      const article: PendingArticle = JSON.parse(raw);

      // Open publish page
      await page.goto(CONFIG.PUBLISH_URL, {
        waitUntil: "domcontentloaded",
        timeout: CONFIG.DEFAULT_TIMEOUT,
      });
      await page.waitForTimeout(5000);

      // Type title
      const displayTitle = article.category
        ? formatTitle(article.title, article.category as any)
        : article.title;
      await typeTitle(page, displayTitle);

      // Insert content
      const contentHtml = formatContentLists(article.content);
      await insertContent(page, contentHtml);

      // Topics
      if (article.topics.length > 0) {
        await insertTopics(page, article.topics.slice(0, 5));
      }

      // Cover
      const noCoverLabel = page.locator("label", { hasText: "无封面" }).first();
      try {
        await noCoverLabel.click({ force: true, timeout: 3000 });
      } catch {
        // Cover selection is non-critical
      }

      // Declarations
      await setDeclarations(page);

      // Publish
      const ok = await publishArticle(page);
      if (ok) {
        await archiveArticle(filename, pendingDir, publishedDir);
        succeeded++;
        console.log(`  ✅ 发布成功 → 已归档`);
      } else {
        failed++;
        failedFiles.push({ filename, error: "发布验证失败" });
        console.log(`  ❌ 发布验证失败，文件保留在 pending/`);
      }

    } catch (err) {
      failed++;
      const errorMsg = (err as Error).message.substring(0, 100);
      failedFiles.push({ filename, error: errorMsg });
      console.log(`  ❌ 失败: ${errorMsg}`);
    }

    // Wait interval between articles (skip after last)
    if (i < files.length - 1) {
      const waitMs = options.intervalMinutes * 60 * 1000;
      console.log(`  等待 ${options.intervalMinutes} 分钟...`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  console.log(`\n=== 批量发布完成: ✅ ${succeeded} ❌ ${failed} ===`);
  return { succeeded, failed, failedFiles };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/batch-publish.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/batch-publish.ts tests/batch-publish.test.ts
git commit -m "feat: add batch publish pipeline"
```

---

### Task 5: CLI integration — add --batch-generate and --batch-publish

**Files:**
- Modify: `src/cli.ts`

Restructure the CLI to handle the new commands without breaking existing `--from-url` and direct publish flows.

- [ ] **Step 1: Add batch command handlers to cli.ts**

The current CLI uses a single `.action()`. We need to restructure to handle batch modes early, before the existing validation that requires `--title` and `--content`.

Replace the entire `.action(async (options) => { ... })` callback in `src/cli.ts`:

```typescript
  .action(async (options) => {
    // ── Batch Generate mode (no Chrome needed) ──
    if (options.batchGenerate) {
      const { batchGenerate } = await import("./batch-generate.js");
      const count = parseInt(options.count || "5");
      const result = await batchGenerate({
        count,
        category: options.category || undefined,
        noLLM: !options.llm,
      });
      console.log(`\n=== 批量生成完成 ===`);
      console.log(`✅ ${result.generated} 篇已保存至 articles/pending/`);
      if (result.discarded > 0) {
        console.log(`🔴 ${result.discarded} 篇因校验失败丢弃`);
      }
      if (result.pendingFiles.length > 0) {
        console.log(`待审核文章:`);
        for (const f of result.pendingFiles) {
          console.log(`  📄 ${f}`);
        }
        console.log(`\n审核后执行: npx tsx src/cli.ts --batch-publish`);
      }
      process.exit(0);
    }

    // ── Batch Publish mode (needs user Chrome) ──
    if (options.batchPublish) {
      const session = await createSession();
      try {
        const loggedIn = await ensureLogin(session.page);
        if (!loggedIn) {
          console.error("登录失败，退出");
          process.exit(1);
        }
        const { batchPublish } = await import("./batch-publish.js");
        const interval = parseInt(options.publishInterval || "30");
        const result = await batchPublish(session.page, {
          intervalMinutes: interval,
        });
        if (result.succeeded > 0) {
          console.log(`✅ ${result.succeeded} 篇已发布并归档`);
        }
        if (result.failed > 0) {
          console.log(`❌ ${result.failed} 篇失败（保留在 articles/pending/）:`);
          for (const f of result.failedFiles) {
            console.log(`  - ${f.filename}: ${f.error}`);
          }
        }
      } finally {
        await closeSession(session);
      }
      process.exit(0);
    }

    // ── Original flow: interact mode, from-url, or direct publish ──
    const session = await createSession();
    let exitCode = 1;
    try {
      // ... (existing code from Step 1 login check through to publish, unchanged)
    } catch (err) {
      console.error("发布过程出错:", err);
    } finally {
      try { await closeSession(session); } catch {}
    }
    process.exit(exitCode);
  });
```

Add the new options to the program definition (after existing options, before `.action`):

```typescript
  .option("--batch-generate", "批量生成模式：自动从热榜抓取并改写文章")
  .option("--batch-publish", "批量发布模式：发布 articles/pending/ 中的所有文章")
  .option("--publish-interval <min>", "批量发布篇间间隔（分钟）", "30")
```

Note: The existing `--count` is used by `--interact` as `--interact-count`. For `--batch-generate` we reuse `--count` but that's already taken. Actually, looking at the current CLI, there's no `--count` option — there's `--interact-count` and `--image-count`. Let me re-read cli.ts to check.

Actually, looking at the current CLI:
- `--interact-count <number>` for interact
- `--image-count <number>` for image reuse

We need a `--count` option for batch-generate. Let's add it as a new option:

```typescript
  .option("--count <number>", "批量生成文章数量", "5")
```

This needs to be added to the CLI options. Also need `--no-llm` for skipping LLM in batch generate.

Wait, `--no-llm` is already a convention used elsewhere. Let me check if it would conflict... Looking at the current CLI, there's no `--llm` or `--no-llm` option. But adding `--no-llm` would create a `options.llm` boolean (default true). Let me just add it.

Actually, let me be more careful. Let me re-read the current CLI options list and make sure my additions don't conflict with existing ones.

Current options:
```
--title <title>
--content <html>
--image-keyword <keyword>
--image-category <category>
--cover-keyword <keyword>
--no-images
--reuse-images
--image-files <paths>
--image-count <number>
--interact
--interact-count <number>
--no-declarations
--no-topics
--category <name>
--from-url <url>
--preview
```

New options to add:
```
--batch-generate
--batch-publish
--count <number>         (for batch-generate)
--publish-interval <min> (for batch-publish)
--no-llm                (for batch-generate, skip LLM)
```

`--count` is new, no conflict.
`--publish-interval` is new, no conflict.
`--no-llm` is new, no conflict.

OK, let me finalize the plan.

- [ ] **Step 1: Add new CLI options**

Insert after the `--preview` option in `src/cli.ts`:

```typescript
  .option("--batch-generate", "从热榜批量生成文章到 articles/pending/")
  .option("--batch-publish", "发布 articles/pending/ 中的所有待发文章")
  .option("--count <number>", "批量生成数量", "5")
  .option("--publish-interval <min>", "批量发布间隔（分钟）", "30")
  .option("--no-llm", "批量生成时跳过 DeepSeek 改写")
```

- [ ] **Step 2: Add batch mode handlers in action callback**

Insert the batch-generate and batch-publish handlers at the very top of the `.action()` callback, before the existing session creation. Use dynamic `import()` for the batch modules so they're only loaded when needed.

- [ ] **Step 3: Verify existing CLI functionality is unchanged**

Run: `npx tsx src/cli.ts --help`
Expected: See all options including new batch options

Run: `npx tsx src/cli.ts --title "test" --content "<p>test</p>"` (without Chrome)
Expected: Fails with CDP connection error (NOT a parsing error) — proves existing flow untouched

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add --batch-generate and --batch-publish CLI commands"
```

---

### Task 6: Update .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add articles/ directory to .gitignore**

Add `articles/` to `.gitignore`:

```
articles/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add articles/ to .gitignore"
```

---

### Task 7: End-to-end integration test

**Files:**
- Create: `tests/integration-batch.test.ts`

This test verifies the full article-store + batch-generate + batch-publish pipeline works end-to-end with mocks.

- [ ] **Step 1: Write integration test**

Create `tests/integration-batch.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { saveArticle, loadPendingArticles, archiveArticle, getPublishedSourceUrls, PendingArticle } from "../src/article-store.js";
import { scanPendingFiles } from "../src/batch-publish.js";
import { normalizeSourceUrl, filterHotItems } from "../src/batch-generate.js";
import type { HotItem } from "../src/trend.js";

const TEST_DIR = path.join(process.cwd(), "articles_integration_test");
const PENDING = path.join(TEST_DIR, "pending");
const PUBLISHED = path.join(TEST_DIR, "published");

describe("full batch pipeline (integration)", () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(PENDING, { recursive: true });
    fs.mkdirSync(PUBLISHED, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  });

  it("generate → review → publish → archive flow", async () => {
    // 1. Simulate batch-generate saving articles
    const article1: PendingArticle = {
      title: "测试文章一",
      content: "<p>内容一</p>",
      category: "社会",
      topics: ["热点"],
      source_url: "https://www.toutiao.com/article/111/",
      narrative_angle: "event",
      fact_count: 3,
      generated_at: new Date().toISOString(),
    };
    const article2: PendingArticle = {
      title: "测试文章二",
      content: "<p>内容二</p>",
      category: "科技",
      topics: ["AI"],
      source_url: "https://www.toutiao.com/article/222/",
      narrative_angle: "why",
      fact_count: 5,
      generated_at: new Date().toISOString(),
    };

    const file1 = await saveArticle(article1, PENDING);
    const file2 = await saveArticle(article2, PENDING);

    // 2. Review: user deletes article2 (simulate)
    fs.unlinkSync(path.join(PENDING, file2));

    // 3. Scan pending
    const pendingFiles = await scanPendingFiles(PENDING);
    expect(pendingFiles).toHaveLength(1);
    expect(pendingFiles[0]).toBe(file1);

    // 4. Load article
    const loaded = await loadPendingArticles(PENDING);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].article.title).toBe("测试文章一");

    // 5. Publish and archive
    await archiveArticle(file1, PENDING, PUBLISHED);
    expect(fs.existsSync(path.join(PENDING, file1))).toBe(false);
    expect(fs.existsSync(path.join(PUBLISHED, file1))).toBe(true);

    // 6. Verify published URL dedup
    const urls = await getPublishedSourceUrls(PUBLISHED);
    expect(urls.has("https://www.toutiao.com/article/111/")).toBe(true);
    expect(urls.has("https://www.toutiao.com/article/222/")).toBe(false); // was deleted
  });

  it("dedup works across the full pipeline", async () => {
    // Publish one article first
    const published: PendingArticle = {
      title: "已发布文章",
      content: "<p>内容</p>",
      category: "社会",
      topics: [],
      source_url: "https://www.toutiao.com/article/existing/",
      narrative_angle: "event",
      fact_count: 2,
      generated_at: new Date().toISOString(),
    };
    await saveArticle(published, PENDING);
    const pendingFiles = await scanPendingFiles(PENDING);
    await archiveArticle(pendingFiles[0], PENDING, PUBLISHED);

    // Now check dedup against published
    const publishedUrls = await getPublishedSourceUrls(PUBLISHED);
    expect(publishedUrls.size).toBe(1);

    const hotItems: HotItem[] = [
      {
        title: "已存在的文章",
        url: "https://www.toutiao.com/article/existing/",
        source: "头条热榜", category: "", rootCategory: "",
        publishedAt: "", rank: 1,
      },
      {
        title: "新文章",
        url: "https://www.toutiao.com/article/new-one/",
        source: "头条热榜", category: "", rootCategory: "",
        publishedAt: "", rank: 2,
      },
    ];

    const filtered = filterHotItems(hotItems, publishedUrls);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].url).toBe("https://www.toutiao.com/article/new-one/");
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `npx vitest run tests/integration-batch.test.ts`
Expected: 2 tests PASS

- [ ] **Step 3: Run all tests to ensure nothing is broken**

Run: `npx vitest run`
Expected: All tests across all test files PASS

- [ ] **Step 4: Commit**

```bash
git add tests/integration-batch.test.ts
git commit -m "test: add end-to-end integration test for batch pipeline"
```

---

## Summary

| Task | Module | Files |
|------|--------|-------|
| 1 | Article store | `src/article-store.ts`, `tests/article-store.test.ts` |
| 2 | Narrative angles | `src/rewrite.ts`, `tests/rewrite-narrative.test.ts` |
| 3 | Batch generate | `src/batch-generate.ts`, `tests/batch-generate.test.ts` |
| 4 | Batch publish | `src/batch-publish.ts`, `tests/batch-publish.test.ts` |
| 5 | CLI integration | `src/cli.ts` |
| 6 | Gitignore | `.gitignore` |
| 7 | Integration test | `tests/integration-batch.test.ts` |

**Total: 7 tasks, ~8 new/modified files, ~10 commits**
