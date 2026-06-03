import { chromium, Browser, BrowserContext, Page } from "playwright";
import { CONFIG } from "./config.js";

interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export async function createSession(): Promise<BrowserSession> {
  const url = `http://127.0.0.1:${CONFIG.CDP_PORT}`;

  // Check if Chrome CDP is already accessible
  let cdpAlive = false;
  try {
    const r = await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(2000) });
    cdpAlive = r.ok;
  } catch {}

  if (!cdpAlive) {
    const chrome = CONFIG.CHROME_PATH;
    throw new Error(
      "Chrome 调试端口未开启。请先用以下命令手动启动 Chrome:\n" +
      `"${chrome}" --remote-debugging-port=${CONFIG.CDP_PORT} --user-data-dir="${CONFIG.CHROME_DATA_DIR}"`
    );
  }

  console.log("复用已有 Chrome");

  // Connect (up to 10s)
  for (let i = 0; i < 10; i++) {
    try {
      const browser = await chromium.connectOverCDP(url, { timeout: 3000 });
      const context = browser.contexts().find(c => c.pages().length > 0) ?? browser.contexts()[0];
      const page = context.pages()[0] ?? (await context.newPage());
      console.log("已连接 Chrome");
      return { browser, context, page };
    } catch {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error("Chrome 连接超时，请确认 Chrome 已启动且端口 " + CONFIG.CDP_PORT + " 可用");
}

export async function closeSession(session: BrowserSession): Promise<void> {
  // Note: we don't close the page here — in preview mode the user needs to
  // see it, and in publish mode verification already completed. The Chrome
  // process stays alive with the user's profile tabs.
  void session;
}
