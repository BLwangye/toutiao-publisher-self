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
  console.log(`已保存: ${filename}`);
  return filename;
}

export async function loadPendingArticles(
  pendingDir?: string
): Promise<{ filename: string; article: PendingArticle }[]> {
  const dir = pendingDir ?? defaultPendingDir();

  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const jsonFiles = files.filter(f => f.endsWith(".json")).sort();
  const results: { filename: string; article: PendingArticle }[] = [];
  for (const filename of jsonFiles) {
    try {
      const raw = fs.readFileSync(path.join(dir, filename), "utf-8");
      const article = JSON.parse(raw) as PendingArticle;
      results.push({ filename, article });
    } catch (err) {
      console.error(`⚠ 跳过损坏文件: ${filename} — ${(err as Error).message}`);
    }
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

  const src = path.join(srcDir, filename);
  if (!fs.existsSync(src)) {
    throw new Error(`File not found: ${src}`);
  }
  const dest = path.join(dstDir, filename);

  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      // Cross-device — copy then delete
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
    } else {
      throw err;
    }
  }

  console.log(`已归档: ${filename}`);
}

export async function getPublishedSourceUrls(
  publishedDir?: string
): Promise<Set<string>> {
  const dir = publishedDir ?? defaultPublishedDir();

  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    throw err;
  }

  const urls = new Set<string>();
  for (const filename of files) {
    if (!filename.endsWith(".json")) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, filename), "utf-8");
      const article = JSON.parse(raw) as PendingArticle;
      if (article.source_url) urls.add(article.source_url);
    } catch (err) {
      console.error(`⚠ 跳过损坏文件: ${filename} — ${(err as Error).message}`);
    }
  }
  return urls;
}
