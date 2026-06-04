import { describe, it, expect } from "vitest";
import { filterHotItems } from "../src/batch-generate.js";
import { normalizeSourceUrl } from "../src/article-store.js";
import type { HotItem } from "../src/trend.js";

describe("normalizeSourceUrl", () => {
  it("extracts article ID from toutiao URLs", () => {
    expect(normalizeSourceUrl("https://www.toutiao.com/article/123456/"))
      .toBe("article/123456");
  });

  it("extracts trending ID", () => {
    expect(normalizeSourceUrl("https://www.toutiao.com/trending/999888/"))
      .toBe("trending/999888");
  });

  it("returns URL unchanged if no pattern matches", () => {
    expect(normalizeSourceUrl("https://example.com/news/123"))
      .toBe("https://example.com/news/123");
  });

  it("strips query parameters", () => {
    expect(normalizeSourceUrl("https://www.toutiao.com/article/123456/?hot_board_impr_id=abc"))
      .toBe("article/123456");
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
