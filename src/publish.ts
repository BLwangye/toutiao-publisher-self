import { Page } from "playwright";
import { CONFIG, SELECTORS, VERIFY_URL_PATTERNS } from "./config.js";

export async function setDeclarations(page: Page): Promise<void> {
  await page.evaluate(({ toutiaoFirst, citeAI, personalView }) => {
    const checkboxes = document.querySelectorAll<HTMLElement>('[role="checkbox"]');

    for (const el of checkboxes) {
      if (el.textContent?.includes(toutiaoFirst)) {
        el.click();
      }
      if (el.textContent?.includes(citeAI)) {
        el.click();
      }
    }

    const radioElements = document.querySelectorAll<HTMLElement>('[role="radio"]');
    for (const el of radioElements) {
      if (el.textContent?.includes(personalView)) {
        el.click();
        break;
      }
    }
  }, {
    toutiaoFirst: SELECTORS.DECLARATION_TOUTIAO_FIRST,
    citeAI: SELECTORS.DECLARATION_CITE_AI,
    personalView: SELECTORS.DECLARATION_PERSONAL_VIEW,
  });

  console.log("声明设置完成");
}

export async function clickPublish(page: Page): Promise<void> {
  console.log("点击发布...");

  // Click "预览并发布" using Playwright locator
  const previewBtn = page.locator("button", { hasText: "预览并发布" }).first();
  await previewBtn.waitFor({ state: "visible", timeout: CONFIG.DEFAULT_TIMEOUT });
  await previewBtn.scrollIntoViewIfNeeded();
  await previewBtn.click();
  console.log("已点击预览并发布");

  // Wait for preview to load
  await page.waitForTimeout(3000);

  // Click "确认发布"
  const confirmBtn = page.locator("button", { hasText: /确认发布|立即发布/ }).first();
  await confirmBtn.waitFor({ state: "visible", timeout: CONFIG.DEFAULT_TIMEOUT });
  await confirmBtn.scrollIntoViewIfNeeded();
  await confirmBtn.click();

  console.log("已确认发布");
}

export async function verifyPublish(page: Page): Promise<boolean> {
  await page.waitForTimeout(5000);

  const result = await page.evaluate((patterns) => {
    const url = window.location.href;
    for (const pattern of patterns) {
      if (url.includes(pattern)) return true;
    }
    return false;
  }, VERIFY_URL_PATTERNS as readonly string[]);

  if (result) {
    console.log("发布成功！当前 URL:", page.url());
  } else {
    console.error("发布验证失败，当前 URL:", page.url());
  }

  return result;
}

export async function publishArticle(
  page: Page,
  retries: number = CONFIG.PUBLISH_RETRY
): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      await clickPublish(page);
      const ok = await verifyPublish(page);
      if (ok) return true;

      console.log(`发布验证失败，尝试 ${i + 1}/${retries}...`);
      await page.waitForTimeout(CONFIG.PUBLISH_RETRY_INTERVAL);
    } catch (err) {
      console.error(`尝试 ${i + 1}/${retries} 失败:`, err);
    }
  }
  return false;
}
