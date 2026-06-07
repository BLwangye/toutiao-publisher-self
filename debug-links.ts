import { chromium } from "playwright";

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const page = browser.contexts()[0].pages()[0] || await browser.contexts()[0].newPage();
  await page.goto("https://mp.toutiao.com/profile_v4/graphic/articles", {
    waitUntil: "domcontentloaded", timeout: 20000,
  });
  await page.waitForTimeout(5000);

  // Dump all links
  const links = await page.evaluate(() => {
    const all = document.querySelectorAll("a[href]");
    return Array.from(all).slice(0, 60).map(a => ({
      href: a.getAttribute("href"),
      text: a.textContent?.trim().substring(0, 80),
    }));
  });
  console.log("=== LINKS ===");
  for (const l of links) {
    console.log(`  [${l.text}] -> ${l.href}`);
  }

  // Also dump page title and main structure
  const title = await page.title();
  console.log(`\nPAGE TITLE: ${title}`);

  // Dump table/row structure
  const rows = await page.evaluate(() => {
    // Try various selectors
    const tableRows = document.querySelectorAll("table tr, .table-row, .list-item, [class*='row'], tbody tr");
    return Array.from(tableRows).slice(0, 10).map(r => ({
      tag: r.tagName,
      className: r.className?.toString?.().substring(0, 100),
      text: r.textContent?.trim().substring(0, 120),
    }));
  });
  console.log(`\n=== ROWS (${rows.length}) ===`);
  for (const r of rows) {
    console.log(`  <${r.tag} class="${r.className}"> ${r.text}`);
  }

  // Dump full page HTML snippet
  const bodyHTML = await page.evaluate(() => document.body.innerHTML.substring(0, 3000));
  console.log(`\n=== BODY HTML (first 3000 chars) ===`);
  console.log(bodyHTML);

  await browser.close();
})();
