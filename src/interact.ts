import { Page } from "playwright";
import { searchHotItems } from "./trend.js";

// Simple comment templates with random variation
const commentTemplates = [
  "写得很到位，分析透彻！",
  "深度好文，收藏了慢慢看",
  "说得太对了，很有道理",
  "这个观点很新颖，学习了",
  "干货满满，值得反复读",
  "确实如此，说到心坎里了",
  "文章质量很高，关注了",
  "总结得很全面，受益匪浅",
  "有深度有思考，难得的好文",
  "角度独特，打开了新思路",
  "逻辑清晰，论证有力",
  "每次看都有新收获",
];

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateComment(): string {
  return pick(commentTemplates);
}

async function delay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min) + min);
  await new Promise(r => setTimeout(r, ms));
}

export async function interactArticles(page: Page, count: number = 5): Promise<void> {
  console.log(`正在获取热榜文章列表...`);

  // Get article URLs from 糖果梦 API
  const hotItems = await searchHotItems({ keywords: [], limit: 30 });
  let articles = hotItems.filter(i => i.url && i.url.includes("toutiao.com"));

  // Fallback: use old platform API for Toutiao-specific articles
  if (articles.length === 0) {
    console.log("  切换旧版热榜接口获取头条文章...");
    const resp = await fetch("https://trendapi.tgmeng.com/api/topsearch/toutiao", {
      headers: { "x-api-key": "test" },
      signal: AbortSignal.timeout(10000),
    });
    const data = await resp.json() as any;
    const items = data?.data?.dataInfo ?? [];
    articles = items
      .filter((i: any) => i.url && i.url.includes("toutiao.com") && !i.url.includes("/trending/"))
      .map((i: any) => ({
        title: i.title ?? "",
        url: i.url ?? "",
        source: "头条热榜",
        category: "", rootCategory: "", publishedAt: "", rank: 0,
      } as any));
  }

  if (articles.length === 0) {
    console.log("未获取到文章，使用头条首页备用方案");
    return interactFromHome(page, count);
  }

  // Shuffle and pick
  const selected = articles.sort(() => Math.random() - 0.5).slice(0, count);
  console.log(`从热榜获取 ${articles.length} 篇文章，随机选 ${count} 篇\n`);

  let successCount = 0;
  for (let i = 0; i < selected.length; i++) {
    const article = selected[i];
    try {
      console.log(`--- 第 ${i + 1}/${count} 篇 ---`);
      console.log(`  ${article.title.substring(0, 40)}`);
      console.log(`  📄 ${article.url}`);
      console.log(`  来源: ${article.source}`);

      await page.goto(article.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(8000);

      // 1. Follow author
      const followBtn = page.locator("button", { hasText: "关注" }).first();
      if (await followBtn.count() > 0) {
        const btnText = await followBtn.innerText().catch(() => "");
        if (btnText.includes("关注") && !btnText.includes("已关注")) {
          await followBtn.click();
          await delay(1500, 2500);
          console.log("  ✅ 关注");
        } else {
          console.log("  ⏭ 已关注");
        }
      } else {
        console.log("  ⚠ 未找到关注按钮");
      }

      // 2. Like article
      const likeBtn = page.locator("[class*=\"digg\"], [class*=\"like\"], [class*=\"support\"]").first();
      if (await likeBtn.count() > 0) {
        await likeBtn.click();
        await delay(1000, 2000);
        console.log("  ✅ 点赞");
      } else {
        console.log("  ⚠ 未找到点赞按钮");
      }

      // 3. Comment
      const commentInput = page.locator(".ttp-comment-input").first();
      if (await commentInput.count() > 0) {
        await commentInput.scrollIntoViewIfNeeded();
        await commentInput.click();
        await page.waitForTimeout(1500);

        const editor = page.locator(".comment-textarea").first();
        if (await editor.count() > 0) {
          const comment = generateComment();
          await editor.click();
          await editor.fill(comment);
          await page.waitForTimeout(1000);

          // Submit - the button class has "disable" but it's actually enabled after typing
          const submitBtn = page.locator("button.submit-btn").first();
          if (await submitBtn.count() > 0) {
            await submitBtn.click({ force: true });
            await delay(3000, 5000);
            console.log(`  ✅ 评论: "${comment}"`);
          }
        }
      } else {
        console.log("  ⚠ 未找到评论输入框");
      }

      successCount++;

      // Random delay before next
      const waitTime = Math.floor(Math.random() * 60000 + 30000);
      console.log(`  等待 ${Math.round(waitTime/1000)}s...`);
      await new Promise(r => setTimeout(r, waitTime));

    } catch (err: any) {
      console.error(`  ❌ 失败: ${err.message?.substring(0, 60)}`);
    }
  }

  console.log(`\n互动完成: ${successCount}/${count} 成功`);
}

async function interactFromHome(page: Page, count: number): Promise<void> {
  await page.goto("https://www.toutiao.com/", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(5000);

  let successCount = 0;
  for (let i = 0; i < count; i++) {
    try {
      console.log(`\n--- 第 ${i + 1}/${count} 篇 ---`);

      const links = page.locator("a[href*=\"/article/\"]");
      const linkCount = await links.count();
      const idx = i % linkCount;
      const link = links.nth(idx);
      const href = await link.getAttribute("href") ?? "";
      
      console.log(`  📄 ${href}`);

      // Navigate directly
      if (href) {
        await page.goto(href, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(8000);

        const followBtn = page.locator("button", { hasText: "关注" }).first();
        if (await followBtn.count() > 0) {
          const t = await followBtn.innerText().catch(() => "");
          if (t.includes("关注") && !t.includes("已关注")) { await followBtn.click(); }
        }
        console.log("  ✅ 关注");

        const likeBtn = page.locator("[class*=\"digg\"], [class*=\"like\"]").first();
        if (await likeBtn.count() > 0) { await likeBtn.click(); }
        console.log("  ✅ 点赞");

        successCount++;
      }
    } catch (err: any) {
      console.error(`  ❌: ${err.message?.substring(0, 40)}`);
    }
    await new Promise(r => setTimeout(r, 30000 + Math.random() * 30000));
  }
  console.log(`\n互动完成: ${successCount}/${count}`);
}
