import { Page } from "playwright";
import * as child_process from "child_process";
import * as readline from "readline";
import { extractArticleInfo, typeComment } from "./interact.js";

// ── Env ──

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

// ── Article list scraping ──

interface ArticleItem {
  title: string;
  url: string;
}

export async function listPublishedArticles(page: Page): Promise<ArticleItem[]> {
  await page.goto("https://mp.toutiao.com/profile_v4/graphic/articles", {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await page.waitForTimeout(5000);

  return page.evaluate(() => {
    const items: { title: string; url: string }[] = [];
    const seen = new Set<string>();
    // Public article links on management page use /item/ pattern, e.g.:
    // https://www.toutiao.com/item/7648108038549488147/
    const links = document.querySelectorAll('a[href*="/item/"]');
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      const title = a.textContent?.trim() || "";
      // Skip thumbnail links (empty text) and duplicates
      if (title.length < 3) continue;
      if (!href.includes("toutiao.com")) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      items.push({ title, url: href });
    }
    return items;
  });
}

// ── Seed comment generation ──

const SEED_COMMENT_PROMPT = `根据以下文章内容，写一条能引发互动的种子评论（严格60-120字）。

策略（根据文章内容自动选择最合适的一种或结合使用）：
- **争议提问**：提炼文中一个存在争议或值得深入的点，用一个引人思考的问题表达，让人忍不住想回答
- **金句共鸣**：把文中最扎心的一句话或观点用大白话重新说出来，加上简短的感叹，让读者觉得"说的就是我"

要求：
- 语气真实，像真实读者的有感而发，不官方、不客气
- 不要用"写得很好""文章不错"这种客套话
- 不要引用原文（别说"文中提到..."）
- 要有互动感——让人觉得不回复都难受
- 即使是赞同的观点，也要表达得有张力

标题：TITLE_PLACEHOLDER
正文：CONTENT_PLACEHOLDER

请只输出评论内容，不要有任何前缀或引号。`;

async function generateSeedComment(title: string, content: string): Promise<string> {
  if (!DEEPSEEK_API_KEY) {
    return fallbackSeedComment(title, content);
  }

  const prompt = SEED_COMMENT_PROMPT
    .replace("TITLE_PLACEHOLDER", title)
    .replace("CONTENT_PLACEHOLDER", content.substring(0, 2000));

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
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const data = await resp.json() as any;
    const text = data?.choices?.[0]?.message?.content?.trim() || "";
    return text || fallbackSeedComment(title, content);
  } catch {
    return fallbackSeedComment(title, content);
  }
}

// ── Fallback: template-based seed comment ──

function fallbackSeedComment(title: string, _content: string): string {
  // Controversy-question style by default
  const questions = [
    `说实话，这种事换做是你，你能做到吗？`,
    `看完我就一个问题：值得吗？大家怎么看？`,
    `道理都懂，但真正能做到的有几个？`,
    `说得挺对，但现实中真的行得通吗？`,
  ];
  const reflections = [
    `"${title.substring(0, 25)}"——这句话真的戳到我了。有时候我们缺的不是道理，是有人帮我们把话说出来。`,
    `终于有人把这种感觉说清楚了。看完觉得，好像被理解了。`,
    `简单几句话，但每句都像在说我。这才是真正能让人静下来想的东西。`,
  ];
  const pool = [...questions, ...reflections];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Trim ──

function trimComment(text: string, maxLen: number = 120): string {
  if (text.length <= maxLen) return text;
  const slice = text.substring(0, maxLen);
  const match = slice.match(/.*[。！？]/);
  if (match) return match[0];
  return slice;
}

// ── Main pipeline ──

export async function selfCommentPipeline(page: Page, index?: number): Promise<void> {
  // 1. Fetch article list
  console.log("获取已发布文章列表...");
  const articles = await listPublishedArticles(page);

  if (articles.length === 0) {
    console.log("暂无已发布文章。");
    return;
  }

  // 2. Print list
  console.log(`\n已发布文章 (${articles.length} 篇):\n`);
  for (let i = 0; i < articles.length; i++) {
    console.log(`  [${i + 1}] ${articles[i].title.substring(0, 60)}`);
  }

  // 3. Determine article index
  let idx: number;
  if (index !== undefined) {
    if (index < 1 || index > articles.length) {
      console.log(`无效编号: ${index} (有效范围 1-${articles.length})`);
      return;
    }
    idx = index - 1;
  } else {
    idx = await new Promise<number>((resolve, reject) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(`\n选择文章编号 (1-${articles.length}): `, (answer: string) => {
        rl.close();
        const n = parseInt(answer.trim());
        if (isNaN(n) || n < 1 || n > articles.length) {
          reject(new Error(`无效编号: ${answer}`));
        } else {
          resolve(n - 1);
        }
      });
    });
  }

  const chosen = articles[idx];
  console.log(`\n选中: ${chosen.title}`);

  // 4. Navigate to article
  await page.goto(chosen.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(8000);

  // 5. Extract article content
  const { title, content } = await extractArticleInfo(page);
  console.log(`正文: ${content.length} 字`);

  // 6. Generate seed comment
  const comment = await generateSeedComment(title || chosen.title, content);
  const final = trimComment(comment, 120);
  console.log(`种子评论 (${final.length}字): ${final}`);

  // 7. Submit comment
  const commentWrapper = page.locator(".ttp-comment-wrapper, .detail-interaction-comment").first();
  if (await commentWrapper.count() === 0) {
    console.log("未找到评论区");
    return;
  }
  const loginMask = commentWrapper.locator(".login-mask").first();
  if (await loginMask.count() > 0) {
    console.log("未登录，无法评论");
    return;
  }

  let success = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ok = await typeComment(page, final);
    if (ok) {
      console.log("种子评论提交成功");
      success = true;
      break;
    }
    console.log(`评论提交失败，重试 ${attempt}/3...`);
    await new Promise(r => setTimeout(r, 3000));
  }

  if (!success) {
    console.log("种子评论提交失败（已重试3次）");
  }
}
