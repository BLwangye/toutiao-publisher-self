// 糖果梦热榜数据 API
// Docs: https://open.tgmeng.com/docs/hotlist

import * as child_process from "child_process";

const API_URL = "https://trendapi.tgmeng.com/api/skill/search";
const TOUTIAO_RSS_URL = "https://tgmeng.com/news/toutiao/rss.xml";

export type QueryMode = "REALTIME" | "TODAY" | "HISTORY";

export interface HotItem {
  title: string;
  url: string;
  source: string;
  category: string;
  rootCategory: string;
  publishedAt: string;
  rank: number;
  simHash?: string;
}

export interface SearchOptions {
  keywords: string[];
  mode?: QueryMode;
  rootCategories?: string[];
  limit?: number;
  offset?: number;
  distinct?: boolean;
  startTime?: string;
  endTime?: string;
}

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

export async function searchHotItems(options: SearchOptions): Promise<HotItem[]> {
  const license = getEnv("TGMENG_LICENSE");
  if (!license) throw new Error("Missing TGMENG_LICENSE env var");

  const body = JSON.stringify({
    license,
    keywords: options.keywords,
    mode: options.mode ?? "REALTIME",
    rootCategories: options.rootCategories ?? null,
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
    distinct: options.distinct ?? true,
    startTime: options.startTime ?? null,
    endTime: options.endTime ?? null,
  });

  const resp = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    throw new Error(`API error ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json() as any;
  if (data.code !== 200) {
    throw new Error(`API error: ${data.message}`);
  }

  const items: HotItem[] = data.data?.items ?? [];
  return items;
}

// ── 头条热榜 RSS ──

export async function fetchToutiaoItems(): Promise<HotItem[]> {
  const seen = new Set<string>();
  const items: HotItem[] = [];

  // RSS feed: tgmeng.com/news/toutiao/rss.xml
  try {
    const resp = await fetch(TOUTIAO_RSS_URL, { signal: AbortSignal.timeout(15000) });
    if (resp.ok) {
      const xml = await resp.text();
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;
      while ((match = itemRegex.exec(xml)) !== null) {
        const block = match[1];
        const titleMatch = block.match(/<title>[\s\S]*?<!\[CDATA\[(.*?)\]\]>[\s\S]*?<\/title>/);
        const linkMatch = block.match(/<link>(.*?)<\/link>/);
        if (!titleMatch || !linkMatch) continue;
        let title = titleMatch[1].trim();
        const url = linkMatch[1].trim();
        if (seen.has(url)) continue;
        seen.add(url);
        title = title.replace(/\s*-\s*来自【\s*头条\s*】\s*$/, "");
        items.push({ title, url, source: "头条热榜", category: "", rootCategory: "", publishedAt: "", rank: items.length + 1 });
      }
    }
  } catch {}

  return items;
}
