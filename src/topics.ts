import { CATEGORY_KEYWORDS, type Category } from "./category.js";
import * as child_process from "child_process";

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

export async function generateTopicsViaDeepSeek(content: string, title: string): Promise<string[]> {
  if (!DEEPSEEK_API_KEY) return [];

  const text = content.substring(0, 2000);
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
          { role: "system", content: "你是头条号话题专家。根据文章内容，生成8-10个适合今日头条的话题标签。每个话题2-6个字，必须是头条常见的热门话题。只输出话题，每行一个，不要编号、不要解释。" },
          { role: "user", content: `标题：${title}\n\n内容：${text}` },
        ],
        max_tokens: 100,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = (await resp.json()) as any;
    const raw = data?.choices?.[0]?.message?.content?.trim() || "";
    const topics = raw.split("\n").map((s: string) => s.replace(/^[\d\.\s#、]+/, "").trim()).filter(Boolean);
    return topics.slice(0, 5);
  } catch {
    return [];
  }
}

export function extractTopics(content: string, category: Category | null): string[] {
  const text = content.toLowerCase();
  const candidates: { word: string; len: number; pos: number }[] = [];

  // Scan keywords from the matched category first, then all categories
  const cats: (string | null)[] = [category, null];
  for (const cat of cats) {
    const keywords = cat ? CATEGORY_KEYWORDS[cat as Category] : Object.values(CATEGORY_KEYWORDS).flat();
    for (const kw of keywords) {
      const idx = text.indexOf(kw.toLowerCase());
      if (idx !== -1) {
        candidates.push({ word: kw, len: kw.length, pos: idx });
      }
    }
  }

  // Eliminate substrings: if "大模型" matched, drop "模型"
  const filtered = candidates.filter(a =>
    !candidates.some(b => a.word !== b.word && b.word.toLowerCase().includes(a.word.toLowerCase()))
  );

  // Prefer longer keywords, then later positions (more relevant to article body)
  filtered.sort((a, b) => b.len - a.len || b.pos - a.pos);

  return [...new Set(filtered.slice(0, 3).map(c => c.word))];
}

export function formatTopics(topics: string[]): string {
  if (topics.length === 0) return "";
  return topics.map(t => `#${t}`).join(" ");
}

export function appendTopics(contentHtml: string, topicsStr: string): string {
  if (!topicsStr) return contentHtml;
  return contentHtml + `<p>${topicsStr}</p>`;
}
