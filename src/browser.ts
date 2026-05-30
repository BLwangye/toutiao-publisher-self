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
