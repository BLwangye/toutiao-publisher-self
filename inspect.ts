import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("publish"))!;

// Inspect article-cover-images-wrap children
const wrapKids = await page.evaluate(() => {
  const wrap = document.querySelector(".article-cover-images-wrap");
  if (!wrap) return "No wrap";
  return Array.from(wrap.children).map(ch => ({
    tag: ch.tagName,
    class: (ch.className as string).substring(0, 50),
    rect: (ch as HTMLElement).getBoundingClientRect(),
    text: (ch as HTMLElement).innerText,
    displayed: window.getComputedStyle(ch).display,
    visibility: window.getComputedStyle(ch).visibility,
    pointerEvents: window.getComputedStyle(ch).pointerEvents,
    opacity: window.getComputedStyle(ch).opacity,
  }));
});
console.log("Wrap children:", JSON.stringify(wrapKids, null, 2));

// Try clicking text=编辑替换 directly with the text locator approach
try {
  const target = page.locator(".article-cover").locator("text=编辑替换").first();
  const vis = await target.isVisible();
  console.log("text=编辑替换 visible:", vis);
  if (vis) {
    await target.click({ force: true });
    console.log("Clicked text=编辑替换");
    await page.waitForTimeout(3000);
    const drawerStatus = await page.locator(".byte-drawer").count();
    console.log("Drawer count after click:", drawerStatus);
  }
} catch (e: any) {
  console.log("Click error:", e.message);
}

await browser.close();
