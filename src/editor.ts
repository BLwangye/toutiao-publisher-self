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
  await page.waitForTimeout(300);

  // Select all existing content and replace via clipboard paste
  // This goes through ProseMirror's paste handler which preserves <strong>, emoji, etc.
  await page.evaluate(() => {
    const pm = document.querySelector(".ProseMirror");
    if (!pm) return;
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(pm);
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.waitForTimeout(200);

  // Paste the formatted HTML through clipboard
  await page.evaluate((htmlContent) => {
    const editor = document.querySelector(".ProseMirror");
    if (!editor) return;

    (editor as HTMLElement).focus();

    const dt = new DataTransfer();
    dt.setData("text/html", htmlContent);

    const event = new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });

    editor.dispatchEvent(event);
  }, html);

  await page.waitForTimeout(500);

  // Dispatch input event to register changes
  await editor.evaluate((el) => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });

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

function imageToDataUri(imagePath: string): string {
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
  return `data:${mime};base64,${base64}`;
}

export async function pasteImagesAtH2s(page: Page, imagePaths: string[]): Promise<void> {
  const uris = imagePaths.map(imageToDataUri);

  await page.evaluate((dataUris) => {
    const editor = document.querySelector(".ProseMirror");
    if (!editor) throw new Error("Editor not found");

    const h2s = editor.querySelectorAll("h2");
    const count = Math.min(h2s.length, dataUris.length);

    for (let i = 0; i < count; i++) {
      const h2 = h2s[i];
      const imgSrc = dataUris[i];

      const imgWrapper = document.createElement("div");
      imgWrapper.innerHTML = `<img src="${imgSrc}" />`;
      const img = imgWrapper.firstElementChild!;

      h2.after(img);

      const dt = new DataTransfer();
      dt.setData("text/html", imgWrapper.innerHTML);
      const event = new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      editor.dispatchEvent(event);
    }
  }, uris);

  await page.evaluate(() => {
    const editor = document.querySelector(".ProseMirror");
    editor?.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    editor?.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    editor?.dispatchEvent(new Event("blur", { bubbles: true }));
    editor?.dispatchEvent(new Event("focus", { bubbles: true }));
  });

  const imgCount = await page.evaluate(() => {
    return document.querySelector(".ProseMirror")?.querySelectorAll("img").length ?? 0;
  });
  console.log(`${imagePaths.length} 张图片已插入正文 (共 ${imgCount} 张)`);
}

export async function insertTopics(page: Page, topics: string[]): Promise<number> {
  if (topics.length === 0) return 0;

  const editor = page.locator(SELECTORS.EDITOR);

  // Focus editor and ensure ProseMirror is in input mode
  await editor.click();
  await page.waitForTimeout(500);

  // Move cursor to very end of content
  await page.evaluate(() => {
    const pm = document.querySelector(".ProseMirror");
    if (!pm) return;
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(pm);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.waitForTimeout(300);

  let inserted = 0;
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];

    // New paragraph before first topic
    if (i === 0) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);
    }

    // Type # to trigger topic autocomplete, then the topic name
    await page.keyboard.press("#");
    await page.waitForTimeout(300);
    await page.keyboard.type(topic, { delay: 50 });
    await page.waitForTimeout(2000);

    // Look for the mention selector popup
    const popup = page.locator(".mention-selector-modal").first();
    try {
      await popup.waitFor({ state: "visible", timeout: 3000 });

      // Click the first matching topic item
      const firstItem = popup.locator(".forum-list-item").first();
      await firstItem.waitFor({ state: "visible", timeout: 2000 });
      await firstItem.click();
      await page.waitForTimeout(800);
      inserted++;
      console.log(`  话题已选中: #${topic}`);
    } catch {
      // If popup didn't appear, try pressing Enter as fallback
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      console.log(`  话题弹窗未出现, 保留文本: #${topic}`);
    }

    // Space to separate topics
    if (i < topics.length - 1) {
      await page.keyboard.press("Space");
      await page.waitForTimeout(300);
    }
  }

  // Dispatch input event
  await editor.evaluate((el) => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(300);

  console.log(`话题插入完成: ${inserted}/${topics.length} 个选中`);
  return inserted;
}
