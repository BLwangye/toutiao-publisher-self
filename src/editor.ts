import { Page } from "playwright";
import { CONFIG, SELECTORS } from "./config.js";
import * as fs from "fs";

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

export async function pasteImage(page: Page, imagePath: string): Promise<void> {
  const buffer = fs.readFileSync(imagePath);
  const base64 = buffer.toString("base64");
  const ext = imagePath.split(".").pop()?.toLowerCase() ?? "png";
  const mimeMap: Record<string, string> = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
  };
  const mime = mimeMap[ext] ?? "image/png";
  const dataUri = `data:${mime};base64,${base64}`;

  await page.evaluate((uri) => {
    const editor = document.querySelector(".ProseMirror");
    if (!editor) throw new Error("Editor not found");

    (editor as HTMLElement).focus();

    const dt = new DataTransfer();
    dt.setData("text/html", `<img src="${uri}" />`);

    const event = new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });

    editor.dispatchEvent(event);
  }, dataUri);

  const imgCount = await page.evaluate(() => {
    return document.querySelector(".ProseMirror")?.querySelectorAll("img").length ?? 0;
  });
  console.log(`图片已粘贴到正文 (共 ${imgCount} 张)`);
}
