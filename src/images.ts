import type { Page } from "playwright";
import { CONFIG } from "./config.js";

export async function setCoverFile(page: Page, imagePath: string): Promise<void> {
  console.log("上传封面文件: " + imagePath);

  // Step 1: Select "单图" radio button
  const singleLabel = page.locator("label", { hasText: "单图" }).first();
  await singleLabel.click({ force: true });
  await page.waitForTimeout(1000);

  // Step 2: Click "编辑替换" to open the image drawer
  const editBtn = page.locator("text=编辑替换").first();
  await editBtn.click({ force: true });
  await page.waitForTimeout(2000);

  // Step 3: Click "上传图片" tab
  await page.locator(".byte-tabs-header-title", { hasText: "上传图片" }).click();
  await page.waitForTimeout(1000);

  // Step 4: Click "本地上传" and handle file chooser
  const uploadBtn = page.locator("text=本地上传").first();
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 15000 }),
    uploadBtn.click(),
  ]);

  await fileChooser.setFiles(imagePath);
  console.log("封面文件已选择，等待上传...");
  await page.waitForTimeout(3000);

  // Step 5: Click "确定" to confirm
  const confirmBtn = page.locator(".byte-drawer button", { hasText: "确定" }).last();
  await confirmBtn.waitFor({ state: "visible", timeout: 10000 });
  await confirmBtn.click();
  await page.waitForTimeout(2000);

  console.log("封面设置完成");
}
