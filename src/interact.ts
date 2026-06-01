import { Page } from "playwright";
import { fetchToutiaoItems } from "./trend.js";
import * as fs from "fs";

// ── Persistent dedup ──

const DEDUP_FILE = "commented.json";

function loadCommented(): Set<string> {
  try {
    const data = JSON.parse(fs.readFileSync(DEDUP_FILE, "utf-8"));
    return new Set(data.urls ?? []);
  } catch {
    return new Set();
  }
}

function saveCommented(urls: Set<string>): void {
  fs.writeFileSync(DEDUP_FILE, JSON.stringify({ urls: [...urls] }), "utf-8");
}

// ── Article scraping from toutiao homepage ──

async function scrapeHomeArticles(page: Page): Promise<{ title: string; url: string }[]> {
  try {
    await page.goto("https://www.toutiao.com/", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);
    return page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/article/"]');
      const seen = new Set<string>();
      const result: { title: string; url: string }[] = [];
      for (const a of links) {
        const href = a.getAttribute("href") || "";
        if (seen.has(href)) continue;
        seen.add(href);
        const title = a.textContent?.trim() || "";
        if (title.length > 5 && href.startsWith("http")) {
          result.push({ title, url: href });
        }
      }
      return result.slice(0, 20);
    });
  } catch {
    return [];
  }
}

async function extractArticleInfo(page: Page): Promise<{ title: string; content: string }> {
  return page.evaluate(() => {
    const title = document.querySelector("h1")?.textContent?.trim() || "";
    const article = document.querySelector("article");
    const paragraphs = article?.querySelectorAll("p") ?? document.querySelectorAll("p");
    const texts: string[] = [];
    for (const p of paragraphs) {
      const t = p.textContent?.trim();
      if (t && t.length > 15) texts.push(t);
      if (texts.length >= 8) break;
    }
    return { title, content: texts.join("\n") };
  });
}

// ── Comment generation ──

// Sentence openers: varied, neutral, human-like
const openers = [
  "看完这篇文章，感觉",
  "读完之后，我觉得",
  "认真看了一遍，",
  "这篇文章让我想到",
  "通篇读下来，",
  "花了点时间读完，",
  "仔细看完了，",
  "这篇文章讲得挺实在的，",
  "从头到尾看了一遍，感觉",
  "刚刚读完这篇文章，",
  "一口气看完了，",
  "这篇文章读起来挺顺畅的，",
];

const midPhrases = [
  "确实说出了很多人的心里话。",
  "有些观点挺有启发的。",
  "可以说是点到了关键处。",
  "分析得比较到位。",
  "给了我不小的启发。",
  "让人有些新的思考。",
  "整体逻辑还是比较清楚的。",
  "内容挺充实的。",
];

const reflections = [
  "从我个人角度来看，",
  "说实话，",
  "其实仔细想想，",
  "站在普通读者的角度，",
  "客观来说，",
  "平心而论，",
  "回过头来看，",
  "细细琢磨一下，",
];

const closers = [
  "总的来说还是一篇值得一读的文章。",
  "整体来看，文章的质量还是不错的。",
  "希望以后能看到更多这样的内容。",
  "这种类型的文章还是值得花时间看看的。",
  "感谢作者的分享，挺有收获的。",
  "算是比较中肯的一篇文章了。",
  "对相关话题感兴趣的朋友可以看看。",
  "这篇文章的信息量还是可以的。",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function extractKeyPhrase(content: string): string {
  const sentences = content.split(/[。！？\n]/).filter(s => s.trim().length > 8);
  if (sentences.length === 0) return "";
  // Pick a medium-length sentence from the first half
  const pool = sentences.slice(0, Math.min(4, sentences.length))
    .filter(s => s.length >= 10 && s.length <= 60);
  return pick(pool) || sentences[0]?.trim() || "";
}

function extractTopic(title: string): string {
  // Remove common prefixes/suffixes to get the core topic
  return title
    .replace(/[：:].*$/, "")
    .replace(/[，,].*$/, "")
    .replace(/[丨｜|].*$/, "")
    .replace(/^\d+[、.．]\s*/, "")
    .trim();
}

function generateCommentFromArticle(title: string, content: string): string {
  const topic = extractTopic(title);
  const keyPhrase = extractKeyPhrase(content);

  // Build comment from shuffled sentence parts
  const parts = shuffle([
    `${pick(openers)}${topic ? `关于"${topic}"这个话题，` : ""}${pick(midPhrases)}`,
    keyPhrase ? `${pick(reflections)}文章中提到的"${keyPhrase}"这一点让我印象比较深。` : `${pick(reflections)}文章里的一些观点确实值得思考。`,
    pick(closers),
  ]);

  let comment = parts.join("");
  
  // Ensure minimum 100 characters
  if (comment.length < 100) {
    const extras = shuffle([
      "对这方面感兴趣的读者不妨花点时间看看原文。",
      "有些细节写得还是挺用心的，能看出作者做了功课。",
      "虽然有些地方还可以更深入，但整体已经不错了。",
      "每个人的看法可能不同，但文章提供了一个不错的视角。",
      "在信息泛滥的时代，能静下心写这样的文章不容易。",
    ]);
    comment += extras[0];
  }

  return comment.substring(0, 300); // cap at 300 chars
}

// ── Utils ──

async function delay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min) + min);
  await new Promise(r => setTimeout(r, ms));
}

// ── Type comment into editor ──

async function typeComment(page: Page, comment: string): Promise<boolean> {
  const commentInput = page.locator(".ttp-comment-input").first();
  if (await commentInput.count() === 0) return false;

  const editor = commentInput.locator(".comment-textarea").first();
  if (await editor.count() === 0) return false;

  await editor.click({ clickCount: 3 });
  await page.waitForTimeout(300);
  await page.keyboard.type(comment, { delay: 60 });
  await page.waitForTimeout(500);

  await editor.evaluate(el => {
    el.dispatchEvent(new InputEvent("input", {
      bubbles: true, cancelable: true, inputType: "insertText", data: null,
    }));
    el.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true, cancelable: true, inputType: "insertText",
    }));
  });
  await page.waitForTimeout(500);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);

  const submitBtn = commentInput.locator(".submit-btn").first();
  if (await submitBtn.count() === 0) return false;

  const btnClass = await submitBtn.evaluate(el => el.className).catch(() => "disable");
  if (btnClass.includes("disable")) return false;

  let postOk = false;
  const respPromise = page.waitForResponse(
    resp => resp.url().includes("post_message") && resp.status() === 200,
    { timeout: 10000 }
  ).then(async (resp) => {
    try { const data = await resp.json(); postOk = data.errno === 0; } catch {}
  }).catch(() => {});

  await submitBtn.click();
  await respPromise;
  await delay(3000, 5000);

  return postOk;
}

// ── Main interaction ──

export async function interactArticles(page: Page, count: number = 5): Promise<void> {
  count = Math.min(count, 5);
  const commentedUrls = loadCommented();
  console.log(`  已评论过: ${commentedUrls.size} 篇`);

  console.log(`正在获取头条热榜文章...`);
  let articles = await fetchToutiaoItems();
  // Filter out already-commented articles before shuffling
  articles = articles.filter(a => !commentedUrls.has(a.url));
  articles = articles.sort(() => Math.random() - 0.5);
  console.log(`  共获取 ${articles.length} 篇新文章\n`);

  if (articles.length === 0) {
    console.log("未获取到文章，退出");
    return;
  }

  let likeCount = 0;
  let commentCount = 0;
  let articleIdx = 0;
  let attempt = 0;

  while (commentCount < count) {
    // If we've exhausted the list, try fetching fresh articles
    if (articleIdx >= articles.length) {
      console.log("  文章池耗尽，从头条首页获取...");
      const homeArticles = await scrapeHomeArticles(page);
      const newArticles = homeArticles.filter(a => !commentedUrls.has(a.url));
      if (newArticles.length === 0) {
        console.log("  无新文章可用，退出");
        break;
      }
      articles = articles.concat(newArticles.map(a => ({
        ...a, source: "头条首页", category: "", rootCategory: "", publishedAt: "", rank: 0,
      } as any)).sort(() => Math.random() - 0.5));
      console.log(`  首页获取 ${newArticles.length} 篇新文章`);
    }

    const article = articles[articleIdx];
    articleIdx++;
    attempt++;

    try {
      console.log(`\n--- 第 ${attempt} 次尝试 (目标 ${count} 篇) ---`);
      console.log(`  ${article.title.substring(0, 50)}`);
      console.log(`  📄 ${article.url}`);

      // Skip if already commented in this batch
      if (commentedUrls.has(article.url)) {
        console.log("  ⏭ 已评论过，跳过");
        continue;
      }

      await page.goto(article.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(8000);

      // Mark as processed immediately so we don't repeat on retry
      commentedUrls.add(article.url);
      saveCommented(commentedUrls);

      // Read article content
      const { title, content } = await extractArticleInfo(page);
      console.log(`  正文: ${content.length} 字`);

      // 1. Like article
      const likeBtn = page.locator("[class*=\"digg\"], [class*=\"like\"], [class*=\"support\"]").first();
      if (await likeBtn.count() > 0) {
        await likeBtn.click();
        await delay(1000, 2000);
        console.log("  ✅ 点赞");
        likeCount++;
      } else {
        console.log("  ⚠ 未找到点赞按钮");
      }

      // 2. Comment (no interval between like and comment on same article)
      const commentWrapper = page.locator(".ttp-comment-wrapper, .detail-interaction-comment").first();
      if (await commentWrapper.count() === 0) {
        console.log("  ⚠ 未找到评论区");
      } else {
        const loginMask = commentWrapper.locator(".login-mask").first();
        if (await loginMask.count() > 0) {
          console.log("  ⚠ 未登录，跳过评论");
        } else {
          // Generate comment from article content (or title fallback)
          const sourceText = content.length > 20 ? content : title;
          const comment = generateCommentFromArticle(
            title || article.title,
            sourceText
          );
          console.log(`  生成评论 (${comment.length}字)`);

          const ok = await typeComment(page, comment);
          if (ok) {
            console.log(`  ✅ 评论成功`);
            commentCount++;
          } else {
            console.log("  ⚠ 评论提交失败");
          }
        }
      }

      // 30 second interval before next article
      if (commentCount < count) {
        console.log("  等待 30s...");
        await new Promise(r => setTimeout(r, 30_000));
      }

    } catch (err: any) {
      console.error(`  ❌ 失败: ${err.message?.substring(0, 80)}`);
    }
  }

  console.log(`\n互动完成: 点赞 ${likeCount}, 评论 ${commentCount}/${count}`);
}
