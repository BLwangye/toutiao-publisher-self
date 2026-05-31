import { chromium } from "playwright";
import { interactArticles } from "./src/interact.js";

const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("toutiao.com"))!;
if (!page) process.exit(1);

// Monkey-patch to log article URLs
const originalGoto = page.goto.bind(page);
page.goto = async (url: string, opts?: any) => {
  if (url.includes("/article/") || url.includes("/item/")) {
    console.log("📄 文章链接:", url);
  }
  return originalGoto(url, opts);
};

await interactArticles(page, 2);
await browser.close();
