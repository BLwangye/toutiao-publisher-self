import type { Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { loadPendingArticles, archiveArticle, PendingArticle } from "./article-store.js";
import { typeTitle, insertContent, insertTopics } from "./editor.js";
import { setDeclarations, publishArticle } from "./publish.js";
import { formatTitle } from "./category.js";
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
      if (article.topics && article.topics.length > 0) {
        try {
          await insertTopics(page, article.topics.slice(0, 5));
        } catch (err) {
          console.log(`  ⚠ 话题插入失败: ${(err as Error).message.substring(0, 60)}`);
        }
      }

      // Cover — default to no cover for automated publishing
      try {
        const noCoverLabel = page.locator("label", { hasText: "无封面" }).first();
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
    if (i < files.length - 1 && succeeded + failed < files.length) {
      const waitMs = options.intervalMinutes * 60 * 1000;
      console.log(`  等待 ${options.intervalMinutes} 分钟...`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  console.log(`\n=== 批量发布完成: ✅ ${succeeded} ❌ ${failed} ===`);
  return { succeeded, failed, failedFiles };
}
