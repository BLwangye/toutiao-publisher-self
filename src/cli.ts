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
