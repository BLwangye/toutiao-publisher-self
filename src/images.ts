import type { Page } from "playwright";
import { CONFIG } from "./config.js";

export async function setCoverFile(page: Page, imagePath: string): Promise<void> {
  console.log("上传封面文件: " + imagePath);

  // Step 1: Select "单图" radio button
  const singleLabel = page.locator("label", { hasText: "单图" }).first();
  await singleLabel.click({ force: true });
  await page.waitForTimeout(1000);

  // Step 2: Open the image drawer by clicking the add cover area
  const addBtn = page.locator(".article-cover-add");
  await addBtn.click({ force: true });
  await page.waitForTimeout(2000);

  // Verify drawer opened
  const drawerOpened = await page.locator(".primary-drawer").count();
  if (drawerOpened === 0) {
    // Retry once
    await addBtn.click({ force: true });
    await page.waitForTimeout(2000);
  }

  // Step 3: Click "本地上传" button and handle file chooser
  const uploadBtn = page.locator(".primary-drawer button", { hasText: "本地上传" }).first();
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 15000 }),
    uploadBtn.click(),
  ]);

  await fileChooser.setFiles(imagePath);
  console.log("封面文件已选择，等待上传...");

  // Step 4: Wait for upload to complete (image appears in drawer list)
  await page.waitForSelector(".primary-drawer .image-list img", {
    state: "visible",
    timeout: 30000,
  }).catch(() => {
    console.log("上传等待超时，尝试继续...");
  });

  // Step 5: Confirm the upload
  const confirmBtn = page.locator(".primary-drawer button", { hasText: "确定" }).last();
  await confirmBtn.waitFor({ state: "visible", timeout: 10000 });
  await confirmBtn.click();

  // Wait for drawer to close and cover image to appear
  await page.waitForTimeout(2000);

  console.log("封面设置完成");
}
