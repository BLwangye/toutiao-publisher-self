import { Page } from "playwright";

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
  console.log(`开始互动，目标: ${count} 篇文章\n`);

  // Go to Toutiao home
  await page.goto("https://www.toutiao.com/", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(5000);

  let successCount = 0;
  const maxAttempts = count * 2;
  let attempts = 0;

  while (successCount < count && attempts < maxAttempts) {
    attempts++;
    try {
      console.log(`\n--- 第 ${successCount + 1}/${count} 篇 ---`);

      // Find and click a news article link
      const links = page.locator("a[href*=\"/item/\"], a[href*=\"/article/\"]");
      const linkCount = await links.count();
      if (linkCount === 0) {
        console.log("  未找到文章链接，刷新重试...");
        await page.reload();
        await page.waitForTimeout(5000);
        continue;
      }

      // Pick a random article
      const idx = Math.floor(Math.random() * Math.min(linkCount, 10));
      const link = links.nth(idx);
      const href = await link.getAttribute("href") ?? "";
      const titlePreview = (await link.innerText().catch(() => "未知标题")).substring(0, 30);
      console.log(`  ${titlePreview}`);

      // Open article in new tab
      const [articlePage] = await Promise.all([
        page.context().waitForEvent("page"),
        link.click(),
      ]);
      await articlePage.waitForTimeout(8000);

      try {
        // 1. Follow author
        const followBtn = articlePage.locator("button", { hasText: "关注" }).first();
        if (await followBtn.count() > 0) {
          const btnText = await followBtn.innerText().catch(() => "");
          if (btnText.includes("关注") && !btnText.includes("已关注")) {
            await followBtn.click();
            await delay(1000, 2000);
            console.log("  ✅ 关注");
          } else {
            console.log("  ⏭ 已关注,跳过");
          }
        }

        // 2. Like article (try multiple selectors)
        const likeBtn = articlePage.locator("[class*=\"digg\"], [class*=\"like\"], [class*=\"support\"]").first();
        if (await likeBtn.count() > 0) {
          await likeBtn.click();
          await delay(1000, 2000);
          console.log("  ✅ 点赞");
        } else {
          console.log("  ⚠ 未找到点赞按钮");
        }

        // 3. Comment
        const commentArea = articlePage.locator("[class*=\"comment-input\"], [class*=\"comment-textarea\"]").first();
        if (await commentArea.count() > 0) {
          await commentArea.click();
          await articlePage.waitForTimeout(1000);

          const editor = articlePage.locator("[contenteditable=\"true\"], .comment-textarea, textarea").first();
          if (await editor.count() > 0) {
            const comment = generateComment();
            await editor.fill(comment);
            await articlePage.waitForTimeout(500);

            // Click submit
            const submitBtn = articlePage.locator("button.submit-btn, [class*=\"submit\"]").first();
            if (await submitBtn.count() > 0) {
              await submitBtn.click();
              await delay(2000, 4000);
              console.log(`  ✅ 评论: "${comment}"`);
            }
          }
        } else {
          console.log("  ⚠ 未找到评论输入框");
        }

        successCount++;
      } finally {
        await articlePage.close();
      }

      // Back to home
      await delay(30000, 60000);

    } catch (err: any) {
      console.error(`  ❌ 失败: ${err.message?.substring(0, 50)}`);
    }
  }

  console.log(`\n互动完成: ${successCount}/${count} 成功`);
}
