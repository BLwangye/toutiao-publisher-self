import { describe, it, expect } from "vitest";
import { getAngleDefinition, NARRATIVE_ANGLES, NarrativeAngle } from "../src/rewrite.js";

describe("NARRATIVE_ANGLES", () => {
  it("has exactly 4 angles", () => {
    expect(NARRATIVE_ANGLES).toHaveLength(4);
  });

  it("each angle has a key, label, and instruction", () => {
    for (const angle of NARRATIVE_ANGLES) {
      expect(angle.key).toBeTruthy();
      expect(angle.label).toBeTruthy();
      expect(angle.instruction).toBeTruthy();
      expect(angle.instruction.length).toBeGreaterThan(20);
    }
  });

  it("keys are unique", () => {
    const keys = NARRATIVE_ANGLES.map(a => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("getAngleDefinition", () => {
  it("returns the instruction for a valid angle key", () => {
    const inst = getAngleDefinition("why");
    expect(inst.label).toBe("追问解读型");
    expect(inst.instruction).toContain("原因");
  });

  it("returns event angle for unknown keys", () => {
    const inst = getAngleDefinition("nonexistent" as NarrativeAngle);
    expect(inst.key).toBe("event");
  });

  it("returns event angle for undefined", () => {
    const inst = getAngleDefinition(undefined);
    expect(inst.key).toBe("event");
  });
});
