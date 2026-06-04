import * as fs from "fs";
import * as path from "path";

export interface PendingArticle {
  title: string;
  content: string;
  category: string;
  topics: string[];
  source_url: string;
  narrative_angle: string;
  fact_count: number;
  generated_at: string;
}

function sanitizeTitleForFilename(title: string): string {
  return title
    .replace(/[/\\:*?"<>|]/g, "")
    .trim()
    .slice(0, 60);
}

export function buildFilename(article: PendingArticle, index: number): string {
  const date = article.generated_at.slice(0, 10);
  const paddedIndex = String(index).padStart(3, "0");
  const sanitizedTitle = sanitizeTitleForFilename(article.title);
  return `${date}-${paddedIndex}-${article.category}-${sanitizedTitle}.json`;
}

function defaultPendingDir(): string {
  return path.join(process.cwd(), "articles", "pending");
}

function defaultPublishedDir(): string {
  return path.join(process.cwd(), "articles", "published");
}

export async function saveArticle(
  article: PendingArticle,
  pendingDir?: string
): Promise<string> {
  const dir = pendingDir ?? defaultPendingDir();
  fs.mkdirSync(dir, { recursive: true });

  let nextIndex = 1;
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    const indices = files
      .map((f) => {
        const match = f.match(/^\d{4}-\d{2}-\d{2}-(\d+)-/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter((n) => !isNaN(n));
    if (indices.length > 0) {
      nextIndex = Math.max(...indices) + 1;
    }
  } catch {
    // Directory doesn't exist or is not readable — start at 1
  }

  const filename = buildFilename(article, nextIndex);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(article, null, 2), "utf-8");
  return filename;
}

export async function loadPendingArticles(
  pendingDir?: string
): Promise<{ filename: string; article: PendingArticle }[]> {
  const dir = pendingDir ?? defaultPendingDir();
  const results: { filename: string; article: PendingArticle }[] = [];

  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    for (const file of files) {
      const filePath = path.join(dir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const article = JSON.parse(content) as PendingArticle;
      results.push({ filename: file, article });
    }
  } catch {
    // Directory doesn't exist — return empty array
  }

  return results;
}

export async function archiveArticle(
  filename: string,
  pendingDir?: string,
  publishedDir?: string
): Promise<void> {
  const srcDir = pendingDir ?? defaultPendingDir();
  const dstDir = publishedDir ?? defaultPublishedDir();
  fs.mkdirSync(dstDir, { recursive: true });
  fs.renameSync(path.join(srcDir, filename), path.join(dstDir, filename));
}

export async function getPublishedSourceUrls(
  publishedDir?: string
): Promise<Set<string>> {
  const dir = publishedDir ?? defaultPublishedDir();
  const urls = new Set<string>();

  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const filePath = path.join(dir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const article = JSON.parse(content) as PendingArticle;
      if (article.source_url) {
        urls.add(article.source_url);
      }
    }
  } catch {
    // Directory doesn't exist — return empty set
  }

  return urls;
}
