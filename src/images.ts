import { Page } from "playwright";
import { CONFIG } from "./config.js";

export async function insertAIImage(
  page: Page,
  keyword: string
): Promise<void> {
  console.log("正在打开 AI 创作助手...");

  const aiBtn = page.locator("button, span", { hasText: "AI" }).first();
  await aiBtn.waitFor({ state: "visible", timeout: CONFIG.DEFAULT_TIMEOUT });
  await aiBtn.click();

  // Wait for AI panel to render
  await page.waitForTimeout(3000);

  // Type keyword into AI input
  // NOTE: .last() is a best-effort approach - the real selector depends on Toutiao's actual DOM
  const aiInput = page.locator("input, textarea").last();
  await aiInput.fill(keyword);
  console.log(`AI 关键词输入: ${keyword}`);

  // Wait for recommendations
  await page.waitForTimeout(5000);

  // Click first recommended image - try targeted selectors first
  try {
    await page.locator(".ai-panel img, [class*=\"image-list\"] img, .recommend-item img").first().click({ timeout: 10000 });
  } catch {
    try {
      await page.locator("img").first().click({ timeout: 5000 });
    } catch {
      console.log("未找到 AI 推荐图片，跳过");
    }
  }
  console.log("已插入 AI 推荐图片");
}

export async function setCover(
  page: Page,
  keyword: string
): Promise<void> {
  console.log("正在设置封面图片...");

  // Click cover area
  const coverArea = page.locator("text=封面").first();
  await coverArea.scrollIntoViewIfNeeded();
  await coverArea.click();
  await page.waitForTimeout(1000);

  // Click "免费正版图片"
  const freeStockBtn = page.locator("text=免费正版图片").first();
  await freeStockBtn.waitFor({ state: "visible", timeout: CONFIG.DEFAULT_TIMEOUT });
  await freeStockBtn.click();
  await page.waitForTimeout(2000);

  // Search
  const searchInput = page.locator("input[placeholder*=\"搜索\"]").first();
  await searchInput.fill(keyword);
  await page.waitForTimeout(3000);

  // Select first image - try targeted selectors first
  try {
    await page.locator(".stock-panel img, [class*=\"image\"] img, .search-result img").first().click({ timeout: 10000 });
  } catch {
    await page.locator("img").first().click({ timeout: 5000 });
  }
  await page.waitForTimeout(1000);

  // Confirm
  const confirmBtn = page.locator("button", { hasText: "确定" }).first();
  await confirmBtn.click();
  await page.waitForTimeout(3000);
  console.log("封面设置完成");
}
