import { chromium } from "playwright";

async function main() {
  const url = "http://127.0.0.1:9222";
  const browser = await chromium.connectOverCDP(url);
  const page = browser.contexts()[0].pages()[0] || await browser.contexts()[0].newPage();

  await page.goto("https://www.myzaker.com/article/6a1ee34f8e9f097a711cc6ed", {
    waitUntil: "domcontentloaded", timeout: 30000
  });
  await page.waitForTimeout(5000);

  const info = await page.evaluate(() => {
    const result: any = {};

    const h1 = document.querySelector("h1");
    result.h1 = h1?.textContent?.trim()?.substring(0, 80) || "NOT FOUND";

    const article = document.querySelector("article");
    result.hasArticle = !!article;
    result.articleSample = article?.outerHTML?.substring(0, 300) || "NONE";

    // Content containers by class name patterns
    result.contentDivs = Array.from(
      document.querySelectorAll('div[class*="article"], div[class*="content"], div[class*="detail"], div[class*="inner"]')
    ).slice(0, 5).map(el => ({
      tag: el.tagName,
      className: el.className?.substring(0, 80) || "",
      textSample: el.textContent?.trim()?.substring(0, 100) || "",
    }));

    // P elements
    const allP = document.querySelectorAll("p");
    result.pCount = allP.length;
    result.pSamples = Array.from(allP).slice(0, 8).map(p =>
      p.textContent?.trim()?.substring(0, 100) || ""
    ).filter(t => t.length > 5);

    // Check for any div with substantial text
    const divs = document.querySelectorAll("div");
    result.divCount = divs.length;
    const textDivs = Array.from(divs)
      .filter(d => (d.textContent?.trim()?.length || 0) > 100)
      .slice(0, 5)
      .map(d => ({
        className: d.className?.substring(0, 80) || "",
        textSample: d.textContent?.trim()?.substring(0, 150) || "",
      }));
    result.textRichDivs = textDivs;

    // Body innerText first 1000 chars
    result.bodyText = document.body.innerText?.substring(0, 1000) || "";

    return result;
  });

  console.log(JSON.stringify(info, null, 2));
  await page.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });
