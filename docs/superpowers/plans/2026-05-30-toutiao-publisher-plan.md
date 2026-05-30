# Toutiao Publisher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现今日头条文章自动发布 CLI 工具，通过 opencode Skill 调度 + TypeScript/Playwright 浏览器自动化完成从标题到发布的完整流程。

**Architecture:** 两层架构：1) opencode SKILL.md 定义触发词和流程 2) TypeScript/Playwright 脚本实现具体浏览器操作。浏览器复用本地 Chrome profile 保持登录态，通过 JS 注入操作 ProseMirror 编辑器。

**Tech Stack:** TypeScript, Node.js + tsx, Playwright (launchPersistentContext), commander, vitest + jsdom

---

**页面结构参考（基于原仓库实测）：**
- 发布页 URL: `https://mp.toutiao.com/profile_v4/graphic/publish`
- 标题输入框: `input[placeholder*="标题"]`
- 正文编辑器: `.ProseMirror`
- AI 创作助手按钮: 文本包含 "AI"
- 封面区域: 文本包含 "封面"
- 免费正版图库: 文本包含 "免费正版图片"
- 声明复选框: `[role="checkbox"]` 中文本匹配 "头条首发" / "引用 AI"
- 声明单选框: 文本匹配 "个人观点"
- 发布按钮: button 文本包含 "预览并发布"
- 确认发布按钮: button 文本包含 "确认发布"
- 验证 URL: 包含 `/manage/content` 或 `/graphic/articles`

---

## 文件结构

| 文件 | 职责 |
|---|------|
| `package.json` | 项目配置、依赖、scripts |
| `tsconfig.json` | TypeScript 编译配置 |
| `src/config.ts` | 常量、超时配置、URL |
| `src/browser.ts` | Playwright 启动/连接管理 |
| `src/login.ts` | 登录态检测与引导 |
| `src/editor.ts` | 标题输入、正文 HTML 注入 |
| `src/images.ts` | AI 配图、封面设置 |
| `src/publish.ts` | 发布流程与验证 |
| `src/cli.ts` | CLI 入口 |
| `SKILL.md` | opencode 技能文档 |
| `tests/editor.test.ts` | editor 模块单元测试 |

---

### Task 1: 项目初始化

**Files:** Create `package.json`, `tsconfig.json`, `src/config.ts`

- [ ] **Step 1: 初始化 package.json**

```bash
cd D:\TouTiao; npm init -y
```

- [ ] **Step 2: 安装依赖**

```bash
cd D:\TouTiao; npm install playwright commander zod
cd D:\TouTiao; npm install -D typescript @types/node tsx vitest jsdom
```

- [ ] **Step 3: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: 创建 src/config.ts**

```typescript
export const CONFIG = {
  PUBLISH_URL: "https://mp.toutiao.com/profile_v4/graphic/publish",
  LOGIN_URL: "https://mp.toutiao.com",
  DEFAULT_TIMEOUT: 30_000,
  AI_LOAD_TIMEOUT: 50_000,
  PUBLISH_RETRY: 3,
  PUBLISH_RETRY_INTERVAL: 2_000,
} as const;

export const SELECTORS = {
  TITLE_INPUT: 'input[placeholder*="标题"]',
  EDITOR: ".ProseMirror",
  PUBLISH_BTN: "预览并发布",
  CONFIRM_BTN: "确认发布",
  AI_ASSISTANT: "AI",
  DECLARATION_TOUTIAO_FIRST: "头条首发",
  DECLARATION_PERSONAL_VIEW: "个人观点",
  DECLARATION_CITE_AI: "引用 AI",
  FREE_STOCK_IMAGE: "免费正版图片",
} as const;

export const VERIFY_URL_PATTERNS = ["/manage/content", "/graphic/articles"] as const;
```

- [ ] **Step 5: 更新 package.json scripts**

Edit `package.json` to add:

```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "npx tsx src/cli.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Run: `cd D:\TouTiao; npx tsc --noEmit` — 应无错误

- [ ] **Step 6: Commit**

```bash
cd D:\TouTiao; git init; git add .; git commit -m "chore: project init with config and dependencies"
```

---

### Task 2: 浏览器模块 (browser.ts)

**Files:** Create `src/browser.ts`

- [ ] **Step 1: 创建 browser.ts**

```typescript
import { chromium, Browser, BrowserContext, Page } from "playwright";
import * as path from "path";
import * as os from "os";

const USER_DATA_DIR = path.join(
  os.homedir(),
  "AppData",
  "Local",
  "Google",
  "Chrome",
  "User Data"
);

interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export async function createSession(): Promise<BrowserSession> {
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
  });

  let page = context.pages()[0] ?? (await context.newPage());

  const browser = context.browser()!;

  return { browser, context, page };
}

export async function closeSession(session: BrowserSession): Promise<void> {
  await session.context.close();
}
```

- [ ] **Step 2: 验证编译**

```bash
cd D:\TouTiao; npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd D:\TouTiao; git add src/browser.ts; git commit -m "feat: add browser session management"
```

---

### Task 3: 登录模块 (login.ts)

**Files:** Create `src/login.ts`

- [ ] **Step 1: 创建 login.ts**

```typescript
import { Page } from "playwright";
import { CONFIG } from "./config.js";

export async function ensureLogin(page: Page): Promise<boolean> {
  await page.goto(CONFIG.LOGIN_URL, { waitUntil: "domcontentloaded" });

  const loggedIn = await page.evaluate(() => {
    const userLink = document.querySelector<HTMLAnchorElement>(
      'a[href*="toutiao.com/c/user"]'
    );
    return userLink ? userLink.textContent?.trim() ?? null : null;
  });

  if (loggedIn) {
    console.log(`已登录: ${loggedIn}`);
    return true;
  }

  console.log("未登录，请在浏览器中手动登录（扫码或账号密码）");
  console.log("登录完成后按此窗口的任意键继续...");

  // Wait for URL to change to a logged-in page
  await page.waitForURL((url) => {
    return (
      url.hostname === "mp.toutiao.com" &&
      !url.pathname.includes("/login") &&
      !url.pathname.includes("/auth")
    );
  }, { timeout: 120_000 });

  console.log("登录成功");
  return true;
}
```

- [ ] **Step 2: 验证编译**

```bash
cd D:\TouTiao; npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd D:\TouTiao; git add src/login.ts; git commit -m "feat: add login state check and manual login flow"
```

---

### Task 4: 编辑器模块 (editor.ts)

**Files:** Create `src/editor.ts`, `tests/editor.test.ts`

- [ ] **Step 1: 创建 editor.ts**

```typescript
import { Page } from "playwright";
import { CONFIG, SELECTORS } from "./config.js";

export async function typeTitle(
  page: Page,
  title: string
): Promise<void> {
  const input = page.locator(SELECTORS.TITLE_INPUT);
  await input.waitFor({ state: "visible", timeout: CONFIG.DEFAULT_TIMEOUT });
  await input.click();
  await input.fill(title);
  console.log(`标题输入完成: ${title}`);
}

export async function insertContent(
  page: Page,
  html: string
): Promise<void> {
  const editor = page.locator(SELECTORS.EDITOR);
  await editor.waitFor({ state: "visible", timeout: CONFIG.DEFAULT_TIMEOUT });
  await editor.click();

  await editor.evaluate((el, htmlContent) => {
    el.innerHTML = htmlContent;

    el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    el.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));

    el.dispatchEvent(new Event("blur", { bubbles: true }));
    el.dispatchEvent(new Event("focus", { bubbles: true }));
  }, html);

  const length = await editor.evaluate((el) => el.textContent?.length ?? 0);
  console.log(`正文注入完成，共 ${length} 字`);
}
```

- [ ] **Step 2: 创建 tests/editor.test.ts**

```typescript
import { describe, it, expect } from "vitest";

describe("editor module (unit)", () => {
  it("event dispatch order is correct", () => {
    const events: string[] = [];
    const expectedOrder = [
      "input",
      "compositionend",
      "selectionchange",
      "change",
      "blur",
      "focus",
    ];

    const mockEl = {
      innerHTML: "",
      textContent: "test content",
      dispatchEvent: (e: Event) => {
        events.push(e.type);
        return true;
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as HTMLElement;

    mockEl.innerHTML = "<p>test</p>";
    mockEl.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    mockEl.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    mockEl.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    mockEl.dispatchEvent(new Event("change", { bubbles: true }));
    mockEl.dispatchEvent(new Event("blur", { bubbles: true }));
    mockEl.dispatchEvent(new Event("focus", { bubbles: true }));

    expect(events).toEqual(expectedOrder);
    expect(mockEl.innerHTML).toBe("<p>test</p>");
    expect(mockEl.textContent).toBe("test content");
  });
});
```

- [ ] **Step 3: 运行测试验证通过**

```bash
cd D:\TouTiao; npx vitest run
```
Expected: 1 test PASS

- [ ] **Step 4: 验证编译**

```bash
cd D:\TouTiao; npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd D:\TouTiao; git add src/editor.ts tests/editor.test.ts; git commit -m "feat: add editor module with title input and content injection"
```

---

### Task 5: 图片模块 (images.ts)

**Files:** Create `src/images.ts`

- [ ] **Step 1: 创建 images.ts**

```typescript
import { Page } from "playwright";
import { CONFIG } from "./config.js";

export async function insertAIImage(
  page: Page,
  keyword: string
): Promise<void> {
  console.log("正在打开 AI 创作助手...");

  const aiBtn = page.locator("button, span", { hasText: "AI" }).first();
  await aiBtn.waitFor({ state: "visible", timeout: CONFIG.DEFAULT_TIMEOUT });
  await aiBtn.click();

  // Wait for AI panel to load
  const aiPanel = page.locator(".ai-panel, [class*=\"ai\"], [class*=\"AI\"]").first();
  try {
    await aiPanel.waitFor({ state: "visible", timeout: CONFIG.AI_LOAD_TIMEOUT });
  } catch {
    console.log("AI 面板可能已打开，继续...");
  }
  await page.waitForTimeout(3000);

  // Type keyword into AI input
  const aiInput = page.locator("input, textarea").last();
  await aiInput.fill(keyword);
  console.log(`AI 关键词输入: ${keyword}`);

  // Wait for recommendations
  await page.waitForTimeout(5000);

  // Click first recommended image
  const recommendedImage = page.locator("img").first();
  try {
    await recommendedImage.click({ timeout: 10000 });
    console.log("已插入 AI 推荐图片");
  } catch {
    console.log("未找到 AI 推荐图片，跳过");
  }
}

export async function setCover(
  page: Page,
  keyword: string
): Promise<void> {
  console.log("正在设置封面图片...");

  // Click cover area
  const coverArea = page.locator("text=封面").first();
  await coverArea.scrollIntoViewIfNeeded();
  await coverArea.click();
  await page.waitForTimeout(1000);

  // Click "免费正版图片"
  const freeStockBtn = page.locator("text=免费正版图片").first();
  await freeStockBtn.waitFor({ state: "visible", timeout: CONFIG.DEFAULT_TIMEOUT });
  await freeStockBtn.click();
  await page.waitForTimeout(2000);

  // Search
  const searchInput = page.locator("input[placeholder*=\"搜索\"]").first();
  await searchInput.fill(keyword);
  await page.waitForTimeout(3000);

  // Select first image
  const firstImage = page.locator("img").first();
  await firstImage.click({ timeout: 10000 });
  await page.waitForTimeout(1000);

  // Confirm
  const confirmBtn = page.locator("button", { hasText: "确定" }).first();
  await confirmBtn.click();
  await page.waitForTimeout(3000);
  console.log("封面设置完成");
}
```

- [ ] **Step 2: 验证编译**

```bash
cd D:\TouTiao; npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd D:\TouTiao; git add src/images.ts; git commit -m "feat: add AI image insertion and cover setting"
```

---

### Task 6: 发布模块 (publish.ts)

**Files:** Create `src/publish.ts`

- [ ] **Step 1: 创建 publish.ts**

```typescript
import { Page } from "playwright";
import { CONFIG, SELECTORS, VERIFY_URL_PATTERNS } from "./config.js";

export async function setDeclarations(page: Page): Promise<void> {
  await page.evaluate(() => {
    const checkboxes = document.querySelectorAll<HTMLElement>('[role="checkbox"]');

    for (const el of checkboxes) {
      if (el.textContent?.includes("头条首发")) {
        el.click();
      }
      if (el.textContent?.includes("引用 AI")) {
        el.click();
      }
    }

    const allElements = document.querySelectorAll<HTMLElement>("*");
    for (const el of allElements) {
      if (el.textContent?.includes("个人观点") && el.getAttribute("role") === "radio") {
        el.click();
        break;
      }
    }
  });

  console.log("声明设置完成");
}

export async function clickPublish(page: Page): Promise<void> {
  console.log("点击发布...");

  // Click "预览并发布"
  await page.evaluate((btnText) => {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>("button, a, span, div"));
    const btn = buttons.find(
      (b) => b.textContent?.includes(btnText) && b.offsetParent !== null
    );
    if (btn) {
      btn.scrollIntoView();
      btn.click();
      return true;
    }
    return false;
  }, SELECTORS.PUBLISH_BTN);

  // Wait for preview to load
  await page.waitForTimeout(3000);

  // Click "确认发布"
  await page.evaluate((btnText) => {
    const buttons = Array.from(
      document.querySelectorAll<HTMLElement>("button, a, span, div")
    );
    const btn = buttons.find(
      (b) =>
        (b.textContent?.includes(btnText) || b.textContent?.includes("立即发布")) &&
        b.offsetParent !== null
    );
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }, SELECTORS.CONFIRM_BTN);

  console.log("已确认发布");
}

export async function verifyPublish(page: Page): Promise<boolean> {
  await page.waitForTimeout(5000);

  const result = await page.evaluate((patterns) => {
    const url = window.location.href;
    for (const pattern of patterns) {
      if (url.includes(pattern)) return true;
    }
    return false;
  }, VERIFY_URL_PATTERNS as readonly string[]);

  if (result) {
    console.log("发布成功！当前 URL:", page.url());
  } else {
    console.error("发布验证失败，当前 URL:", page.url());
  }

  return result;
}

export async function publishArticle(
  page: Page,
  retries: number = CONFIG.PUBLISH_RETRY
): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    await clickPublish(page);
    const ok = await verifyPublish(page);
    if (ok) return true;

    console.log(`发布验证失败，重试 ${i + 1}/${retries}...`);
    await page.waitForTimeout(CONFIG.PUBLISH_RETRY_INTERVAL);
  }
  return false;
}
```

- [ ] **Step 2: 验证编译**

```bash
cd D:\TouTiao; npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd D:\TouTiao; git add src/publish.ts; git commit -m "feat: add publish flow with declarations, clickPublish, and verification"
```

---

### Task 7: CLI 入口 (cli.ts)

**Files:** Create `src/cli.ts`

- [ ] **Step 1: 创建 cli.ts**

```typescript
import { Command } from "commander";
import { createSession, closeSession } from "./browser.js";
import { ensureLogin } from "./login.js";
import { typeTitle, insertContent } from "./editor.js";
import { insertAIImage, setCover } from "./images.js";
import { setDeclarations, publishArticle } from "./publish.js";
import { CONFIG } from "./config.js";

const program = new Command();

program
  .name("toutiao-publisher")
  .description("今日头条文章自动发布工具")
  .requiredOption("--title <title>", "文章标题")
  .requiredOption("--content <html>", "文章正文 (HTML 格式)")
  .option("--image-keyword <keyword>", "AI 配图关键词")
  .option("--cover-keyword <keyword>", "封面图关键词")
  .option("--no-images", "跳过图片步骤")
  .option("--no-declarations", "跳过声明设置")
  .action(async (options) => {
    const session = await createSession();

    try {
      // Step 1: Login check
      const loggedIn = await ensureLogin(session.page);
      if (!loggedIn) {
        console.error("登录失败，退出");
        process.exit(1);
      }

      // Step 2: Open publish page
      console.log("打开发布页面...");
      await session.page.goto(CONFIG.PUBLISH_URL, {
        waitUntil: "domcontentloaded",
        timeout: CONFIG.DEFAULT_TIMEOUT,
      });
      await session.page.waitForTimeout(5000);

      // Step 3: Type title
      await typeTitle(session.page, options.title);

      // Step 4: Insert content
      await insertContent(session.page, options.content);

      // Step 5: AI images
      if (options.images && options.imageKeyword) {
        await insertAIImage(session.page, options.imageKeyword);
      }

      // Step 6: Cover
      if (options.images && options.coverKeyword) {
        await setCover(session.page, options.coverKeyword);
      }

      // Step 7: Declarations
      if (options.declarations) {
        await setDeclarations(session.page);
      }

      // Step 8: Publish
      const success = await publishArticle(session.page);
      if (success) {
        console.log("=== 发布完成 ===");
        process.exit(0);
      } else {
        console.error("=== 发布失败 ===");
        process.exit(1);
      }
    } catch (err) {
      console.error("发布过程出错:", err);
      process.exit(1);
    } finally {
      await closeSession(session);
    }
  });

program.parse();
```

- [ ] **Step 2: 验证编译**

```bash
cd D:\TouTiao; npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd D:\TouTiao; git add src/cli.ts; git commit -m "feat: add CLI entry point with full publish pipeline"
```

---

### Task 8: opencode Skill 文档 (SKILL.md)

**Files:** Create `SKILL.md`

- [ ] **Step 1: 创建 SKILL.md**

```markdown
---
name: toutiao-publisher
version: 1.0.0
description: 自动发布文章到今日头条。触发词：发头条、发布头条、今日头条、发文章、写头条。
---

# 今日头条自动发布

## 触发词
发头条、发布头条、今日头条、发文章、写头条

## 前置条件
1. 用户已安装 Chrome 并在其中登录过头条号 (mp.toutiao.com)
2. 项目已安装依赖: `cd D:\TouTiao && npm install`

## 发布流程

### 使用方式

```bash
cd D:\TouTiao && npx tsx src/cli.ts --title "标题" --content "<p>正文</p>"
```

### 完整参数

```bash
npx tsx src/cli.ts \
  --title "文章标题" \
  --content "<h1>段落</h1><p>正文内容</p>" \
  --image-keyword "科技 电脑" \
  --cover-keyword "科技"
```

### 跳过可选步骤

```bash
# 跳过图片
npx tsx src/cli.ts --title "标题" --content "<p>正文</p>" --no-images

# 跳过声明
npx tsx src/cli.ts --title "标题" --content "<p>正文</p>" --no-declarations
```

## publish-toutiao.sh 一键脚本

为了方便 AI 调用，提供 Shell 包装脚本:

```bash
#!/bin/bash
# publish-toutiao.sh - 一键发布包装脚本

TITLE="${1:-默认标题}"
CONTENT="${2:-<p>默认内容</p>}"
IMAGE_KEYWORD="${3:-科技}"
COVER_KEYWORD="${4:-科技}"

cd D:\TouTiao
npx tsx src/cli.ts \
  --title "$TITLE" \
  --content "$CONTENT" \
  --image-keyword "$IMAGE_KEYWORD" \
  --cover-keyword "$COVER_KEYWORD"
```

## 子技能触发

当用户提供了标题和内容时，AI 应直接执行发布命令。当用户只提供主题时，AI 先生成内容再发布。

## 错误处理

- 登录超时: 提示用户手动登录浏览器
- 元素找不到: 提示检查头条后台页面是否更新
- 发布失败: 提示检查内容是否完整、网络是否正常
```

- [ ] **Step 2: Commit**

```bash
cd D:\TouTiao; git add SKILL.md; git commit -m "feat: add opencode skill document"
```

---

### Task 9: 最终验证

**Files:** None (verification only)

- [ ] **Step 1: 完整编译检查**

```bash
cd D:\TouTiao; npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 2: 运行单元测试**

```bash
cd D:\TouTiao; npx vitest run
```
Expected: 1 test PASS

- [ ] **Step 3: Commit final state**

```bash
cd D:\TouTiao; git add -A; git commit -m "chore: final verification - build and tests pass"
