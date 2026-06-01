import { CATEGORY_KEYWORDS, type Category } from "./category.js";

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
