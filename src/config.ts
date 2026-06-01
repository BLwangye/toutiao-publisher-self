export const CONFIG = {
  PUBLISH_URL: "https://mp.toutiao.com/profile_v4/graphic/publish",
  LOGIN_URL: "https://mp.toutiao.com",
  DEFAULT_TIMEOUT: 30_000,
  AI_LOAD_TIMEOUT: 50_000,
  PUBLISH_RETRY: 3,
  PUBLISH_RETRY_INTERVAL: 2_000,
  CHROME_PATH: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  CDP_PORT: 9222,
  CHROME_DATA_DIR: "C:\\Users\\baifa\\.config\\toutiao-chrome",
} as const;

export const SELECTORS = {
  TITLE_INPUT: 'textarea[placeholder*="请输入文章标题"]',
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
