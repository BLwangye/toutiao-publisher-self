import { chromium, Browser, BrowserContext, Page } from "playwright";
import { CONFIG } from "./config.js";
import { exec } from "child_process";

interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export async function createSession(): Promise<BrowserSession> {
  const url = `http://127.0.0.1:${CONFIG.CDP_PORT}`;

  // Check if Chrome is already running on CDP port
  let alive = false;
  try {
    const r = await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(2000) });
    alive = r.ok;
  } catch {}

  if (!alive) {
    const chrome = CONFIG.CHROME_PATH;
    const dataDir = CONFIG.CHROME_DATA_DIR;
    console.log(`启动 Chrome...`);

    // Start Chrome detached, don't wait
    const cmd = `"${chrome}" --remote-debugging-port=${CONFIG.CDP_PORT} --user-data-dir="${dataDir}"`;
    exec(cmd, (err) => {
      if (err) console.error("Chrome 启动失败:", err.message);
    });

    // Wait up to 15s for Chrome to become ready
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const r = await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(1000) });
        if (r.ok) break;
      } catch {}
    }
  }

  // Connect (up to 10s)
  for (let i = 0; i < 10; i++) {
    try {
      const browser = await chromium.connectOverCDP(url, { timeout: 3000 });
      const context = browser.contexts()[0];
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
  await session.context.close();
}
