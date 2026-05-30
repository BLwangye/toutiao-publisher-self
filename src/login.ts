import { Page } from "playwright";
import { CONFIG } from "./config.js";

export async function ensureLogin(page: Page): Promise<boolean> {
  await page.goto(CONFIG.LOGIN_URL, { waitUntil: "domcontentloaded" });

  const loggedIn = await page.evaluate(() => {
    const userLink = document.querySelector<HTMLAnchorElement>(
      'a[href*="toutiao.com/c/user"]'
    );
    return userLink ? userLink.textContent?.trim() ?? null : null;
  });

  if (loggedIn) {
    console.log(`已登录: ${loggedIn}`);
    return true;
  }

  console.log("未登录，请在浏览器中手动登录（扫码或账号密码）");
  console.log("登录完成后按此窗口的任意键继续...");

  // Wait for URL to change to a logged-in page
  await page.waitForURL((url) => {
    return (
      url.hostname === "mp.toutiao.com" &&
      !url.pathname.includes("/login") &&
      !url.pathname.includes("/auth")
    );
  }, { timeout: 120_000 });

  console.log("登录成功");
  return true;
}
