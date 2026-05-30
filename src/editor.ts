import { Page } from "playwright";
import { CONFIG, SELECTORS } from "./config.js";

export async function typeTitle(
  page: Page,
  title: string
): Promise<void> {
  const input = page.locator(SELECTORS.TITLE_INPUT);
  await input.waitFor({ state: "visible", timeout: CONFIG.DEFAULT_TIMEOUT });
  await input.click();
  await input.fill(title);
  console.log(`标题输入完成: ${title}`);
}

export async function insertContent(
  page: Page,
  html: string
): Promise<void> {
  const editor = page.locator(SELECTORS.EDITOR);
  await editor.waitFor({ state: "visible", timeout: CONFIG.DEFAULT_TIMEOUT });
  await editor.click();

  await editor.evaluate((el, htmlContent) => {
    el.innerHTML = htmlContent;

    el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    el.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));

    el.dispatchEvent(new Event("blur", { bubbles: true }));
    el.dispatchEvent(new Event("focus", { bubbles: true }));
  }, html);

  const length = await editor.evaluate((el) => el.textContent?.length ?? 0);
  console.log(`正文注入完成，共 ${length} 字`);
}
