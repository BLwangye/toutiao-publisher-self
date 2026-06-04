import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as path from "path";

// ESM module namespace is not configurable, so we vi.mock fs to make
// renameSync a controllable spy (defaults to calling through to the real impl).
const renameMock = vi.hoisted(() => vi.fn());
const copyMock = vi.hoisted(() => vi.fn());
const unlinkMock = vi.hoisted(() => vi.fn());

vi.mock("fs", async (importOriginal) => {
  const mod: Record<string, unknown> = await importOriginal();
  renameMock.mockImplementation(mod.renameSync as (...args: unknown[]) => unknown);
  copyMock.mockImplementation(mod.copyFileSync as (...args: unknown[]) => unknown);
  unlinkMock.mockImplementation(mod.unlinkSync as (...args: unknown[]) => unknown);
  return {
    ...mod,
    renameSync: renameMock,
    copyFileSync: copyMock,
    unlinkSync: unlinkMock,
  };
});

import * as fs from "fs";
import {
  buildFilename,
  saveArticle,
  loadPendingArticles,
  archiveArticle,
  getPublishedSourceUrls,
  normalizeSourceUrl,
  PendingArticle,
} from "../src/article-store.js";

const TEST_DIR = path.join(process.cwd(), "articles_test");

function makeArticle(overrides: Partial<PendingArticle> = {}): PendingArticle {
  return {
    title: "测试文章标题",
    content: "<p>测试内容</p>",
    category: "社会",
    topics: ["社会热点"],
    source_url: "https://example.com/article/1",
    narrative_angle: "impact",
    fact_count: 5,
    generated_at: "2026-06-04T08:00:00+08:00",
    ...overrides,
  };
}

describe("buildFilename", () => {
  it("produces correct format with index, category, and truncated title", () => {
    const article = makeArticle({
      title: "某地这事闹了3天，最终方案让人意外",
    });
    const filename = buildFilename(article, 1);
    expect(filename).toMatch(/^2026-06-04-001-社会-/);
    expect(filename).toMatch(/\.json$/);
    expect(filename.length).toBeLessThan(100);
  });

  it("handles long titles by truncating", () => {
    const article = makeArticle({
      title: "这是一个非常非常非常非常非常非常非常非常非常非常非常非常长的标题".repeat(5),
      category: "科技",
    });
    const filename = buildFilename(article, 1);
    expect(filename.length).toBeLessThan(120);
  });

  it("sanitizes special characters in title for filename", () => {
    const article = makeArticle({
      title: '标题含特殊字符: / \\ : * ? " < > |',
    });
    const filename = buildFilename(article, 1);
    expect(filename).not.toMatch(/[\/\\:*?"<>|]/);
  });
});

describe("saveArticle", () => {
  const pendingDir = path.join(TEST_DIR, "save-pending");

  beforeEach(() => {
    fs.mkdirSync(pendingDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("writes article JSON to pending dir and returns filename", async () => {
    const article = makeArticle();
    const filename = await saveArticle(article, pendingDir);
    expect(filename).toMatch(/\.json$/);

    const filePath = path.join(pendingDir, filename);
    expect(fs.existsSync(filePath)).toBe(true);

    const saved = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(saved.title).toBe(article.title);
    expect(saved.content).toBe(article.content);
    expect(saved.source_url).toBe(article.source_url);
  });

  it("increments index for consecutive saves", async () => {
    const article = makeArticle();
    const f1 = await saveArticle(article, pendingDir);
    expect(f1).toMatch(/-001-/);

    const f2 = await saveArticle(article, pendingDir);
    expect(f2).toMatch(/-002-/);
  });

  it("creates the pending directory if it does not exist", async () => {
    const newDir = path.join(TEST_DIR, "brand-new");
    const article = makeArticle();
    const filename = await saveArticle(article, newDir);
    expect(fs.existsSync(path.join(newDir, filename))).toBe(true);
  });

  it("persists article content correctly in JSON file", async () => {
    const article = makeArticle({
      title: "测试文章",
      content: "<p>hello world</p>",
      category: "科技",
      topics: ["AI", "科技"],
      source_url: "https://x.com/test",
      narrative_angle: "event",
      fact_count: 3,
    });
    const filename = await saveArticle(article, pendingDir);
    const raw = fs.readFileSync(path.join(pendingDir, filename), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.title).toBe("测试文章");
    expect(parsed.topics).toEqual(["AI", "科技"]);
    expect(parsed.fact_count).toBe(3);
  });
});

describe("loadPendingArticles", () => {
  const pendingDir = path.join(TEST_DIR, "load-pending");

  beforeEach(() => {
    fs.mkdirSync(pendingDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns empty array when directory does not exist", async () => {
    const articles = await loadPendingArticles(
      path.join(TEST_DIR, "nonexistent")
    );
    expect(articles).toEqual([]);
  });

  it("returns articles sorted by filename", async () => {
    const article = makeArticle();
    await saveArticle(article, pendingDir); // -> index 001
    await saveArticle(article, pendingDir); // -> index 002

    const articles = await loadPendingArticles(pendingDir);
    expect(articles).toHaveLength(2);
    expect(articles[0].filename).toMatch(/-001-/);
    expect(articles[1].filename).toMatch(/-002-/);
  });

  it("reads and parses all JSON files in the pending dir", async () => {
    await saveArticle(makeArticle({ title: "Alpha" }), pendingDir);
    await saveArticle(makeArticle({ title: "Beta" }), pendingDir);

    const articles = await loadPendingArticles(pendingDir);
    expect(articles).toHaveLength(2);
    const titles = articles.map((a) => a.article.title).sort();
    expect(titles).toEqual(["Alpha", "Beta"]);
  });
});

describe("archiveArticle", () => {
  const pendingDir = path.join(TEST_DIR, "archive-pending");
  const publishedDir = path.join(TEST_DIR, "archive-published");

  beforeEach(() => {
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.mkdirSync(publishedDir, { recursive: true });
    renameMock.mockClear();
    copyMock.mockClear();
    unlinkMock.mockClear();
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("moves file from pending to published", async () => {
    const article = makeArticle();
    const filename = await saveArticle(article, pendingDir);

    expect(fs.existsSync(path.join(pendingDir, filename))).toBe(true);
    expect(fs.existsSync(path.join(publishedDir, filename))).toBe(false);

    await archiveArticle(filename, pendingDir, publishedDir);

    expect(fs.existsSync(path.join(pendingDir, filename))).toBe(false);
    expect(fs.existsSync(path.join(publishedDir, filename))).toBe(true);
  });

  it("preserves file content after archiving", async () => {
    const article = makeArticle();
    const filename = await saveArticle(article, pendingDir);
    await archiveArticle(filename, pendingDir, publishedDir);

    const content = fs.readFileSync(
      path.join(publishedDir, filename),
      "utf-8"
    );
    const parsed = JSON.parse(content);
    expect(parsed.title).toBe(article.title);
  });

  it("creates published directory if it does not exist", async () => {
    const article = makeArticle();
    const filename = await saveArticle(article, pendingDir);
    const newPubDir = path.join(TEST_DIR, "new-pub");

    await archiveArticle(filename, pendingDir, newPubDir);
    expect(fs.existsSync(path.join(newPubDir, filename))).toBe(true);
  });

  it("falls back to copy + unlink when renameSync throws EXDEV", async () => {
    const article = makeArticle();
    const filename = await saveArticle(article, pendingDir);

    // Make renameSync throw EXDEV on next call
    renameMock.mockImplementationOnce(() => {
      const err: NodeJS.ErrnoException = new Error(
        "cross-device link"
      ) as any;
      err.code = "EXDEV";
      throw err;
    });

    await archiveArticle(filename, pendingDir, publishedDir);

    // rename was called (and failed), fell back to copy+unlink
    expect(renameMock).toHaveBeenCalledTimes(1);
    expect(copyMock).toHaveBeenCalledWith(
      path.join(pendingDir, filename),
      path.join(publishedDir, filename)
    );
    expect(unlinkMock).toHaveBeenCalledWith(path.join(pendingDir, filename));

    // file ended up in published
    expect(fs.existsSync(path.join(publishedDir, filename))).toBe(true);
    expect(fs.existsSync(path.join(pendingDir, filename))).toBe(false);
  });
});

describe("getPublishedSourceUrls", () => {
  const publishedDir = path.join(TEST_DIR, "pub-urls");

  beforeEach(() => {
    fs.mkdirSync(publishedDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns empty set when directory does not exist", async () => {
    const urls = await getPublishedSourceUrls(
      path.join(TEST_DIR, "nonexistent")
    );
    expect(urls.size).toBe(0);
  });

  it("collects source_url values from all published articles", async () => {
    const a1 = makeArticle({ source_url: "https://x.com/1" });
    const a2 = makeArticle({ source_url: "https://x.com/2" });

    const f1 = buildFilename(a1, 1);
    const f2 = buildFilename(a2, 2);
    fs.writeFileSync(
      path.join(publishedDir, f1),
      JSON.stringify(a1, null, 2),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(publishedDir, f2),
      JSON.stringify(a2, null, 2),
      "utf-8"
    );

    const urls = await getPublishedSourceUrls(publishedDir);
    expect(urls.size).toBe(2);
    expect(urls.has("https://x.com/1")).toBe(true);
    expect(urls.has("https://x.com/2")).toBe(true);
  });

  it("deduplicates identical source_url values", async () => {
    const article = makeArticle({ source_url: "https://x.com/dup" });
    const f1 = buildFilename(article, 1);
    const f2 = buildFilename(
      { ...article, title: "DupArticle" },
      2
    );
    fs.writeFileSync(
      path.join(publishedDir, f1),
      JSON.stringify(article, null, 2),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(publishedDir, f2),
      JSON.stringify(
        { ...article, title: "DupArticle" },
        null,
        2
      ),
      "utf-8"
    );

    const urls = await getPublishedSourceUrls(publishedDir);
    expect(urls.size).toBe(1);
    expect(urls.has("https://x.com/dup")).toBe(true);
  });

  it("normalizes toutiao URLs for consistent dedup", async () => {
    const a1 = makeArticle({ source_url: "https://www.toutiao.com/article/123456/" });
    const a2 = makeArticle({ source_url: "https://www.toutiao.com/trending/789/" });
    const a3 = makeArticle({ source_url: "https://www.toutiao.com/a/999/" });
    const a4 = makeArticle({ source_url: "https://www.toutiao.com/article/123456/?query=param" });

    const f1 = buildFilename(a1, 1);
    const f2 = buildFilename(a2, 2);
    const f3 = buildFilename(a3, 3);
    const f4 = buildFilename(a4, 4);
    fs.writeFileSync(path.join(publishedDir, f1), JSON.stringify(a1, null, 2), "utf-8");
    fs.writeFileSync(path.join(publishedDir, f2), JSON.stringify(a2, null, 2), "utf-8");
    fs.writeFileSync(path.join(publishedDir, f3), JSON.stringify(a3, null, 2), "utf-8");
    fs.writeFileSync(path.join(publishedDir, f4), JSON.stringify(a4, null, 2), "utf-8");

    const urls = await getPublishedSourceUrls(publishedDir);
    // a1 and a4 normalize to the same path ("article/123456"), so we expect only 3 unique values
    expect(urls.size).toBe(3);
    expect(urls.has("article/123456")).toBe(true);
    expect(urls.has("trending/789")).toBe(true);
    expect(urls.has("a/999")).toBe(true);
  });
});
