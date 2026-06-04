import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { saveArticle, loadPendingArticles, archiveArticle, getPublishedSourceUrls, PendingArticle, normalizeSourceUrl } from "../src/article-store.js";
import { scanPendingFiles } from "../src/batch-publish.js";
import { filterHotItems } from "../src/batch-generate.js";
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
    expect(urls.has("article/111")).toBe(true);
  });

  it("dedup works across the full pipeline", async () => {
    // Publish one article first (simulate a prior successful publish)
    const published: PendingArticle = {
      title: "已发布文章",
      content: "<p>内容</p>",
      category: "社会",
      topics: [],
      source_url: "https://www.toutiao.com/article/123456/",
      narrative_angle: "event",
      fact_count: 2,
      generated_at: new Date().toISOString(),
    };
    await saveArticle(published, PENDING);
    const pendingFiles = await scanPendingFiles(PENDING);
    await archiveArticle(pendingFiles[0], PENDING, PUBLISHED);

    // Now check dedup
    const publishedUrls = await getPublishedSourceUrls(PUBLISHED);
    expect(publishedUrls.size).toBe(1);
    // Should be normalized
    expect(publishedUrls.has("article/123456")).toBe(true);

    const hotItems: HotItem[] = [
      { title: "已存在的文章", url: "https://www.toutiao.com/article/123456/", source: "头条热榜", category: "", rootCategory: "", publishedAt: "", rank: 1 },
      { title: "新文章", url: "https://www.toutiao.com/article/new-one/", source: "头条热榜", category: "", rootCategory: "", publishedAt: "", rank: 2 },
    ];

    const filtered = filterHotItems(hotItems, publishedUrls);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].url).toBe("https://www.toutiao.com/article/new-one/");
  });
});
