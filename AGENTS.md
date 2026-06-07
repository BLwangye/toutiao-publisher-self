# AGENTS.md

> **SKILLS FIRST**: 在做出任何回复（包括澄清问题）之前，必须先用 Skill 工具调用 `superpowers:using-superpowers` 检查是否有适用的技能。这不是可选的，即使只有 1% 的可能性也要检查。设计先于编码，测试先于实现，验证先于完成。

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Purpose

今日头条 (Toutiao) automated article publishing CLI. Uses Playwright CDP to connect to a user's existing Chrome browser session and automate the Toutiao content platform (mp.toutiao.com).

## Commands

```bash
npm run build          # TypeScript compilation (tsc)
npx tsx src/cli.ts ... # Run the CLI directly (no build needed)
npm test               # Run tests (vitest run in jsdom environment)
npm run test:watch     # Watch mode tests
```

## Architecture

**CLI entry**: `src/cli.ts` — orchestrates the full pipeline via Commander. All operations are sequential within a single CDP-connected browser session.

**Browser lifecycle** (`src/browser.ts`): Connects to an already-running Chrome via CDP on port 9222. The CLI does **not** launch Chrome — the user must start it manually with `--remote-debugging-port=9222`. Closing the session only closes the Page, never the BrowserContext, to preserve login cookies and extensions.

**Editor interaction** (`src/editor.ts`): Toutiao's editor is ProseMirror-based. Content is inserted via synthetic `ClipboardEvent("paste")` with `text/html` data — this routes through ProseMirror's paste handler, preserving `<strong>`, emoji, and other formatting. Topics are inserted by typing `#` to trigger the mention autocomplete popup, then clicking `.forum-list-item`.

**Publishing** (`src/publish.ts`): Click "预览并发布" → wait → click "确认发布" → verify via URL patterns (`/manage/content` or `/graphic/articles`). Retries up to 3 times.

**Image pipeline** (`src/jimeng.ts`): Generates images via Volcengine 即梦 API (HMAC-SHA256 signing with `VOLC_ACCESS_KEY`/`VOLC_SECRET_KEY`). Downloads to `images/<category>/` organized by detected category. Cover image upload (`src/images.ts`) navigates Toutiao's `.byte-drawer` upload UI.

**Content rewriting** (`src/rewrite.ts`): Multi-stage pipeline for `--from-url` mode:
1. Scrape article content from URL (strips non-content elements like captions, bylines, share buttons)
2. Extract key facts via DeepSeek structured JSON output (types: number, date, person, location, org, event)
3. Rewrite via DeepSeek with extracted facts injected as constraints ("严禁修改以下任何内容")
4. Validate rewritten output against original facts (exact match for most types, fuzzy CJK bigram matching for events/dates)
5. If discrepancies found, one correction attempt via DeepSeek. If still failing, **abort the entire publish** — no partial publishes.

**Interaction mode** (`src/interact.ts`): Fetches trending articles from 糖果梦 API/RSS (`src/trend.ts`) or scrapes toutiao.com homepage, generates comments via DeepSeek (or template-based fallback), likes and comments. Persistent dedup via `commented.json` with URL normalization.

**Category system** (`src/category.ts`): 18 categories with keyword dictionaries. Longest keyword match wins. Title is prefixed with `"分类> "` format (truncated to 30 chars total).

## Environment Variables

| Variable | Used by | Purpose |
|---|---|---|
| `VOLC_ACCESS_KEY` | `jimeng.ts` | Volcengine API key for image generation |
| `VOLC_SECRET_KEY` | `jimeng.ts` | Volcengine API secret for signing |
| `DEEPSEEK_API_KEY` | `interact.ts`, `rewrite.ts` | DeepSeek LLM for comments, fact extraction, rewriting |
| `TGMENG_LICENSE` | `trend.ts` | 糖果梦 trending API license |

On Windows, all env vars also fall back to user-level environment variables via PowerShell.

## Chrome Setup

The user must start Chrome manually before running the CLI:
```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\Users\bf131\.config\toutiao-chrome"
```

The Chrome profile must already be logged into mp.toutiao.com.

## Testing

Single test file `tests/editor.test.ts` — unit test verifying event dispatch order on mock DOM elements. Uses vitest with `jsdom` environment.

## Key Design Constraints

- **No auto-launch of Chrome** — the CLI only connects to an existing CDP port to avoid multi-instance profile conflicts.
- **Page-only close** — `closeSession` never closes the BrowserContext, so login state and extensions survive between runs.
- **Paste-based content insertion** — HTML is injected via synthetic clipboard paste events, not `innerHTML`, because ProseMirror ignores `innerHTML` changes.
- **Strict fact validation in rewrite** — if facts can't be verified after rewrite+fix, the pipeline throws and aborts. There is no degraded fallback that publishes unverified content.
