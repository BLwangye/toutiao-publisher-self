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

export interface FactItem {
  type: "number" | "date" | "person" | "location" | "org" | "event";
  value: string;
  context: string;
}

interface FactExtraction {
  facts: FactItem[];
}

interface FactDiff {
  missing: FactItem[];
  altered: { original: FactItem; found: string }[];
  extra: FactItem[];
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

    // ── Find the main content container ──
    // Try specific selectors first, never fall back to document.body
    const contentSelectors = [
      "article",
      '[class*="article-content"]',
      '[class*="articleContent"]',
      ".article-body",
      ".post-content",
      ".rich_media_content",
      '[data-component="article"]',
      "main",
    ];
    let container: HTMLElement | null = null;
    for (const sel of contentSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.trim().length > 50) {
        container = el.cloneNode(true) as HTMLElement;
        break;
      }
    }

    // No content container found — return empty, caller will skip
    if (!container) return { title, content: "", html: "" };

    // ── Detect error/deleted pages ──
    const fullText = container.textContent?.trim() || "";
    const errorPatterns = [
      /内容不存在/,
      /内容已被删除/,
      /页面不存在/,
      /404/,
      /抱歉[，,]你访问/,
      /已下架/,
      /该文章/,
    ];
    for (const p of errorPatterns) {
      if (p.test(fullText) && fullText.length < 200) {
        return { title, content: "", html: "" };
      }
    }

    // Remove non-content elements before extracting text
    const excludeSelectors = [
      "figure", "figcaption", "aside", "nav",
      '[class*="caption"]', '[class*="credit"]',
      '[class*="author"]', '[class*="byline"]',
      '[class*="timestamp"]', '[class*="published"]',
      '[class*="share"]', '[class*="social"]',
      '[class*="related"]', '[class*="recommend"]',
      '[data-component*="related"]',
      '[aria-hidden="true"]',
    ];
    for (const sel of excludeSelectors) {
      for (const el of container.querySelectorAll(sel)) {
        el.remove();
      }
    }

    // Collect text from content-bearing elements
    const paragraphs: string[] = [];
    const els = container.querySelectorAll("p, h2, h3, li, [data-component='text-block']");

    // Non-content patterns — lines matching these are skipped
    const skipPatterns = [
      /^图像来源[,，]/, /^图片来源[,，]/, /^Image\s*source[,:]/i,
      /^(Getty|Reuters|AFP|EPA|AP)\b/i,
      /^作者[：:]\s*/,
      /^(BBC|CNN)\s*(记者|News|Correspondent|Editor)/i,
      /^(记者|编辑|撰稿)[：:]/,
      /^发布(时间|于)/,
      /^(Published|Posted)\b/i,
      /阅读时间[：:]/,
      /^\d+\s*(分钟?|min)/,
      /^更多相关(内容|文章|话题|阅读)/,
      /^相关(推荐|阅读|链接)/,
      /^推荐(阅读|内容)/,
      /^热门(推荐|文章)/,
      /^(Cookies|Cookie)\b/i,
      /^(联络|联系|关于|隐私|条款|版权|©)\b/,
      /值得信赖/,
      /^(分享|转发|收藏|评论|点赞)[：:]?/,
      /^Advertisement$/i,
      /^$/,
    ];

    for (const el of els) {
      const t = el.textContent?.trim() || "";

      // Skip short metadata lines
      if (t.length < 6) continue;

      // Check against non-content patterns
      let skip = false;
      for (const p of skipPatterns) {
        if (p.test(t)) { skip = true; break; }
      }
      if (skip) continue;

      paragraphs.push(t);
    }

    const content = paragraphs.join("\n");
    const html = container.innerHTML;
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

// ── DeepSeek Fact Extraction ──

const EXTRACT_SYSTEM_PROMPT = `你是事实核查员。从以下文章中提取所有关键事实，输出为 JSON。

规则：
1. 只提取可验证的客观事实，不提取观点、评论、推测
2. 每条事实包含 value（原文中的精确表述）和 context（简短语境说明）
3. 分类标准：
   - number: 数字、百分比、金额、统计数据（如"同比增长12.3%""造成3死5伤""市值1.2万亿"）
   - date: 日期、时间表述（如"2026年6月2日""上周三"）
   - person: 真实人物姓名（不含泛指"网友""市民"）
   - location: 地名、地理位置（如"云南大理""北京市朝阳区"）
   - org: 机构、公司、组织名称（如"英伟达""央行""国务院"）
   - event: 具体事件描述（如"发生肢体冲突""通过新法案""发布新产品"）
4. 如果原文没有某类事实，对应数组为空
5. 严格按 JSON Schema 输出，不要有任何额外文字

输出格式：
{
  "facts": [
    { "type": "number", "value": "12.3%", "context": "GDP同比增长率" }
  ]
}`;

async function extractFactsViaDeepSeek(content: string, title: string): Promise<FactItem[]> {
  if (!DEEPSEEK_API_KEY) {
    console.log("未配置 DeepSeek API Key，跳过事实提取");
    return [];
  }

  const text = content.substring(0, 4000);
  const userPrompt = `标题：${title}\n\n原文：\n${text}`;

  const makeRequest = async (): Promise<FactItem[]> => {
    const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: EXTRACT_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 2000,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    const data = (await resp.json()) as any;
    const raw = data?.choices?.[0]?.message?.content?.trim() || "";
    const parsed = JSON.parse(raw) as FactExtraction;
    return parsed.facts ?? [];
  };

  try {
    const facts = await withRetry(makeRequest, 2);
    console.log(`事实提取: ${facts.length} 条 (${[...new Set(facts.map(f => f.type))].join(", ")})`);
    return facts;
  } catch (err) {
    console.error("事实提取失败:", (err as Error).message);
    throw new Error("FACT_EXTRACTION_FAILED: 无法提取原文事实，终止发布");
  }
}

// ── Fact formatting for prompt injection ──

function formatFactsForPrompt(facts: FactItem[]): string {
  if (facts.length === 0) return "";
  const typeLabels: Record<string, string> = {
    number: "数字/数据",
    date: "日期/时间",
    person: "人名",
    location: "地名",
    org: "机构/组织",
    event: "事件",
  };
  const groups = new Map<string, string[]>();
  for (const f of facts) {
    const label = typeLabels[f.type] ?? f.type;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(f.value);
  }
  const lines: string[] = [];
  for (const [label, values] of groups) {
    lines.push(`- ${label}: ${values.join("、")}`);
  }
  return lines.join("\n");
}

// ── Title translation ──

async function translateTitle(title: string): Promise<string> {
  if (!DEEPSEEK_API_KEY) return title;

  // If title is already mostly Chinese, skip
  const cjkCount = (title.match(/[一-鿿]/g) || []).length;
  if (cjkCount > title.length * 0.3) return title;

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
          { role: "system", content: "你是一个新闻标题翻译专家。将英文标题翻译为简洁有吸引力的中文标题，保留原意，符合中文新闻标题习惯。只输出翻译后的中文标题，不要任何解释。" },
          { role: "user", content: title },
        ],
        max_tokens: 100,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const data = (await resp.json()) as any;
    const translated = data?.choices?.[0]?.message?.content?.trim() || "";
    if (translated && translated.length > 0) {
      console.log(`标题翻译: "${title}" → "${translated}"`);
      return translated;
    }
    return title;
  } catch (err) {
    console.log("标题翻译失败，使用原标题:", (err as Error).message);
    return title;
  }
}

// ── DeepSeek Rewrite ──

const REWRITE_SYSTEM_PROMPT = `你是新闻编辑。请润色以下文章，要求：
1. 只优化语言表达和段落结构
2. 严禁修改任何数据：数字、百分比、金额、统计数字
3. 严禁修改或替换任何人名、地名、机构名、专有名词
4. 严禁增删任何事实信息，严禁虚构数据
5. 可以调整句式、去掉冗余、让表达更流畅
6. 输出格式为 HTML（用 <h2> 做小标题，<p> 做段落，<ol><li> 做有序列表，<ul><li> 做无序列表），不要用代码块包裹
7. 适当使用 <strong> 加粗关键数据、核心观点、重要结论
8. 每个 <h2> 标题前可搭配 1 个合适的 emoji（全文 2-4 个即可，克制使用）`;

async function rewriteViaDeepSeek(
  title: string,
  content: string,
  facts: FactItem[]
): Promise<string | null> {
  if (!DEEPSEEK_API_KEY) {
    console.log("未配置 DeepSeek API Key，跳过改写");
    return null;
  }

  const factsBlock = formatFactsForPrompt(facts);
  const factsConstraint = factsBlock
    ? `\n\n【关键事实清单 — 严禁修改或删除以下任何内容】\n${factsBlock}\n`
    : "";

  const userPrompt = `标题：${title}

原文：
${content.substring(0, 4000)}${factsConstraint}`;

  const makeRequest = async (): Promise<string | null> => {
    const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: REWRITE_SYSTEM_PROMPT },
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
    return text;
  };

  try {
    const rewritten = await withRetry(makeRequest, 2);
    if (rewritten) {
      console.log(`DeepSeek 改写完成 (${rewritten.length}字)`);
      return rewritten;
    }
    console.error("DeepSeek 改写返回空内容，终止");
    throw new Error("REWRITE_FAILED: DeepSeek 改写失败，终止发布");
  } catch (err) {
    console.error("改写失败:", (err as Error).message);
    throw new Error("REWRITE_FAILED: DeepSeek 改写失败，终止发布");
  }
}

// ── Retry ──

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2
): Promise<T> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err as Error;
      if (attempt < maxRetries) {
        console.log(`重试 ${attempt + 1}/${maxRetries}: ${lastErr.message}`);
      }
    }
  }
  throw lastErr ?? new Error("withRetry: unreachable");
}

// ── Validation ──

function hasSameDigits(a: string, b: string): boolean {
  const digitsA = a.replace(/\D/g, "");
  const digitsB = b.replace(/\D/g, "");
  return digitsA.length > 1 && digitsB.length > 1 && digitsA === digitsB && a !== b;
}

// Check if enough key tokens from a fact appear in the rewritten text.
// Used for date, event, person, location, and org facts that are often rephrased.
export function fuzzyMatch(original: string, rewritten: string, factType: string): boolean {
  // Cross-language: fact extracted from English, but rewrite is Chinese.
  // Most English tokens won't survive translation — check only digits survive.
  const origCJK = (original.match(/[一-鿿]/g) || []).length;
  const rewriteCJK = (rewritten.match(/[一-鿿]/g) || []).length;
  const origASCII = (original.match(/[A-Za-z]/g) || []).length;

  if (origASCII > origCJK && rewriteCJK > origASCII) {
    // Cross-language: original is English, rewrite is Chinese.
    // Only digits reliably survive translation.
    const digits = original.match(/\d+/g);
    if (!digits || digits.length === 0) return true; // no digits to check, trust the translation
    return digits.every(d => rewritten.includes(d));
  }

  const tokens: string[] = [];

  if (factType === "date") {
    // Dates: extract digit+unit pairs like "8月", "7日", "2026年"
    const dateTokens = original.match(/\d+\s*[月日年]|\d{4}/g) || [];
    tokens.push(...dateTokens.map(t => t.replace(/\s/g, "")));
    // Also pure digits
    const digits = original.match(/\d+/g) || [];
    tokens.push(...digits);
  } else {
    // Events, persons, locations, orgs: CJK bigrams + numbers + Latin words
    const cjk = original.match(/[一-鿿]/g) || [];
    for (let i = 0; i < cjk.length - 1; i++) {
      tokens.push(cjk[i] + cjk[i + 1]);
    }
    const numLatin = original.match(/\d+|[A-Za-z]+/g) || [];
    tokens.push(...numLatin);
  }

  if (tokens.length === 0) return rewritten.includes(original);

  const found = tokens.filter(t => rewritten.includes(t));
  const ratio = found.length / tokens.length;

  // Short facts (≤4 tokens) use relaxed 50% threshold to avoid
  // false positives on names/places with few bigrams.
  const threshold = tokens.length <= 4 ? 0.5 : 0.7;
  return ratio >= threshold;
}

export function validateFacts(rewritten: string, originalFacts: FactItem[]): FactDiff {
  const diff: FactDiff = { missing: [], altered: [], extra: [] };

  // Cross-language: original facts are mostly English, rewrite is Chinese.
  // String matching is futile — only digit preservation can be verified.
  const origCJK = (originalFacts.map(f => f.value).join("").match(/[一-鿿]/g) || []).length;
  const origASCII = (originalFacts.map(f => f.value).join("").match(/[A-Za-z]/g) || []).length;
  const rewriteCJK = (rewritten.match(/[一-鿿]/g) || []).length;

  if (origASCII > origCJK && rewriteCJK > origASCII) {
    // Cross-language: only check number facts for digit preservation
    for (const fact of originalFacts) {
      if (fact.type !== "number") continue;
      const digits = fact.value.replace(/\D/g, "");
      if (digits.length === 0) continue; // e.g. "more than half", "one in three"
      // If the fact value contains English words, digits may become Chinese
      // numerals (10,000 → 一万) — skip, can't verify across languages.
      if (/[A-Za-z]{2,}/.test(fact.value)) continue;
      // Large round numbers (4+ digits) often convert to 万/亿 — skip
      if (digits.length >= 4 && digits.endsWith("0")) continue;
      // Check all digits from original appear somewhere in the rewrite
      if (!rewritten.includes(digits) && !rewritten.match(new RegExp(digits.split("").join("\\D*")))) {
        diff.missing.push(fact);
      }
    }
    if (diff.missing.length === 0) {
      console.log("✅ 事实验证通过（跨语言模式，已校验关键数字）");
    }
    return diff;
  }

  // ── Check each original fact exists in rewritten ──
  for (const fact of originalFacts) {
    // Use fuzzy token matching for types that get rephrased
    if (fact.type === "event" || fact.type === "date" ||
        fact.type === "person" || fact.type === "location" || fact.type === "org") {
      if (!fuzzyMatch(fact.value, rewritten, fact.type)) {
        diff.missing.push(fact);
      }
      continue;
    }

    // Number type: exact string match with altered-digit detection
    if (!rewritten.includes(fact.value)) {
      // Cross-language: fact value has no digits (e.g. "more than half"),
      // it can't survive translation — skip verification, trust the rewrite.
      const digitPattern = fact.value.replace(/\D/g, "");
      if (digitPattern.length === 0) continue;

      let foundAltered = false;
      if (digitPattern.length >= 2) {
        const rewrittenNums = rewritten.match(/\d+[\d,.]*\s*[万亿千百]?\s*[元美元韩元欧元分场人个次秒米公里台℃岁%倍]?/g) || [];
        for (const rn of rewrittenNums) {
          const rnDigits = rn.replace(/\D/g, "");
          if (rnDigits === digitPattern && rn !== fact.value) {
            diff.altered.push({ original: fact, found: rn });
            foundAltered = true;
            break;
          }
        }
      }
      if (!foundAltered) {
        diff.missing.push(fact);
      }
    }
  }

  // ── Extra detection: numbers in rewritten that aren't in original facts ──
  // Warn-only — does not block publishing, but surfaces potential hallucinations.
  const originalNumberValues = new Set(
    originalFacts.filter(f => f.type === "number").map(f => f.value)
  );
  const rewrittenNumsAll = rewritten.match(
    /\d+[\d,.]*\s*[万亿千百]?\s*[元美元韩元欧元分场人个次秒米公里台℃岁%倍]?/g
  ) || [];
  const seenDigits = new Set<string>();
  for (const f of originalFacts.filter(f => f.type === "number")) {
    seenDigits.add(f.value.replace(/\D/g, ""));
  }
  for (const rn of rewrittenNumsAll) {
    const rnDigits = rn.replace(/\D/g, "");
    if (rnDigits.length >= 2 && !seenDigits.has(rnDigits) && !originalNumberValues.has(rn)) {
      diff.extra.push({ type: "number", value: rn, context: "改写后新增的数字" });
      seenDigits.add(rnDigits); // dedup same number appearing multiple times
    }
  }

  // ── Log results ──
  if (diff.missing.length > 0) {
    console.log(`⚠ 缺失事实 (${diff.missing.length}):`);
    for (const d of diff.missing) {
      console.log(`  [${d.type}] ${d.value}  (${d.context})`);
    }
  }
  if (diff.altered.length > 0) {
    console.log(`⚠ 篡改事实 (${diff.altered.length}):`);
    for (const d of diff.altered) {
      console.log(`  [${d.original.type}] ${d.original.value} → ${d.found}  (${d.original.context})`);
    }
  }
  if (diff.extra.length > 0) {
    console.log(`🔍 疑似新增数据 (${diff.extra.length}) — 不阻塞发布，请人工判断:`);
    for (const d of diff.extra) {
      console.log(`  [${d.type}] ${d.value}  (${d.context})`);
    }
  }

  if (diff.missing.length === 0 && diff.altered.length === 0) {
    console.log("✅ 事实验证通过，无差异");
  }

  return diff;
}

// ── Sentence count check (for 0-fact articles) ──

export function checkSentenceCount(original: string, rewritten: string): boolean {
  if (!original || !rewritten) return true;
  const origSentences = original.split(/[。！？\n]/).filter(s => s.trim().length > 0);
  const rewriteSentences = rewritten.split(/[。！？\n]/).filter(s => s.trim().length > 0);
  if (origSentences.length === 0) return true;
  const ratio = rewriteSentences.length / origSentences.length;
  return ratio >= 0.6;
}

// ── Fix ──

async function fixDiscrepancies(
  rewritten: string,
  originalFacts: FactItem[],
  diff: FactDiff
): Promise<string> {
  console.log("事实有差异，发送 DeepSeek 二次修正...");

  const missingItems = diff.missing.map(d =>
    `- [${d.type}] "${d.value}" (${d.context}) — 请确保文中包含此项`
  ).join("\n");
  const alteredItems = diff.altered.map(d =>
    `- [${d.original.type}] "${d.original.value}" 被改为 "${d.found}" — 请恢复原值`
  ).join("\n");

  const correctionPrompt = `以下改写后的文章存在数据错误：

改写后文章：
${rewritten}

需要修正的问题：
${missingItems}
${alteredItems}

请修正上述所有问题，输出完整的修正版文章。严禁修改问题清单中未提及的内容。不要有任何解释。`;

  try {
    const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
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
    });

    const data = (await resp.json()) as any;
    const fixed = data?.choices?.[0]?.message?.content?.trim() || rewritten;
    console.log(`二次修正完成 (${fixed.length}字)`);

    // Re-validate
    const newDiff = validateFacts(fixed, originalFacts);
    // Event-only missing facts are descriptive methodology details that
    // get naturally rephrased — warn but don't block publishing.
    const blockingMissing = newDiff.missing.filter(f => f.type !== "event");
    const blockingAltered = newDiff.altered;

    if (newDiff.missing.length > 0) {
      const nonBlocking = newDiff.missing.filter(f => f.type === "event");
      if (nonBlocking.length > 0) {
        console.log(`⚠ 跳过 ${nonBlocking.length} 条事件描述差异（不影响发布）:`);
        for (const d of nonBlocking) {
          console.log(`  [${d.type}] ${d.value.substring(0, 60)}`);
        }
      }
    }

    if (blockingMissing.length > 0 || blockingAltered.length > 0) {
      console.log("⚠ 二次修正后仍有关键事实差异，终止发布");
      console.log("差异详情:");
      for (const d of blockingMissing) {
        console.log(`  缺失 [${d.type}] ${d.value} (${d.context})`);
      }
      for (const d of blockingAltered) {
        console.log(`  篡改 [${d.original.type}] ${d.original.value} → ${d.found}`);
      }
      throw new Error("VALIDATION_FAILED: 二次修正后仍有事实差异，终止发布");
    }
    console.log("✅ 二次修正通过事实校验");
    return fixed;
  } catch (err) {
    if ((err as Error).message.startsWith("VALIDATION_FAILED")) throw err;
    console.error("二次修正失败:", (err as Error).message);
    throw new Error("FIX_FAILED: DeepSeek 二次修正失败，终止发布");
  }
}

// ── Pipeline ──

export interface PipelineResult {
  finalContent: string;
  title: string;
  usedLLM: boolean;
  factCount: number;
}

export async function rewritePipeline(
  page: Page,
  url: string,
  category: Category | null
): Promise<PipelineResult> {
  // 1. Scrape
  const article = await scrapeArticle(page, url);

  // 1.5 Translate title if non-Chinese
  article.title = await translateTitle(article.title);

  // 2. Extract facts via DeepSeek (all categories, no exception)
  let facts: FactItem[] = [];
  try {
    facts = await extractFactsViaDeepSeek(article.content, article.title);
    console.log(`提取 ${facts.length} 条事实`);
  } catch (err) {
    // Fact extraction failed → abort, no publish
    console.error("事实提取失败，终止发布:", (err as Error).message);
    throw err;
  }

  // 3. Rewrite via DeepSeek with fact constraints
  let rewritten: string | null = null;
  try {
    rewritten = await rewriteViaDeepSeek(article.title, article.content, facts);
    if (!rewritten) {
      throw new Error("REWRITE_FAILED: DeepSeek 改写返回空内容，终止发布");
    }
  } catch (err) {
    console.error("改写失败，终止发布:", (err as Error).message);
    throw err;
  }

  // 4. Validate facts
  const diff = validateFacts(rewritten, facts);

  if (diff.missing.length > 0 || diff.altered.length > 0) {
    // 5. Attempt fix
    const fixed = await fixDiscrepancies(rewritten, facts, diff);
    return { finalContent: fixed, title: article.title, usedLLM: true, factCount: facts.length };
  }

  // 6. For 0-fact articles, check sentence count didn't collapse
  if (facts.length === 0 && !checkSentenceCount(article.content, rewritten)) {
    console.log("⚠ 原文无事实可提取，且改写后句数大幅减少，可能存在内容删减");
    // Non-blocking warning — still publish, but surface the concern
  }

  return { finalContent: rewritten, title: article.title, usedLLM: true, factCount: facts.length };
}

// ── Helpers ──

export function formatContentLists(html: string): string {
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
