const key = "74c2b98f-c930-4883-872a-8a6923b72e3a";

const sources = ["baidu", "toutiao", "tencent", "weibo", "wangyi"];

for (const src of sources) {
  try {
    const r = await fetch(`https://trendapi.tgmeng.com/api/topsearch/${src}`, {
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(10000),
    });
    const raw = await r.json();
    const items = raw?.data?.dataInfo || [];
    console.log(`\n=== ${src} (${items.length}条) ===`);
    for (const item of items.slice(0, 5)) {
      console.log(`  🔥 ${item.title}  (热度:${item.hotScore || "-"})`);
    }
  } catch (e: any) {
    console.log(`[ERR] ${src}: ${e.message?.substring(0, 60)}`);
  }
}
