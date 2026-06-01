import * as child_process from "child_process";
import type { Page } from "playwright";
import type { Category } from "./category.js";

// ── Env ──

function getEnv(key: string): string | undefined {
  const val = process.env[key];
  if (val) return val;
  if (process.platform === "win32") {
    try {
      return child_process
        .execSync(
          `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('${key}','User')"`,
          { encoding: "utf-8" }
        )
        .trim();
    } catch {
      /* not set */
    }
  }
  return undefined;
}

const DEEPSEEK_API_KEY = getEnv("DEEPSEEK_API_KEY");

// ── Types ──

export interface ArticleSource {
  title: string;
  content: string;
  html: string;
  url: string;
}

export interface FactSet {
  scores: Set<string>;
  percentages: Set<string>;
  numbers: Set<string>;
  dates: Set<string>;
  ranks: Set<string>;
  names: Set<string>; // proper nouns/long Chinese names extracted
}

interface FactDiff {
  missing: { type: string; value: string }[];
  altered: { type: string; original: string; found: string }[];
  extra: { type: string; value: string }[];
}

// ── Scrape ──

export async function scrapeArticle(
  page: Page,
  url: string
): Promise<ArticleSource> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(5000);

  const result = await page.evaluate(() => {
    const title =
      document.querySelector("h1")?.textContent?.trim() || "";
    const article = document.querySelector("article");

    // Collect all text paragraphs
    const paragraphs: string[] = [];
    const els = article
      ? article.querySelectorAll("p, h2, h3, li")
      : document.querySelectorAll("p, h2, h3, li");
    for (const el of els) {
      const t = el.textContent?.trim();
      if (t && t.length > 4) paragraphs.push(t);
    }

    const content = paragraphs.join("\n");

    // Also grab HTML for possible reuse
    const html = (article ?? document.body).innerHTML;
    return { title, content, html };
  });

  const source: ArticleSource = {
    title: result.title || "",
    content: result.content || "",
    html: result.html || "",
    url,
  };
  console.log(
    `抓取完成: ${source.title.substring(0, 30)} (${source.content.length}字)`
  );
  return source;
}

// ── Fact Extraction ──

export function extractSportsFacts(text: string): FactSet {
  const facts: FactSet = {
    scores: new Set(),
    percentages: new Set(),
    numbers: new Set(),
    dates: new Set(),
    ranks: new Set(),
    names: new Set(),
  };

  // Scores: "3-0", "100:98", "33分胜", "2比1"
  for (const m of text.matchAll(/\d+\s*[-:–—比]\s*\d+/g)) {
    facts.scores.add(m[0].trim());
  }

  // Percentages: "52.3%", "20%"
  for (const m of text.matchAll(/\d+(?:\.\d+)?%/g)) {
    facts.percentages.add(m[0]);
  }

  // Numbers with units: "30亿韩元", "4400亿", "17943台", "33℃"
  for (const m of text.matchAll(
    /\d+[\d,]*\.?\d*\s*(?:万|亿|千|百)?\s*(?:元|美元|韩元|欧元|分|场|人|个|次|秒|米|公里|台|℃|岁)/g
  )) {
    facts.numbers.add(m[0].trim());
  }

  // Dates: "2026-06-01", "2026年6月1日", "6月1日"
  for (const m of text.matchAll(
    /(?:\d{4}[年\-/])?\d{1,2}[月\-/]\d{1,2}日?/g
  )) {
    facts.dates.add(m[0]);
  }

  // Ranks: "第1名", "排名第3", "榜首"
  for (const m of text.matchAll(/第\s*\d+\s*(?:名|位)|排名第\s*\d+/g)) {
    facts.ranks.add(m[0].trim());
  }
  // "居榜首" pattern
  if (/居榜首/.test(text)) facts.ranks.add("居榜首");

  // Proper names: Chinese names (2-4 chars), foreign names in Chinese (3-8 chars)
  // Heuristic: look for capitalized sequences, or known Chinese name patterns
  const nameMatches = new Set<string>();

  // Foreign names: Latin sequences >= 2 chars with capital first
  for (const m of text.matchAll(/[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*/g)) {
    const name = m[0].trim();
    if (name.length >= 2) nameMatches.add(name);
  }

  // Chinese proper nouns: longer sequences that look like names/teams
  // Team patterns: "XX队", "XX男/女篮/足"
  for (const m of text.matchAll(
    /[\u4e00-\u9fff]{2,6}(?:队|男(?:篮|足|排)|女(?:篮|足|排)|男篮|女篮|男足|女足)/g
  )) {
    nameMatches.add(m[0]);
  }

  facts.names = nameMatches;

  console.log(
    `事实提取: 比分${facts.scores.size} 百分比${facts.percentages.size} 数字${facts.numbers.size} 日期${facts.dates.size} 排名${facts.ranks.size} 名称${facts.names.size}`
  );

  return facts;
}

// ── DeepSeek Rewrite ──

const SPORTS_SYSTEM_PROMPT = `你是体育新闻编辑。请润色以下文章，要求：
1. 只优化语言表达和段落结构
2. 严禁修改任何数据：比分、数字、百分比、排名、日期
3. 严禁修改或替换任何人名、队名、地名
4. 严禁增删任何事实信息
5. 可以调整句式、去掉冗余、让表达更流畅
6. 输出格式为 HTML（用 <h2> 做小标题，<p> 做段落，<ol><li> 做有序列表，<ul><li> 做无序列表），不要用代码块包裹
7. 适当使用 <strong> 加粗关键数据、重要结论、球员/队名
8. 每个 <h2> 标题前可用合适的体育 emoji（如 🏆⚽🏀🏅⚾🎾），不用太多，全文 2-4 个即可`;

const DEFAULT_SYSTEM_PROMPT = `你是新闻编辑。请润色以下文章，要求：
1. 只优化语言表达和段落结构
2. 严禁修改任何数据：数字、百分比、排名、日期
3. 严禁修改或替换任何人名、地名、专有名词
4. 严禁增删任何事实信息
5. 可以调整句式、去掉冗余、让表达更流畅
6. 输出格式为 HTML（用 <h2> 做小标题，<p> 做段落，<ol><li> 做有序列表，<ul><li> 做无序列表），不要用代码块包裹
7. 适当使用 <strong> 加粗关键数据、核心观点、重要结论
8. 每个 <h2> 标题前可搭配 1 个合适的 emoji（全文 2-4 个即可，克制使用）`;

export async function rewriteViaDeepSeek(
  title: string,
  content: string,
  category: Category | null
): Promise<string | null> {
  if (!DEEPSEEK_API_KEY) {
    console.log("未配置 DeepSeek API Key，跳过改写");
    return null;
  }

  const systemPrompt =
    category === "体育" ? SPORTS_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT;

  const userPrompt = `标题：${title}

原文：
${content.substring(0, 4000)}`;

  try {
    const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 4000,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    const data = (await resp.json()) as any;
    const text = data?.choices?.[0]?.message?.content?.trim() || "";
    if (!text) {
      console.log("DeepSeek 返回空内容");
      return null;
    }
    console.log(`DeepSeek 改写完成 (${text.length}字)`);
    return text;
  } catch (err) {
    console.error("DeepSeek 调用失败:", (err as Error).message);
    return null;
  }
}

// ── Validation ──

export function validateFacts(
  rewritten: string,
  originalFacts: FactSet
): FactDiff {
  const rewrittenFacts = extractSportsFacts(rewritten);
  const diff: FactDiff = { missing: [], altered: [], extra: [] };

  // Check each fact type
  const factTypes: { key: keyof FactSet; label: string }[] = [
    { key: "scores", label: "比分" },
    { key: "percentages", label: "百分比" },
    { key: "numbers", label: "数字" },
    { key: "dates", label: "日期" },
    { key: "ranks", label: "排名" },
    { key: "names", label: "名称" },
  ];

  for (const { key, label } of factTypes) {
    for (const v of originalFacts[key]) {
      if (!rewritten.includes(v)) {
        diff.missing.push({ type: label, value: v });
      }
    }
    for (const v of rewrittenFacts[key]) {
      if (!originalFacts[key].has(v) && !rewritten.includes(v) === false) {
        // Check if this rewritten fact appears to be an altered version
        // Simple heuristic: if it shares numeric part with an original fact
        let isAltered = false;
        for (const ov of originalFacts[key]) {
          if (v !== ov && hasSameDigits(v, ov)) {
            diff.altered.push({ type: label, original: ov, found: v });
            isAltered = true;
            break;
          }
        }
        if (!isAltered && !originalFacts[key].has(v)) {
          diff.extra.push({ type: label, value: v });
        }
      }
    }
  }

  if (diff.missing.length > 0) {
    console.log(`⚠ 缺失事实 (${diff.missing.length}):`);
    for (const d of diff.missing) {
      console.log(`  [${d.type}] ${d.value}`);
    }
  }
  if (diff.altered.length > 0) {
    console.log(`⚠ 篡改事实 (${diff.altered.length}):`);
    for (const d of diff.altered) {
      console.log(`  [${d.type}] ${d.original} → ${d.found}`);
    }
  }
  if (diff.extra.length > 0) {
    console.log(`⚠ 新增事实 (${diff.extra.length}):`);
    for (const d of diff.extra) {
      console.log(`  [${d.type}] ${d.value}`);
    }
  }
  if (
    diff.missing.length === 0 &&
    diff.altered.length === 0 &&
    diff.extra.length === 0
  ) {
    console.log("✅ 事实验证通过，无差异");
  }

  return diff;
}

// ── Fix ──

export async function fixDiscrepancies(
  rewritten: string,
  originalFacts: FactSet,
  diff: FactDiff
): Promise<string> {
  if (diff.missing.length > 0 || diff.altered.length > 0) {
    console.log("事实有差异，发送 DeepSeek 二次修正...");

    const correctionPrompt = `以下改写后的文章存在一些数据错误：

改写后文章：
${rewritten}

需要修正的问题：
${diff.missing.map((d) => `- 缺失: ${d.type} "${d.value}"，请确保文中包含此项`).join("\n")}
${diff.altered.map((d) => `- 篡改: "${d.original}" 被改成了 "${d.found}"，请恢复为原值`).join("\n")}

请修正上述问题后输出完整的修正版文章，不要有任何解释。`;

    try {
      const resp = await fetch(
        "https://api.deepseek.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [{ role: "user", content: correctionPrompt }],
            max_tokens: 4000,
            temperature: 0.1,
          }),
          signal: AbortSignal.timeout(60_000),
        }
      );

      const data = (await resp.json()) as any;
      const fixed = data?.choices?.[0]?.message?.content?.trim() || rewritten;
      console.log(`二次修正完成 (${fixed.length}字)`);

      // Re-validate
      const newDiff = validateFacts(fixed, originalFacts);
      if (newDiff.missing.length > 0 || newDiff.altered.length > 0) {
        console.log("⚠ 二次修正后仍有差异，使用当前结果");
      }
      return fixed;
    } catch (err) {
      console.error("二次修正失败:", (err as Error).message);
      return rewritten;
    }
  }

  return rewritten;
}

// ── Pipeline ──

export async function rewritePipeline(
  page: Page,
  url: string,
  category: Category | null
): Promise<{ finalContent: string; title: string; usedLLM: boolean }> {
  // 1. Scrape
  const article = await scrapeArticle(page, url);

  // 2. Extract facts (always do this for sports, optionally for others)
  const facts =
    category === "体育" ? extractSportsFacts(article.content) : emptyFactSet();

  // 3. Log fact summary
  if (category === "体育") {
    logFactSummary(facts, article.content);
  }

  // 4. Rewrite via DeepSeek
  const rewritten = await rewriteViaDeepSeek(
    article.title,
    article.content,
    category
  );

  if (!rewritten) {
    return {
      finalContent: wrapHtml(article.content),
      title: article.title,
      usedLLM: false,
    };
  }

  // 5. Validate
  if (category === "体育") {
    const diff = validateFacts(rewritten, facts);
    if (diff.missing.length > 0 || diff.altered.length > 0) {
      const fixed = await fixDiscrepancies(rewritten, facts, diff);
      return { finalContent: fixed, title: article.title, usedLLM: true };
    }
  }

  return { finalContent: rewritten, title: article.title, usedLLM: true };
}

// ── Helpers ──

function emptyFactSet(): FactSet {
  return {
    scores: new Set(),
    percentages: new Set(),
    numbers: new Set(),
    dates: new Set(),
    ranks: new Set(),
    names: new Set(),
  };
}

function hasSameDigits(a: string, b: string): boolean {
  const digitsA = a.replace(/\D/g, "");
  const digitsB = b.replace(/\D/g, "");
  return (
    digitsA.length > 1 && digitsB.length > 1 && digitsA === digitsB && a !== b
  );
}

function logFactSummary(facts: FactSet, content: string): void {
  const total =
    facts.scores.size +
    facts.percentages.size +
    facts.numbers.size +
    facts.dates.size +
    facts.ranks.size +
    facts.names.size;

  console.log(`\n=== 事实数据提取 ===`);
  console.log(`总事实数: ${total}`);
  if (facts.scores.size > 0)
    console.log(`  比分: ${[...facts.scores].join(", ")}`);
  if (facts.percentages.size > 0)
    console.log(`  百分比: ${[...facts.percentages].join(", ")}`);
  if (facts.numbers.size > 0)
    console.log(`  数字: ${[...facts.numbers].join(", ")}`);
  if (facts.dates.size > 0)
    console.log(`  日期: ${[...facts.dates].join(", ")}`);
  if (facts.ranks.size > 0)
    console.log(`  排名: ${[...facts.ranks].join(", ")}`);
  if (facts.names.size > 0) {
    const names = [...facts.names].slice(0, 20);
    console.log(`  名称: ${names.join(", ")}`);
    if (facts.names.size > 20) console.log(`    ... 共${facts.names.size}个`);
  }
  console.log(`  原文长度: ${content.length}字`);
  console.log(`=== 数据提取完毕 ===\n`);
}

function wrapHtml(text: string): string {
  if (/<[hp]/.test(text)) return text;
  return text
    .split("\n")
    .filter(Boolean)
    .map((p) => `<p>${p}</p>`)
    .join("");
}

export function formatContentLists(html: string): string {
  // Convert "1. xxx 2. yyy 3. zzz" (in same block) to <ol><li>
  // Pattern: number followed by dot/Chinese comma and content
  html = html.replace(
    /((?:<p>|^))((?:\d+[\.、．]\s*[^<]+)+)((?:<\/p>|$))/gm,
    (_, open, body, close) => {
      const items = body.split(/(?=\d+[\.、．]\s*)/g).filter(Boolean);
      if (items.length < 2) return open + body + close;
      const lis = items
        .map((s: string) => `<li>${s.replace(/^\d+[\.、．]\s*/, "").trim()}</li>`)
        .join("");
      return `${open}<ol>${lis}</ol>${close}`;
    }
  );

  return html;
}
