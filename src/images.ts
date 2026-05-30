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

  // Wait for AI panel to load
  const aiPanel = page.locator(".ai-panel, [class*=\"ai\"], [class*=\"AI\"]").first();
  try {
    await aiPanel.waitFor({ state: "visible", timeout: CONFIG.AI_LOAD_TIMEOUT });
  } catch {
    console.log("AI 面板可能已打开，继续...");
  }
  await page.waitForTimeout(3000);

  // Type keyword into AI input
  const aiInput = page.locator("input, textarea").last();
  await aiInput.fill(keyword);
  console.log(`AI 关键词输入: ${keyword}`);

  // Wait for recommendations
  await page.waitForTimeout(5000);

  // Click first recommended image
  const recommendedImage = page.locator("img").first();
  try {
    await recommendedImage.click({ timeout: 10000 });
    console.log("已插入 AI 推荐图片");
  } catch {
    console.log("未找到 AI 推荐图片，跳过");
  }
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

  // Select first image
  const firstImage = page.locator("img").first();
  await firstImage.click({ timeout: 10000 });
  await page.waitForTimeout(1000);

  // Confirm
  const confirmBtn = page.locator("button", { hasText: "确定" }).first();
  await confirmBtn.click();
  await page.waitForTimeout(3000);
  console.log("封面设置完成");
}
