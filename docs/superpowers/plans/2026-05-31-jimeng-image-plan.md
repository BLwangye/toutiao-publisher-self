# 即梦AI图片生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 集成火山引擎即梦AI文生图4.0，生成配图后通过剪贴板粘贴插入头条编辑器正文，通过文件选择器设置封面。

**Architecture:** 新增 jimeng.ts 调用火山引擎 API（AK/SK HMAC-SHA256签名），下载图片到本地 `images/` 目录，editor.ts 新增 pasteImage 通过 DataTransfer 粘贴图片到 ProseMirror，cli.ts 串联生成→粘贴→发布流程。环境变量从 `process.env` 读取。

**Tech Stack:** TypeScript, Node.js crypto (HMAC-SHA256), Node.js fs, Playwright

---

## 文件结构

| 文件 | 动作 | 职责 |
|------|------|------|
| `src/jimeng.ts` | 新增 | 火山引擎签名 + CVProcess 请求 + 下载图片 |
| `src/editor.ts` | 修改 | 新增 pasteImage 函数 |
| `src/cli.ts` | 修改 | --image-keyword 触发生成→插入→封面流程 |
| `src/images.ts` | 修改 | setCover 改用本地图片文件上传 |

---

### Task 1: 即梦AI API 模块 (jimeng.ts)

**Files:** Create `src/jimeng.ts`, `images/` directory

- [ ] **Step 1: 创建 src/jimeng.ts**

```typescript
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { pipeline } from "stream/promises";

const API_HOST = "visual.volcengineapi.com";
const REGION = "cn-north-1";
const SERVICE = "cv";
const ACTION = "CVProcess";
const VERSION = "2022-08-31";
const IMAGE_DIR = path.join(process.cwd(), "images");

function sign(method: string, query: Record<string, string>, body: string): Record<string, string> {
  const ak = process.env.VOLC_ACCESS_KEY;
  const sk = process.env.VOLC_SECRET_KEY;
  if (!ak || !sk) throw new Error("Missing VOLC_ACCESS_KEY or VOLC_SECRET_KEY env vars");

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amzDate = dateStamp + "T" + now.toISOString().slice(11, 19).replace(/:/g, "") + "Z";

  const allQuery = { ...query, Action: ACTION, Version: VERSION };
  const sortedKeys = Object.keys(allQuery).sort();
  const canonicalQuery = sortedKeys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allQuery[k])}`).join("&");

  const headers: Record<string, string> = {
    "Host": API_HOST,
    "X-Date": amzDate,
    "Content-Type": "application/json",
  };
  const signedHeaders = Object.keys(headers).sort().map(k => k.toLowerCase()).join(";");
  const canonicalHeaders = Object.keys(headers).sort()
    .map(k => `${k.toLowerCase()}:${headers[k].trim()}`).join("\n");

  const payloadHash = crypto.createHash("sha256").update(body).digest("hex");

  const canonicalRequest = [
    method,
    "/",
    canonicalQuery,
    canonicalHeaders + "\n",
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    amzDate,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const kDate = crypto.createHmac("sha256", sk).update(dateStamp).digest();
  const kRegion = crypto.createHmac("sha256", kDate).update(REGION).digest();
  const kService = crypto.createHmac("sha256", kRegion).update(SERVICE).digest();
  const kSigning = crypto.createHmac("sha256", kService).update("request").digest();
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  headers["Authorization"] = `HMAC-SHA256 Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  headers["X-Content-Sha256"] = payloadHash;

  return headers;
}

export interface GenerateOptions {
  prompt: string;
  width?: number;
  height?: number;
}

export async function generateImage(options: GenerateOptions): Promise<string[]> {
  const { prompt, width = 1024, height = 1024 } = options;

  const body = JSON.stringify({
    req_key: "jimeng_t2i_v40",
    prompt,
    width,
    height,
    use_sr: false,
    return_url: true,
    logo_info: { add_logo: true, position: 0, language: 0, opacity: 1 },
  });

  const query: Record<string, string> = {};
  const headers = sign("POST", query, body);

  const url = `https://${API_HOST}/?${Object.entries({ ...query, Action: ACTION, Version: VERSION })
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`;

  const resp = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text}`);
  }

  const data = await resp.json() as any;
  if (data.ResponseMetadata?.Error) {
    throw new Error(`API error: ${data.ResponseMetadata.Error.Message}`);
  }

  const imageUrls: string[] = data.data?.image_urls ?? [];
  if (imageUrls.length === 0) throw new Error("No images returned from API");

  return imageUrls;
}

export async function downloadImages(urls: string[]): Promise<string[]> {
  if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

  const paths: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const ext = ".png";
    const filePath = path.join(IMAGE_DIR, `img_${Date.now()}_${i}${ext}`);
    const resp = await fetch(urls[i]);
    if (!resp.ok || !resp.body) throw new Error(`Download failed: ${resp.status}`);
    await pipeline(resp.body as any, fs.createWriteStream(filePath));
    paths.push(filePath);
    console.log(`图片已下载: ${filePath}`);
  }
  return paths;
}
```

- [ ] **Step 2: 验证编译**

```bash
cd D:\TouTiao; npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd D:\TouTiao; git add src/jimeng.ts; git commit -m "feat: add jimeng AI image generation module"
```

---

### Task 2: 正文图片粘贴 (editor.ts)

**Files:** Modify `src/editor.ts`

- [ ] **Step 1: 在 editor.ts 末尾添加 pasteImage 函数**

```typescript
import * as fs from "fs";
import * as path from "path";

export async function pasteImage(page: Page, imagePath: string): Promise<void> {
  const buffer = fs.readFileSync(imagePath);
  const base64 = buffer.toString("base64");
  const ext = path.extname(imagePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  const mime = mimeMap[ext] ?? "image/png";
  const dataUri = `data:${mime};base64,${base64}`;

  await page.evaluate((uri) => {
    const editor = document.querySelector(".ProseMirror");
    if (!editor) throw new Error("Editor not found");

    (editor as HTMLElement).focus();

    const dt = new DataTransfer();
    dt.setData("text/html", `<img src="${uri}" />`);

    const event = new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });

    editor.dispatchEvent(event);
  }, dataUri);

  const imgCount = await page.evaluate(() => {
    return document.querySelector(".ProseMirror")?.querySelectorAll("img").length ?? 0;
  });
  console.log(`图片已粘贴到正文 (共 ${imgCount} 张)`);
}
```

- [ ] **Step 2: 移除 editor.ts 中可能冲突的顶层 import（fs/path 已在函数内使用，无需顶层 import；buffer/base64 逻辑自包含）**

Note: `fs` and `path` imports needed: add at top of editor.ts:
```typescript
import * as fs from "fs";
import * as path from "path";
```

- [ ] **Step 3: 验证编译**

```bash
cd D:\TouTiao; npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd D:\TouTiao; git add src/editor.ts; git commit -m "feat: add pasteImage function for editor"
```

---

### Task 3: CLI 集成图片流程 (cli.ts)

**Files:** Modify `src/cli.ts`

- [ ] **Step 1: 修改 cli.ts，在正文注入后添加图片生成和粘贴步骤**

在 cli.ts 的 action 中，将 Step 5 改为：

```typescript
import { generateImage, downloadImages } from "./jimeng.js";

// ... inside action, after insertContent and before setCover:

      // Step 5: Generate and insert AI images
      if (options.images && options.imageKeyword) {
        console.log(`正在生成配图: ${options.imageKeyword}`);
        const urls = await generateImage({ prompt: options.imageKeyword });
        console.log(`生成了 ${urls.length} 张图片`);

        const paths = await downloadImages(urls);

        // Paste first image into editor body
        if (paths.length > 0) {
          await pasteImage(session.page, paths[0]);
        }

        // Use first image as cover if no separate cover keyword
        if (!options.coverKeyword && paths.length > 0) {
          console.log("使用配图作为封面");
          await setCover(session.page, paths[0]);
        }
      }

      // Step 6: Cover (only if separate cover keyword provided)
      if (options.images && options.coverKeyword && options.imageKeyword) {
        console.log(`正在生成封面图: ${options.coverKeyword}`);
        const coverUrls = await generateImage({ prompt: options.coverKeyword });
        const coverPaths = await downloadImages(coverUrls);
        if (coverPaths.length > 0) {
          await setCoverFile(session.page, coverPaths[0]);
        }
      } else if (!options.images || !options.imageKeyword) {
        // No images at all, select no cover
        const noCoverLabel = session.page.locator("label", { hasText: "无封面" }).first();
        await noCoverLabel.click();
        console.log("已选择无封面");
      }
```

- [ ] **Step 2: 更新 imports at top of cli.ts**

```typescript
import { generateImage, downloadImages } from "./jimeng.js";
```

Add `pasteImage` to editor import:
```typescript
import { typeTitle, insertContent, pasteImage } from "./editor.js";
```

- [ ] **Step 3: 验证编译**

```bash
cd D:\TouTiao; npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd D:\TouTiao; git add src/cli.ts; git commit -m "feat: integrate image generation into CLI flow"
```

---

### Task 4: 封面文件上传 (images.ts)

**Files:** Modify `src/images.ts`

- [ ] **Step 1: 新增 setCoverFile 函数接管封面设置**

在 images.ts 末尾添加：

```typescript
export async function setCoverFile(page: Page, imagePath: string): Promise<void> {
  console.log("正在设置封面图片...");

  // Select 单图 mode
  const singleImg = page.locator("label", { hasText: "单图" }).first();
  await singleImg.click();

  // Wait for upload area to appear
  await page.waitForTimeout(1000);

  // Find the file input or upload trigger
  // Strategy: listen for filechooser event, then click the upload trigger
  const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 10000 });

  // Try to trigger file chooser by clicking the cover preview area
  const coverPreview = page.locator('[class*="cover"] img, [class*="cover"] .upload, [class*="Cover"] img').first();
  try {
    await coverPreview.click({ timeout: 5000 });
  } catch {
    // Fallback: look for any element that triggers upload
    console.log("封面预览未找到，尝试其他方式...");
    await page.locator("label").filter({ hasText: "单图" }).click();
  }

  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(imagePath);
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
cd D:\TouTiao; git add src/images.ts; git commit -m "feat: add setCoverFile for local image upload"
```

---

### Task 5: VS Code workspace 环境变量

**Files:** Create `.vscode/settings.json`

- [ ] **Step 1: 确保 TypeScript 能读取 Node.js 环境变量类型**

无需创建新文件，只需确认 tsconfig 已包含 `"types": ["node"]`（已在 Task 2 添加）。

- [ ] **Step 2: 验证环境变量可读**

```bash
cd D:\TouTiao; npx tsx -e "console.log('AK:', process.env.VOLC_ACCESS_KEY ? 'SET' : 'MISSING'); console.log('SK:', process.env.VOLC_SECRET_KEY ? 'SET' : 'MISSING')" 2>&1
```

Expected: `AK: SET` / `SK: SET`

---

### Task 6: 最终验证

- [ ] **Step 1: 编译检查**

```bash
cd D:\TouTiao; npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 2: 单元测试**

```bash
cd D:\TouTiao; npx vitest run
```
Expected: 1 test PASS

- [ ] **Step 3: 端到端测试（需 Chrome + 登录 + AK/SK）**

```bash
cd D:\TouTiao; npx tsx src/cli.ts --title "图片功能测试" --content "<h2>测试</h2><p>这是一条带AI生成配图的测试文章。</p>" --image-keyword "旅行 风景 蓝天 白云"
```
Expected: 生成图片→下载→粘贴→发布成功

- [ ] **Step 4: Commit**

```bash
cd D:\TouTiao; git add -A; git commit -m "chore: final verification for image generation feature"
```
