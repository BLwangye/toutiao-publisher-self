// 糖果梦热榜数据 API
// Docs: https://open.tgmeng.com/docs/hotlist

import * as child_process from "child_process";

const API_URL = "https://trendapi.tgmeng.com/api/skill/search";

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
