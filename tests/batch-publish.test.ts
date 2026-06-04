import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { scanPendingFiles } from "../src/batch-publish.js";

const TEST_DIR = path.join(process.cwd(), "articles_batch_test");

describe("scanPendingFiles", () => {
  const pendingDir = path.join(TEST_DIR, "pending");

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(pendingDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  });

  it("returns empty array when no pending files", async () => {
    const files = await scanPendingFiles(pendingDir);
    expect(files).toEqual([]);
  });

  it("returns sorted JSON files only", async () => {
    fs.writeFileSync(path.join(pendingDir, "002-b.json"), JSON.stringify({ title: "B" }));
    fs.writeFileSync(path.join(pendingDir, "001-a.json"), JSON.stringify({ title: "A" }));
    fs.writeFileSync(path.join(pendingDir, "not-json.txt"), "not json");

    const files = await scanPendingFiles(pendingDir);
    expect(files).toHaveLength(2);
    expect(files[0]).toBe("001-a.json");
    expect(files[1]).toBe("002-b.json");
  });

  it("returns empty array when dir does not exist", async () => {
    const files = await scanPendingFiles(path.join(TEST_DIR, "nonexistent"));
    expect(files).toEqual([]);
  });
});
