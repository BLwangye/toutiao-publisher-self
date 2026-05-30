import { Page } from "playwright";
import { CONFIG, VERIFY_URL_PATTERNS } from "./config.js";

export async function ensureLogin(page: Page): Promise<boolean> {
  try {
    await page.goto(CONFIG.LOGIN_URL, { waitUntil: "domcontentloaded" });

    try {
      await page.waitForSelector('a[href*="toutiao.com/c/user"]', { timeout: 5000 });
      const username = await page.textContent('a[href*="toutiao.com/c/user"]');
      console.log(`已登录: ${username?.trim()}`);
      return true;
    } catch {
      // Not logged in, wait for manual login
    }

    console.log("未登录，请在浏览器中手动登录（扫码或账号密码），等待自动检测...");

    await page.waitForURL((url) => {
      for (const pattern of VERIFY_URL_PATTERNS) {
        if (url.href.includes(pattern)) return true;
      }
      return false;
    }, { timeout: 120_000 });

    console.log("登录成功");
    return true;
  } catch (err) {
    console.error("登录检测失败:", err);
    return false;
  }
}
