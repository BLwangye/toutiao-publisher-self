import { Command } from "commander";
import * as fs from "fs";
import { createSession, closeSession } from "./browser.js";
import { ensureLogin } from "./login.js";
import { typeTitle, insertContent } from "./editor.js";
import { setCoverFile } from "./images.js";
import { generateImage, downloadImages } from "./jimeng.js";
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
    let exitCode = 1;
    try {
      // Step 1: Login check
      const loggedIn = await ensureLogin(session.page);
      if (!loggedIn) {
        console.error("登录失败，退出");
        return;
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

      // Generate images before inserting content
      let imagePaths: string[] = [];
      let coverPath = "";

      if (options.images && options.imageKeyword) {
        const keywords = options.imageKeyword.split(",").map((k: string) => k.trim()).filter(Boolean);
        console.log(`正在生成 ${keywords.length} 张配图: ${keywords.join(" | ")}`);

        for (const kw of keywords) {
          const urls = await generateImage({ prompt: kw });
          console.log(`  关键词"${kw}"生成了 ${urls.length} 张`);
          const paths = await downloadImages(urls);
          imagePaths.push(...paths);
        }

        if (imagePaths.length > 0) coverPath = imagePaths[0];
        console.log(`${imagePaths.length} 张图片已就绪`);
      }

      // Step 4: Set cover BEFORE content (use no-cover if cover upload isn't needed)
      if (coverPath) {
        console.log("使用第一张配图作为封面");
        try {
          await setCoverFile(session.page, coverPath);
        } catch (err) {
          console.log("封面自动设置失败，使用无封面:", (err as Error).message);
          const noCoverLabel = session.page.locator("label", { hasText: "无封面" }).first();
          await noCoverLabel.click();
        }
      } else if (!options.images) {
        const noCoverLabel = session.page.locator("label", { hasText: "无封面" }).first();
        await noCoverLabel.click();
        console.log("已选择无封面");
      }

      // Step 5: Insert content
      await insertContent(session.page, options.content);

      // Step 6: Paste images between h1 sections
      if (imagePaths.length > 0) {
        console.log("正在插入配图...");
        const uris = imagePaths.map(p => {
          const buf = fs.readFileSync(p);
          const ext = p.split(".").pop()?.toLowerCase() ?? "png";
          const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
          return `data:${mime};base64,${buf.toString("base64")}`;
        });

        const h2Count = await session.page.evaluate(() => document.querySelectorAll(".ProseMirror h1").length);
        const pasteCount = Math.min(h2Count, uris.length);

        for (let i = 0; i < pasteCount; i++) {
          await session.page.locator(`.ProseMirror h1 >> nth=${i}`).click();
          await session.page.keyboard.press("End");
          await session.page.keyboard.press("Enter");
          await session.page.waitForTimeout(300);

          await session.page.evaluate((uri) => {
            const editor = document.querySelector(".ProseMirror");
            if (!editor) return;
            const dt = new DataTransfer();
            dt.setData("text/html", `<img src="${uri}" style="max-width:100%"/>`);
            editor.dispatchEvent(new ClipboardEvent("paste", {
              clipboardData: dt,
              bubbles: true,
              cancelable: true,
            }));
          }, uris[i]);
          await session.page.waitForTimeout(500);
        }

        console.log(`${pasteCount} 张图片已插入正文`);
      } else if (!options.images) {
        const noCoverLabel = session.page.locator("label", { hasText: "无封面" }).first();
        await noCoverLabel.click();
        console.log("已选择无封面");
      }

      // Step 7: Declarations
      if (options.declarations) {
        await setDeclarations(session.page);
      }

      // Step 8: Publish
      const success = await publishArticle(session.page);
      if (success) {
        console.log("=== 发布完成 ===");
        exitCode = 0;
      } else {
        console.error("=== 发布失败 ===");
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
