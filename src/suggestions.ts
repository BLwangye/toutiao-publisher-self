import type { Page } from "playwright";

export interface SuggestionResult {
  imageCount: number;
}

// Trigger 内容建议 re-detection and return how many images are available.
export async function detectSuggestions(page: Page): Promise<SuggestionResult> {
  console.log("正在获取头条内容建议...");

  // 1. Click 内容建议 tab
  const tab = page.locator('.byte-tabs-header-title:has-text("内容建议")').first();
  try {
    await tab.click({ timeout: 5000 });
    await page.waitForTimeout(500);
  } catch {
    console.log("  未找到内容建议 tab");
    return { imageCount: 0 };
  }

  // 2. Click 重新检测
  const recheck = page.locator('a.btn:has-text("重新检测")').first();
  try {
    await recheck.click({ timeout: 5000 });
    console.log("  已点击重新检测...");
  } catch {
    console.log("  未找到重新检测按钮");
    return { imageCount: 0 };
  }

  await page.waitForTimeout(10000);

  // 3. Count available suggestion images
  const imageCount: number = await page.evaluate(() => {
    const panel = document.querySelector('.publish-assistant-panel, .ai-assistant-panel');
    if (!panel) return 0;
    const allEls = panel.querySelectorAll('*');
    let count = 0;
    for (const el of allEls) {
      try {
        const bg = window.getComputedStyle(el).backgroundImage || '';
        if (bg && bg.includes('tuchong')) count++;
      } catch {}
    }
    return count;
  });

  console.log(`  获取到 ${imageCount} 张推荐配图`);
  return { imageCount };
}

// Click the Nth suggested image in the 内容建议 panel.
// This inserts the image at the current cursor position in the editor.
export async function clickSuggestionImage(page: Page, index: number): Promise<boolean> {
  try {
    // Find all elements with tuchong background images
    const els = page.locator('[style*="tuchong"]').filter({ has: page.locator('..') });
    const count = await els.count();
    if (count <= index) return false;

    await els.nth(index).click({ timeout: 5000 });
    await page.waitForTimeout(1000);
    return true;
  } catch {
    return false;
  }
}
