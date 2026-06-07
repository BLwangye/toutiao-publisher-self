import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages()[0] || await browser.contexts()[0].newPage();
await page.goto("https://mp.toutiao.com/profile_v4/graphic/articles", {
  waitUntil: "domcontentloaded", timeout: 20000,
});
await page.waitForTimeout(5000);

const items = await page.evaluate(() => {
  const seen = new Set<string>();
  const result: { title: string; url: string }[] = [];
  document.querySelectorAll('a[href*="/item/"]').forEach(a => {
    const href = a.getAttribute("href") || "";
    const title = a.textContent?.trim() || "";
    if (title.length < 3 || !href.includes("toutiao.com") || seen.has(href)) return;
    seen.add(href);
    result.push({ title, url: href });
  });
  return result;
});

for (let i = 0; i < items.length; i++) {
  console.log(`${i + 1}|${items[i].title}`);
}
await browser.close();
