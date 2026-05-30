import { Page } from "playwright";
import { CONFIG, SELECTORS, VERIFY_URL_PATTERNS } from "./config.js";

export async function setDeclarations(page: Page): Promise<void> {
  await page.evaluate(() => {
    const checkboxes = document.querySelectorAll<HTMLElement>('[role="checkbox"]');

    for (const el of checkboxes) {
      if (el.textContent?.includes("头条首发")) {
        el.click();
      }
      if (el.textContent?.includes("引用 AI")) {
        el.click();
      }
    }

    const allElements = document.querySelectorAll<HTMLElement>("*");
    for (const el of allElements) {
      if (el.textContent?.includes("个人观点") && el.getAttribute("role") === "radio") {
        el.click();
        break;
      }
    }
  });

  console.log("声明设置完成");
}

export async function clickPublish(page: Page): Promise<void> {
  console.log("点击发布...");

  // Click "预览并发布"
  await page.evaluate((btnText) => {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>("button, a, span, div"));
    const btn = buttons.find(
      (b) => b.textContent?.includes(btnText) && b.offsetParent !== null
    );
    if (btn) {
      btn.scrollIntoView();
      btn.click();
      return true;
    }
    return false;
  }, SELECTORS.PUBLISH_BTN);

  // Wait for preview to load
  await page.waitForTimeout(3000);

  // Click "确认发布"
  await page.evaluate((btnText) => {
    const buttons = Array.from(
      document.querySelectorAll<HTMLElement>("button, a, span, div")
    );
    const btn = buttons.find(
      (b) =>
        (b.textContent?.includes(btnText) || b.textContent?.includes("立即发布")) &&
        b.offsetParent !== null
    );
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }, SELECTORS.CONFIRM_BTN);

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
    await clickPublish(page);
    const ok = await verifyPublish(page);
    if (ok) return true;

    console.log(`发布验证失败，重试 ${i + 1}/${retries}...`);
    await page.waitForTimeout(CONFIG.PUBLISH_RETRY_INTERVAL);
  }
  return false;
}
