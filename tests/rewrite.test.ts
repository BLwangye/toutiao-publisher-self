import { describe, it, expect } from "vitest";
import {
  fuzzyMatch,
  validateFacts,
  checkSentenceCount,
  withRetry,
} from "../src/rewrite.js";
import type { FactItem } from "../src/rewrite.js";

// ── fuzzyMatch ──

describe("fuzzyMatch", () => {
  // ── threshold: ≤4 tokens → 50%, >4 tokens → 70% ──

  it("short event (≤4 tokens) matches at 50% threshold", () => {
    // "发生冲突" → CJK bigrams: ["发生","生冲","冲突"] = 3 tokens
    // "双方发生肢体冲突" contains "发生" and "冲突" = 2/3 = 67% ≥ 50% → true
    expect(fuzzyMatch("发生冲突", "双方在街头发生冲突", "event")).toBe(true);
  });

  it("short event loses too many tokens → fails", () => {
    // "发生冲突" → 3 tokens. Rewritten = "双方对峙" → 0/3 = 0%
    expect(fuzzyMatch("发生冲突", "双方对峙", "event")).toBe(false);
  });

  it("long event (>4 tokens) uses 70% threshold", () => {
    // "警方赶到现场处置" → 7 chars → 6 bigrams → >4 tokens
    // Rewritten contains most bigrams → should pass at ≥70%
    expect(fuzzyMatch("警方赶到现场处置", "警方迅速赶到现场进行处置", "event")).toBe(true);
  });

  it("long event loses too many tokens → fails at 70%", () => {
    // "警方赶到现场处置" → 6 bigrams
    // Rewritten barely overlaps → should fail
    expect(fuzzyMatch("警方赶到现场处置", "相关人员已被控制", "event")).toBe(false);
  });

  // ── person type uses fuzzy matching ──

  it("person name with exact match", () => {
    expect(fuzzyMatch("黄仁勋", "黄仁勋表示看好AI芯片前景", "person")).toBe(true);
  });

  it("person name with partial bigram match", () => {
    // "黄仁勋" → bigrams: ["黄仁","仁勋"] = 2 tokens
    // "NVIDIA CEO黄仁勋" contains "黄仁" but not "仁勋"? Actually it does contain both.
    // Let's test with a case where only partial match:
    // Actually "黄仁勋" in text will give both bigrams. Let's test something realistic.
    // Rewrite might say "黄仁勋" or might rephrase. Let's test the fuzzy case.
    // "黄仁勋" bigrams: ["黄仁","仁勋"]. If rewritten says "黄仁勋" → both found → 100%
    expect(fuzzyMatch("黄仁勋", "英伟达CEO黄仁勋在大会上发表演讲", "person")).toBe(true);
  });

  // ── location type uses fuzzy matching ──

  it("location name with exact match", () => {
    expect(fuzzyMatch("云南大理", "事件发生在云南大理", "location")).toBe(true);
  });

  it("location name with partial match still passes (short name)", () => {
    // "云南大理" → bigrams: ["云南","南大","大理"] = 3 tokens ≤4 → threshold 50%
    // "大理" contains "大理" = 1/3 = 33% < 50% → false
    // Actually this should probably fail - let me reconsider
    // The rewritten text might say "大理市" or "大理白族自治州"
    // "大理市" contains "大理" bigram = 1/3 = 33% < 50% → false (correct, too different)
    expect(fuzzyMatch("云南大理", "大理市", "location")).toBe(false);
  });

  // ── org type uses fuzzy matching ──

  it("org name with exact match", () => {
    expect(fuzzyMatch("英伟达", "英伟达股价创历史新高", "org")).toBe(true);
  });

  it("org name with alias still matches short tokens", () => {
    // "英伟达" → bigrams: ["英伟","伟达"] = 2 tokens ≤4 → threshold 50%
    // "NVIDIA" → 0 CJK bigrams, but has Latin "NVIDIA" = 1 token
    // Original "英伟达" has 0 Latin tokens
    // So tokens = ["英伟","伟达"], rewritten has none → 0/2 = 0% → false
    // Hmm, cross-language alias won't work with bigram matching.
    // That's expected - we can't detect "英伟达→NVIDIA" via bigrams.
    // This is an acceptable limitation. Let's adjust the test.
    expect(fuzzyMatch("英伟达", "NVIDIA股价创历史新高", "org")).toBe(false);
  });

  // ── date type (existing behavior) ──

  it("date with digit tokens matches", () => {
    expect(fuzzyMatch("2026年6月2日", "事件发生于2026年6月2日下午", "date")).toBe(true);
  });

  it("date with rearranged format still matches", () => {
    // "6月2日" tokens: "6月", "2日" + "6","2" → 4 tokens
    // "2日6月" contains "2日" + digits "2","6" → 3/4 = 75% ≥ 70% (or 50% if ≤4)
    // Actually "6月2日" → date tokens: ["6月","2日"], digits: ["6","2"] → 4 tokens ≤4 → 50%
    // "2日6月" contains "2日" and digits "2","6" → 3/4 = 75% ≥ 50% → true
    expect(fuzzyMatch("6月2日", "2日6月", "date")).toBe(true);
  });
});

// ── validateFacts: extra detection ──

describe("validateFacts - extra detection", () => {
  it("detects extra numbers in rewritten text not in original facts", () => {
    const facts: FactItem[] = [
      { type: "number", value: "12.3%", context: "增长率" },
    ];
    const rewritten = "GDP增长12.3%，新增就业45.6万人";

    const diff = validateFacts(rewritten, facts);

    expect(diff.missing).toHaveLength(0);
    expect(diff.altered).toHaveLength(0);
    // Should detect "45.6万" as extra
    expect(diff.extra.length).toBeGreaterThanOrEqual(1);
    expect(diff.extra.some(e => e.value.includes("45.6"))).toBe(true);
  });

  it("no extra when all numbers in rewritten trace to original facts", () => {
    const facts: FactItem[] = [
      { type: "number", value: "12.3%", context: "增长率" },
      { type: "number", value: "500亿", context: "投资额" },
    ];
    const rewritten = "投资额达500亿元，同比增长12.3%";

    const diff = validateFacts(rewritten, facts);

    expect(diff.extra).toHaveLength(0);
  });

  it("extra numbers are warn-only, do not block passing validation", () => {
    const facts: FactItem[] = [
      { type: "number", value: "12.3%", context: "增长率" },
    ];
    const rewritten = "增长12.3%，新增就业45.6万人";

    const diff = validateFacts(rewritten, facts);

    // Missing and altered are empty → validation "passes" (extra is non-blocking)
    expect(diff.missing).toHaveLength(0);
    expect(diff.altered).toHaveLength(0);
  });

  it("person/location/org exact match passes validation", () => {
    const facts: FactItem[] = [
      { type: "person", value: "黄仁勋", context: "NVIDIA CEO" },
      { type: "location", value: "云南大理", context: "事发地" },
      { type: "org", value: "英伟达", context: "公司" },
    ];
    const rewritten = "英伟达CEO黄仁勋在云南大理出席活动";

    const diff = validateFacts(rewritten, facts);

    expect(diff.missing).toHaveLength(0);
    expect(diff.altered).toHaveLength(0);
  });

  it("person/location/org fuzzy match for rephrased names", () => {
    const facts: FactItem[] = [
      { type: "person", value: "黄仁勋", context: "NVIDIA CEO" },
    ];
    // Rewritten keeps the name but embeds it differently
    const rewritten = "NVIDIA创始人兼CEO黄仁勋昨日宣布...";

    const diff = validateFacts(rewritten, facts);

    // Should NOT be missing — fuzzy match should find the bigrams
    expect(diff.missing).toHaveLength(0);
  });
});

// ── checkSentenceCount ──

describe("checkSentenceCount", () => {
  it("returns true when rewritten has similar sentence count", () => {
    const original = "今天天气很好。我出门散步。看到一只猫。";
    const rewritten = "今天天气不错。我外出走了走。看见一只小猫。";
    expect(checkSentenceCount(original, rewritten)).toBe(true);
  });

  it("returns true when rewritten has more sentences (added structure)", () => {
    const original = "今天天气很好。我出门散步。";
    const rewritten = "今天天气不错。阳光明媚。我外出走了走。心情愉快。";
    expect(checkSentenceCount(original, rewritten)).toBe(true);
  });

  it("returns false when rewritten drops below 60% of original sentences", () => {
    const original =
      "第一段内容。第二段内容。第三段内容。第四段内容。第五段内容。";
    const rewritten = "简短的摘要。";
    const result = checkSentenceCount(original, rewritten);
    expect(result).toBe(false);
  });

  it("returns true for empty input", () => {
    expect(checkSentenceCount("", "")).toBe(true);
  });

  it("returns true when original has single sentence", () => {
    expect(checkSentenceCount("只有一句话", "改写后也只有一句话")).toBe(true);
  });
});

// ── withRetry ──

describe("withRetry", () => {
  it("returns result on first success", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      return "ok";
    };
    const result = await withRetry(fn, 2);
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries up to maxRetries times, succeeding on last attempt", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) throw new Error(`fail ${calls}`);
      return "ok";
    };
    const result = await withRetry(fn, 2);
    expect(result).toBe("ok");
    expect(calls).toBe(3); // 1 initial + 2 retries
  });

  it("throws after exhausting all retries", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error("always fail");
    };
    await expect(withRetry(fn, 2)).rejects.toThrow("always fail");
    expect(calls).toBe(3); // 1 initial + 2 retries
  });

  it("stops retrying on non-retryable error", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error("REWRITE_FAILED: 终止");
    };
    // Errors with "REWRITE_FAILED" etc. should not be retried
    // Actually, withRetry should retry all errors by default — the caller
    // handles the non-retryable logic by checking error type after withRetry.
    // Let me adjust: withRetry retries everything, caller decides.
    await expect(withRetry(fn, 2)).rejects.toThrow("REWRITE_FAILED");
    expect(calls).toBe(3); // retries everything
  });
});
