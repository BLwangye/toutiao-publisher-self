import type { Page } from "playwright";
import { CONFIG } from "./config.js";

export async function setCoverFile(page: Page, imagePath: string): Promise<void> {
  console.log("上传封面文件: " + imagePath);

  // Scroll to top of page first
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);

  // Step 1: Select "单图" radio button
  const singleLabel = page.locator("label", { hasText: "单图" }).first();
  await singleLabel.scrollIntoViewIfNeeded();
  await singleLabel.click({ force: true });
  await page.waitForTimeout(1500);

  // Step 2: Hover over cover area to reveal add button, then click it
  const coverArea = page.locator(".article-cover-images");
  await coverArea.scrollIntoViewIfNeeded();
  await coverArea.hover();
  await page.waitForTimeout(1000);

  const addBtn = page.locator(".article-cover-add").first();
  await addBtn.waitFor({ state: "visible", timeout: 10000 });
  await addBtn.click({ force: true });
  await page.waitForTimeout(3000);

  // Step 3: Find and click the upload tab in the cover drawer
  await page.waitForSelector(".byte-drawer .byte-tabs-header-title", { timeout: 10000 });
  await page.waitForTimeout(500);

  const drawerTabs = await page.locator(".byte-drawer .byte-tabs-header-title").all();
  console.log(`找到 ${drawerTabs.length} 个 tab`);
  let tabClicked = false;
  for (const tab of drawerTabs) {
    const text = (await tab.innerText().catch(() => "")).trim();
    console.log(`  tab: "${text}"`);
    if (text === "上传图片" || text === "正文图片") {
      await tab.click();
      tabClicked = true;
      console.log(`已点击: ${text}`);
      break;
    }
  }
  if (!tabClicked) {
    throw new Error("未找到上传标签");
  }
  await page.waitForTimeout(1000);

  // Step 4: Click "本地上传" and handle file chooser
  const uploadBtn = page.locator("text=本地上传").first();
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 15000 }),
    uploadBtn.click(),
  ]);

  await fileChooser.setFiles(imagePath);
  console.log("封面文件已选择，等待上传...");

  // Step 5: Click "确定" to confirm — wait for upload to finish (button enabled)
  const confirmBtn = page.locator(".byte-drawer button", { hasText: "确定" }).last();
  await confirmBtn.waitFor({ state: "visible", timeout: 10000 });
  // Wait until the button becomes enabled (upload complete)
  await page.waitForTimeout(1000);
  for (let i = 0; i < 30; i++) {
    const disabled = await confirmBtn.isDisabled().catch(() => true);
    if (!disabled) break;
    await page.waitForTimeout(1000);
  }
  await confirmBtn.click();
  await page.waitForTimeout(2000);

  console.log("封面设置完成");
}
