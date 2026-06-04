import { chromium, Browser, Page } from "playwright";
import { fetchToutiaoItems, HotItem } from "./trend.js";
import {
  scrapeArticle, extractFactsViaDeepSeek, rewriteViaDeepSeek,
  validateFacts, fixDiscrepancies, withRetry,
  NarrativeAngle, randomAngle,
} from "./rewrite.js";
import { generateTopicsViaDeepSeek } from "./topics.js";
import { detectCategory } from "./category.js";
import { saveArticle, getPublishedSourceUrls, PendingArticle } from "./article-store.js";

/** Normalize a source URL for dedup — extract stable ID. */
export function normalizeSourceUrl(url: string): string {
  const m = url.match(/toutiao\.com\/(trending|article|a)\/(\d+)/);
  if (m) return `${m[1]}/${m[2]}`;
  return url;
}

/** Filter and dedup hot items against already-published URLs. Sorted by rank. */
export function filterHotItems(
  items: HotItem[],
  publishedUrls: Set<string>
): HotItem[] {
  const seen = new Set<string>();
  const result: HotItem[] = [];
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
        // Scrape
        const source = await withRetry(() => scrapeArticle(page!, item.url), 2);
        const text = source.content.substring(0, 4000);

        if (noLLM) {
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

        // Extract facts
        const facts = await extractFactsViaDeepSeek(text, source.title);
        console.log(`  提取 ${facts.length} 条事实`);

        // Select random narrative angle
        const angle = randomAngle();
        console.log(`  叙事角度: ${angle}`);

        // Rewrite
        const rewritten = await rewriteViaDeepSeek(source.title, text, facts, angle);
        if (!rewritten) {
          console.log(`  ⚠ 改写返回空，丢弃`);
          discarded++;
          continue;
        }

        // Validate
        const diff = validateFacts(rewritten, facts);
        if (diff.missing.length > 0 || diff.altered.length > 0) {
          try {
            const fixed = await fixDiscrepancies(rewritten, facts, diff);
            const diff2 = validateFacts(fixed, facts);
            const blockingMissing = diff2.missing.filter(f => f.type !== "event");
            if (blockingMissing.length > 0 || diff2.altered.length > 0) {
              console.log(`  🔴 事实校验二次失败，丢弃`);
              discarded++;
              continue;
            }
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

        // Build and save
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
  // Extract title from first h2 or first 30 chars of text
  let title = "";
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

  const cat = detectCategory(title, content) ?? "社会";

  return {
    title,
    content,
    category: cat,
    topics: topics.slice(0, 5),
    source_url: sourceUrl,
    narrative_angle: angle,
    fact_count: factCount,
    generated_at: new Date().toISOString(),
  };
}
