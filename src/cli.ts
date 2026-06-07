import { Command } from "commander";
import { createSession, closeSession } from "./browser.js";
import { ensureLogin } from "./login.js";
import { typeTitle, insertContent, insertTopics, pasteImage } from "./editor.js";
import { interactArticles } from "./interact.js";
import { selfCommentPipeline } from "./self-comment.js";
import { setDeclarations, publishArticle } from "./publish.js";
import { detectCategory, formatTitle, CATEGORY_KEYWORDS } from "./category.js";
import { extractTopics, formatTopics, generateTopicsViaDeepSeek } from "./topics.js";
import { rewritePipeline, formatContentLists } from "./rewrite.js";
import { detectSuggestions, clickSuggestionImage } from "./suggestions.js";
import { generateImage, downloadImages } from "./jimeng.js";
import { CONFIG } from "./config.js";
import * as fs from "fs";
import * as path from "path";

const program = new Command();
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function findReusableImages(category: string | null, count: number): string[] {
  const roots: string[] = [];
  if (category) roots.push(path.join(process.cwd(), "images", category));
  roots.push(path.join(process.cwd(), "images"));

  const files: { file: string; mtime: number }[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!IMAGE_EXTS.has(path.extname(entry.name).toLowerCase()) || seen.has(full)) continue;
        seen.add(full);
        files.push({ file: full, mtime: fs.statSync(full).mtimeMs });
      }
    }
  }

  return files
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, count)
    .map((item) => item.file);
}

program
  .name("toutiao-publisher")
  .description("今日头条文章自动发布工具")
  .option("--title <title>", "文章标题")
  .option("--content <html>", "文章正文 (HTML 格式)")
  .option("--image-keyword <keyword>", "AI 配图关键词，逗号分隔多张")
  .option("--image-category <category>", "图片分类：科技/财经/社会/生活/出行/娱乐/体育")
  .option("--cover-keyword <keyword>", "封面图关键词")
  .option("--no-images", "跳过图片步骤")
  .option("--reuse-images", "复用images/中已有图片，不重新生成")
  .option("--image-files <paths>", "指定图片文件，逗号分隔，第一张为封面")
  .option("--image-count <number>", "复用图片数量", "3")
  .option("--interact", "执行互动模式（点赞+评论）")
  .option("--interact-count <number>", "互动文章数量", "5")
  .option("--no-declarations", "跳过声明设置")
  .option("--no-topics", "跳过话题标签")
  .option("--category <name>", "模块归属 (自动检测或手动指定)")
  .option("--from-url <url>", "从指定 URL 抓取原文并改写后发布")
  .option("--preview", "仅填充内容不发布，供人工预览")
  .option("--self-comment", "为自己已发布文章撰写种子评论")
  .option("--self-comment-index <number>", "自评论文章编号（跳过交互选择）")
  .action(async (options) => {
    const session = await createSession();
    let exitCode = 1;
    try {
      // Step 1: Login check
      const loggedIn = await ensureLogin(session.page);
      if (!loggedIn) {
        console.error("登录失败，退出");
        return;
      }

      // ---- Interact mode ----
      if (options.interact) {
        const count = parseInt(options.interactCount);
        await interactArticles(session.page, count);
        exitCode = 0;
        return;
      }

      // ---- Self-comment mode ----
      if (options.selfComment) {
        const idx = options.selfCommentIndex ? parseInt(options.selfCommentIndex) : undefined;
        await selfCommentPipeline(session.page, idx);
        exitCode = 0;
        return;
      }

      // ---- Rewrite mode (from-url) ----
      if (options.fromUrl) {
        console.log(`\n=== 抓取原文并改写 ===`);
        console.log(`URL: ${options.fromUrl}`);

        const result = await rewritePipeline(
          session.page,
          options.fromUrl,
          options.category as import("./category.js").Category ?? null
        );
        options.title = result.title;
        options.content = result.finalContent;
        console.log(`标题: ${result.title}`);
        console.log(`使用 LLM: ${result.usedLLM ? "是" : "否"}`);
        console.log(`事实校验: ${result.factCount} 条全部通过`);
        console.log(`=== 改写完成 ===\n`);
      }

      // ---- Publish mode ----
      if (!options.title || !options.content) {
        console.error("请指定 --title 和 --content，或使用 --from-url");
        return;
      }

      // Step 2: Open publish page
      console.log("打开发布页面...");
      await session.page.goto(CONFIG.PUBLISH_URL, {
        waitUntil: "domcontentloaded",
        timeout: CONFIG.DEFAULT_TIMEOUT,
      });
      await session.page.waitForTimeout(5000);

      // Step 3: Detect category and format title
      const category = options.category
        ? (options.category as import("./category.js").Category)
        : detectCategory(options.title, options.content);
      const displayTitle = formatTitle(options.title, category ?? null);
      console.log(`模块归属: ${category ?? "无"}, 显示标题: ${displayTitle}`);

      // Step 4: Type title
      await typeTitle(session.page, displayTitle);

      // Step 5: Insert content
      let contentHtml = formatContentLists(options.content);
      await insertContent(session.page, contentHtml);

      // Step 6: Images
      let bodyImageCount = 0;
      const requestedImageCount = Math.max(1, parseInt(options.imageCount, 10) || 3);
      let imageFiles = typeof options.imageFiles === "string"
        ? options.imageFiles.split(",").map((p: string) => p.trim()).filter(Boolean)
        : [];

      if (options.images === false) {
        console.log("已跳过图片步骤");
      } else if (imageFiles.length > 0) {
        // Explicit files win over generated/reused images.
      } else if (options.reuseImages) {
        imageFiles = findReusableImages(category ?? null, requestedImageCount);
        if (imageFiles.length > 0) {
          console.log(`复用本地图片: ${imageFiles.length} 张`);
        } else {
          console.log("未找到可复用图片，改用头条建议配图");
        }
      } else if (typeof options.imageKeyword === "string" && options.imageKeyword.trim()) {
        const keywords = options.imageKeyword.split(",").map((kw: string) => kw.trim()).filter(Boolean);
        const selectedKeywords = keywords.slice(0, requestedImageCount);
        const generated: string[] = [];
        for (const keyword of selectedKeywords) {
          console.log(`生成配图: ${keyword}`);
          const urls = await generateImage({ prompt: keyword });
          const downloaded = await downloadImages(urls.slice(0, 1), keyword, options.imageCategory ?? category ?? undefined);
          generated.push(...downloaded);
        }
        imageFiles = generated.slice(0, requestedImageCount);
      }

      if (options.images === false) {
        // handled above
      } else if (imageFiles.length > 0) {
        console.log(`使用指定图片文件: ${imageFiles.length} 张`);
        await session.page.evaluate(() => {
          const pm = document.querySelector(".ProseMirror");
          if (!pm) return;
          const sel = window.getSelection();
          if (!sel) return;
          const range = document.createRange();
          range.selectNodeContents(pm);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        });
        await session.page.waitForTimeout(200);

        for (const imagePath of imageFiles) {
          await session.page.keyboard.press("Enter");
          await session.page.waitForTimeout(200);
          await pasteImage(session.page, imagePath);
          bodyImageCount++;
        }
        console.log(`${bodyImageCount} 张指定图片已插入正文`);
      } else {
        const suggestion = await detectSuggestions(session.page);
        if (suggestion.imageCount === 0) {
          console.log("无建议配图");
        }

        // Smart image placement based on heading count (ProseMirror: h2→h1)
        const headingCount = await session.page.evaluate(() => {
          const pm = document.querySelector(".ProseMirror");
          if (!pm) return 0;
          const h1 = pm.querySelectorAll("h1").length;
          const h2 = pm.querySelectorAll("h2").length;
          return Math.max(h1, h2);
        });
        console.log(`  编辑器标题数: ${headingCount}`);

        // Decide insertion plan: [end] or [before heading N]
        type InsertPlan = { position: "end" } | { position: "beforeHeading"; headingIdx: number };
        const plans: InsertPlan[] = [];
        if (headingCount >= 3) {
          // 3+ headings: 2 images, before 2nd and 3rd headings
          plans.push({ position: "beforeHeading", headingIdx: 1 });
          plans.push({ position: "beforeHeading", headingIdx: 2 });
        } else if (headingCount === 2) {
          // 2 headings: 1 image before 2nd heading
          plans.push({ position: "beforeHeading", headingIdx: 1 });
        } else {
          // 0-1 headings: 1 image at end of article
          plans.push({ position: "end" });
        }

        for (let i = 0; i < plans.length; i++) {
          const plan = plans[i];
          if (plan.position === "end") {
            console.log("在正文末尾插入配图...");
            await session.page.evaluate(() => {
              const pm = document.querySelector(".ProseMirror");
              if (!pm) return;
              const sel = window.getSelection();
              if (!sel) return;
              const range = document.createRange();
              range.selectNodeContents(pm);
              range.collapse(false);
              sel.removeAllRanges();
              sel.addRange(range);
            });
            await session.page.waitForTimeout(200);
            await session.page.keyboard.press("Enter");
            await session.page.waitForTimeout(300);
          } else {
            console.log(`在第 ${plan.headingIdx + 1} 个标题前插入配图...`);
            const placed = await session.page.evaluate((hIdx) => {
              const pm = document.querySelector(".ProseMirror");
              if (!pm) return false;
              let headings = pm.querySelectorAll("h1");
              if (headings.length <= hIdx) headings = pm.querySelectorAll("h2");
              if (headings.length <= hIdx) return false;
              const prev = headings[hIdx].previousElementSibling;
              if (!prev) return false;
              const sel = window.getSelection();
              if (!sel) return false;
              const range = document.createRange();
              range.selectNodeContents(prev);
              range.collapse(false);
              sel.removeAllRanges();
              sel.addRange(range);
              return true;
            }, plan.headingIdx);

            if (!placed) { console.log(`  找不到位置，跳过`); continue; }
            await session.page.waitForTimeout(200);
            await session.page.keyboard.press("Enter");
            await session.page.waitForTimeout(300);
          }

          const ok = await clickSuggestionImage(session.page, i);
          if (ok) { bodyImageCount++; console.log(`  插入成功`); }
          else { console.log(`  插入失败`); }
        }
        if (bodyImageCount > 0) console.log(`${bodyImageCount} 张配图已插入正文`);
      }

      // Step 7: Topics — DeepSeek generates candidates, #-search, failed ones removed
      if (options.topics === false) {
        console.log("已跳过话题标签");
      } else {
        let topicLabels = await generateTopicsViaDeepSeek(options.content, options.title);
        if (topicLabels.length < 3) {
          // Pad with keyword matching fallbacks
          const fallbacks = extractTopics(options.content, category ?? null);
          for (const f of fallbacks) {
            if (!topicLabels.includes(f)) topicLabels.push(f);
          }
        }
        if (topicLabels.length > 0) {
          console.log(`话题候选 (${topicLabels.length}): ${formatTopics(topicLabels)}`);
          const inserted = await insertTopics(session.page, topicLabels);
          if (inserted < 3) {
            console.log(`仅匹配 ${inserted} 个话题，尝试补充...`);
            // Try category keywords as extra fallback
            const extras = (CATEGORY_KEYWORDS[category ?? "健康"] || [])
              .filter(kw => !topicLabels.includes(kw))
              .slice(0, 5);
            if (extras.length > 0) {
              await insertTopics(session.page, extras);
            }
          }
        } else {
          console.log("未检测到话题关键词");
        }
      }

      // Step 8: Cover — select "单图", first body image becomes cover
      if (bodyImageCount > 0) {
        console.log("选择单图封面...");
        const singleLabel = session.page.locator("label", { hasText: "单图" }).first();
        await singleLabel.scrollIntoViewIfNeeded();
        await singleLabel.click({ force: true });
        await session.page.waitForTimeout(2000);
        console.log("已选择单图封面（默认使用正文第一张配图）");
      } else {
        const noCoverLabel = session.page.locator("label", { hasText: "无封面" }).first();
        await noCoverLabel.click({ force: true });
        console.log("已选择无封面");
      }

      // Step 9: Declarations
      if (options.declarations) {
        await setDeclarations(session.page);
      }

      // Step 9: Publish (skip if preview mode)
      if (options.preview) {
        console.log("=== 预览模式：内容已填入，请在浏览器中审核后手动发布 ===");
        exitCode = 0;
      } else {
        const success = await publishArticle(session.page);
        if (success) {
          console.log("=== 发布完成 ===");
          exitCode = 0;
        } else {
          console.error("=== 发布失败 ===");
        }
      }
    } catch (err) {
      console.error("发布过程出错:", err);
    } finally {
      try {
        await closeSession(session);
      } catch (err) {
        console.error("关闭浏览器会话失败:", err);
      }
    }
    process.exit(exitCode);
  });

program.parse();
