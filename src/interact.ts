import { Page } from "playwright";
import { fetchToutiaoItems } from "./trend.js";
import * as fs from "fs";
import * as child_process from "child_process";

// ── DeepSeek LLM comment generation ──

function getEnv(key: string): string | undefined {
  const val = process.env[key];
  if (val) return val;
  if (process.platform === "win32") {
    try {
      return child_process.execSync(
        `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('${key}','User')"`,
        { encoding: "utf-8" }
      ).trim();
    } catch { /* not set */ }
  }
  return undefined;
}

const DEEPSEEK_API_KEY = getEnv("DEEPSEEK_API_KEY");

async function generateCommentByLLM(title: string, content: string): Promise<string> {
  if (!DEEPSEEK_API_KEY) {
    // Fallback to template-based generation
    return content.length > 50 
      ? commentFromContent(title, content) 
      : commentFromTitle(title);
  }

  const prompt = `根据以下文章内容，写一条简短评论。要求：
- 严格100-120字
- 只做内容摘要总结，不发表个人观点和情感
- 语气客观中立，像新闻简讯
- 即使原文较短，也要充分概括其传达的信息
- 不要使用"这篇文章""作者认为"等套话

标题：${title}
正文：${content.substring(0, 1500)}

请只输出评论内容，不要有任何前缀或引号。`;

  try {
    const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await resp.json() as any;
    const text = data?.choices?.[0]?.message?.content?.trim() || "";
    const comment = smartTruncate(text, 120);
    return comment || (content.length > 50 ? commentFromContent(title, content) : commentFromTitle(title));
  } catch {
    return content.length > 50 ? commentFromContent(title, content) : commentFromTitle(title);
  }
}

// ── Persistent dedup ──

const DEDUP_FILE = "commented.json";

// Extract stable ID from toutiao URLs so that changing query params
// (e.g. hot_board_impr_id) don't break dedup.
function normalizeUrl(url: string): string {
  const m = url.match(/toutiao\.com\/(trending|article|a)\/(\d+)/);
  if (m) return `${m[1]}/${m[2]}`;
  return url;
}

function loadCommented(): Set<string> {
  try {
    const data = JSON.parse(fs.readFileSync(DEDUP_FILE, "utf-8"));
    // Normalize on load to clean up old full-URL entries
    return new Set((data.urls ?? []).map(normalizeUrl));
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

export async function extractArticleInfo(page: Page): Promise<{ title: string; content: string }> {
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

// Truncate at last complete sentence boundary before maxLen
function smartTruncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  // Find the last sentence-ending punctuation before maxLen
  const slice = text.substring(0, maxLen);
  const match = slice.match(/.*[。！？]/);
  if (match) return match[0];
  // Fallback: find last comma/break
  const commaMatch = slice.match(/.*[，、；]/);
  if (commaMatch) return commaMatch[0];
  return slice;
}

// Extract meaningful sentences from article body
function extractSentences(content: string, minLen: number = 8): string[] {
  return content.split(/[。！？\n]/).filter(s => s.trim().length > minLen);
}

// Generate a comment when article has real text content
function commentFromContent(title: string, content: string): string {
  const sentences = extractSentences(content, 6);
  if (sentences.length < 2) return commentFromTitle(title);

  // Pick 2 key sentences from different parts of the article
  const early = sentences.slice(0, Math.ceil(sentences.length / 2));
  const late = sentences.slice(Math.ceil(sentences.length / 2));
  const point1 = pick(early.filter(s => s.length >= 10 && s.length <= 60)) || early[0]?.trim() || "";
  const point2 = pick(late.filter(s => s.length >= 10 && s.length <= 60)) || "";

  const opens = [
    "完整看完了这篇文章，",
    "刚把这篇文章读完，",
    "文章不长但信息量还可以，",
    "花了几分钟看完了，",
  ];

  const reacts = [
    "觉得写得还是很有道理的。",
    "感觉分析的思路挺清晰的。",
    "整体来说是比较客观的。",
    "内容还是挺实在的。",
  ];

  const connects = [
    point1 ? `比如文中提到"${point1.substring(0, 40)}"，这一点确实值得注意。` : "",
    point1 ? `像"${point1.substring(0, 30)}"这部分内容，可以说是有一定参考价值的。` : "",
    point1 ? `尤其是关于"${point1.substring(0, 35)}"这一段，读完之后有些启发。` : "",
    "作者的思路还是比较清晰的。",
    "有些观点确实能引发思考。",
  ].filter(Boolean);

  const personalViews = [
    "个人觉得",
    "在我看来",
    "说实话",
    "其实仔细想想",
  ];

  const views = [
    point2 ? `"${point2.substring(0, 35)}"这个角度挺有意思的。` : "文章中提到的现象确实普遍存在。",
    point2 ? `关于"${point2.substring(0, 30)}"的说法，我比较认同。` : "文章中反映的问题值得关注。",
    "很多事情确实是需要时间去验证的。",
    "每个时代都有每个时代的特点和挑战。",
  ];

  let comment = pick(opens) + pick(reacts) + pick(connects) + pick(personalViews) + pick(views);

  // Pad to 100+ chars if needed
  const extras = [
    "希望以后能看到更多这方面的讨论。",
    "总的来说，对相关话题感兴趣的朋友可以看看。",
    "大家怎么看这个问题呢？",
    "这也算是一个值得探讨的话题了。",
    "能引发一些思考的文章就是好文章。",
  ];
  if (comment.length < 100) comment += pick(extras);

  return comment.substring(0, 300);
}

// Generate a comment when article has no text (video, image-only)
function commentFromTitle(title: string): string {
  // Interpret the title topic rather than repeating it
  const opens = [
    "这个话题挺有意思的，",
    "最近也在关注这方面，",
    "这个话题其实蛮值得聊聊的，",
    "刷到这条内容，",
    "关于这类话题，",
  ];

  const opinions = [
    "我觉得还是要具体情况具体分析。",
    "每个人的看法可能不太一样。",
    "从不同的角度看，可能会有不同的理解。",
    "这种事情其实没有绝对的对错。",
    "关键还是要看实际情况是什么样的。",
  ];

  const personalViews = [
    "说实话，",
    "个人感觉，",
    "从普通人的角度来说，",
    "细细想想，",
    "平心而论，",
  ];

  const closers = [
    "希望相关内容能多一些。",
    "这也是一个值得关注的方向。",
    "期待后续能有更多报道。",
    "总体来说是值得一看的内容。",
    "关注这类话题的人应该不少。",
  ];

  let comment = pick(opens) + pick(opinions) + pick(personalViews);

  // Reference the topic area without directly quoting the title
  const topicRefs = shuffle([
    "现实生活中的确会遇到类似的情况。",
    "不同的人站在不同的立场，想法自然不同。",
    "社会在发展，很多事情也在慢慢变化。",
    "有讨论才有进步，这是好事。",
    "信息时代，多了解一些总是好的。",
  ]);
  comment += topicRefs[0] + pick(closers);

  // Pad if needed
  const extras = [
    "能引发思考的内容就是好内容。",
    "希望大家能理性讨论。",
    "多听听不同的声音没坏处。",
  ];
  if (comment.length < 100) comment += pick(extras);

  return comment.substring(0, 300);
}

// ── Utils ──

async function delay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min) + min);
  await new Promise(r => setTimeout(r, ms));
}

// ── Type comment into editor ──

export async function typeComment(page: Page, comment: string): Promise<boolean> {
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

// ── Resolve trending page to article URL ──

async function resolveTrendingUrl(page: Page, url: string): Promise<string | null> {
  if (!url.includes("/trending/")) return url;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(5000);
    const href = await page.evaluate(() => {
      const blocks = document.querySelector(".topic-blocks-wrapper");
      if (!blocks) return null;
      const link = blocks.querySelector('a[href*="/article/"]');
      return link ? link.getAttribute("href") : null;
    });
    if (!href) return null;
    return href.startsWith("http") ? href : `https://www.toutiao.com${href}`;
  } catch {
    return null;
  }
}

export async function interactArticles(page: Page, count: number = 5): Promise<void> {
  count = Math.min(count, 5);
  const commentedUrls = loadCommented();
  console.log(`  已评论过: ${commentedUrls.size} 篇`);

  console.log(`正在获取头条热榜文章...`);
  let articles = await fetchToutiaoItems();
  articles = articles.filter(a => !commentedUrls.has(normalizeUrl(a.url)));
  articles = articles.sort(() => Math.random() - 0.5);

  if (articles.length === 0) {
    console.log("  RSS 无新文章，从头条首页获取...");
    const homeArticles = await scrapeHomeArticles(page);
    articles = homeArticles
      .filter(a => !commentedUrls.has(normalizeUrl(a.url)))
      .map(a => ({ ...a, source: "头条首页", category: "", rootCategory: "", publishedAt: "", rank: 0 } as any));
    if (articles.length === 0) {
      console.log("未获取到文章，退出");
      return;
    }
  }
  console.log(`  共获取 ${articles.length} 篇新文章\n`);

  let likeCount = 0;
  let commentCount = 0;
  let articleIdx = 0;
  let attempt = 0;

  while (commentCount < count) {
    // If we've exhausted the list, try fetching fresh articles
    if (articleIdx >= articles.length) {
      console.log("  文章池耗尽，从头条首页获取...");
      const homeArticles = await scrapeHomeArticles(page);
      const newArticles = homeArticles.filter(a => !commentedUrls.has(normalizeUrl(a.url)));
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
      if (commentedUrls.has(normalizeUrl(article.url))) {
        console.log("  ⏭ 已评论过，跳过");
        continue;
      }

      // Resolve trending page to actual article URL
      let articleUrl = article.url;
      if (articleUrl.includes("/trending/")) {
        const resolved = await resolveTrendingUrl(page, articleUrl);
        if (resolved) {
          articleUrl = resolved;
          console.log(`  🔗 事件详情: ${articleUrl}`);
        } else {
          console.log("  ⚠ 未能解析事件详情，跳过");
          continue;
        }
      }

      await page.goto(articleUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(8000);

      // Mark as processed immediately so we don't repeat on retry
      commentedUrls.add(normalizeUrl(article.url));
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
          const comment = await generateCommentByLLM(title || article.title, content);
          console.log(`  生成评论 (${comment.length}字): ${comment}`);

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
