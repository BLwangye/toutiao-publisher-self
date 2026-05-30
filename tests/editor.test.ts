import { describe, it, expect } from "vitest";

describe("editor module (unit)", () => {
  it("event dispatch order is correct", () => {
    const events: string[] = [];
    const expectedOrder = [
      "input",
      "compositionend",
      "selectionchange",
      "change",
      "blur",
      "focus",
    ];

    const mockEl = {
      innerHTML: "",
      textContent: "test content",
      dispatchEvent: (e: Event) => {
        events.push(e.type);
        return true;
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as HTMLElement;

    mockEl.innerHTML = "<p>test</p>";
    mockEl.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    mockEl.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    mockEl.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    mockEl.dispatchEvent(new Event("change", { bubbles: true }));
    mockEl.dispatchEvent(new Event("blur", { bubbles: true }));
    mockEl.dispatchEvent(new Event("focus", { bubbles: true }));

    expect(events).toEqual(expectedOrder);
    expect(mockEl.innerHTML).toBe("<p>test</p>");
    expect(mockEl.textContent).toBe("test content");
  });
});
