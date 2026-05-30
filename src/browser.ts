import { chromium, Browser, BrowserContext, Page } from "playwright";

const CDP_URL = "http://localhost:9222";

interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export async function createSession(): Promise<BrowserSession> {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.newPage());

  return { browser, context, page };
}

export async function closeSession(session: BrowserSession): Promise<void> {
  await session.context.close();
}
