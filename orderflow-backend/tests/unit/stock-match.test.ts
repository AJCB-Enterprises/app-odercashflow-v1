import { describe, expect, it } from "vitest";
import { findOutOfStockMatch } from "../../src/lib/stock-match";

const products = [
  { description: "Blue Widget", in_stock: false },
  { description: "Red Gadget", in_stock: true },
  { description: "Green Gizmo", in_stock: true },
];

describe("findOutOfStockMatch", () => {
  it("treats the same name as an exact match, ignoring case, punctuation, spacing and plurals", () => {
    for (const d of ["Blue Widget", "  blue   widget ", "BLUE-WIDGET", "Blue Widgets"])
      expect(findOutOfStockMatch(d, products)).toEqual({ product: "Blue Widget", similar: false });
  });

  it("flags reordered words as similar", () => {
    expect(findOutOfStockMatch("Widget, Blue", products)).toEqual({ product: "Blue Widget", similar: true });
  });

  it("tolerates a one-letter typo on a longer word", () => {
    expect(findOutOfStockMatch("Blue Widgit", products)).toEqual({ product: "Blue Widget", similar: true });
  });

  it("flags a line with an extra qualifier or two", () => {
    expect(findOutOfStockMatch("Blue Widget 10mm", products)?.similar).toBe(true);
    expect(findOutOfStockMatch("Blue Widget Large 10mm", products)?.similar).toBe(true);
  });

  it("does not flag unrelated or in-stock items", () => {
    expect(findOutOfStockMatch("Green Gizmo", products)).toBeNull();
    expect(findOutOfStockMatch("Red Gadget", products)).toBeNull();
    expect(findOutOfStockMatch("Something else entirely", products)).toBeNull();
    expect(findOutOfStockMatch("", products)).toBeNull();
  });

  it("does not match on a single shared word or a short-word near miss", () => {
    expect(findOutOfStockMatch("Widget", products)).toBeNull();
    expect(findOutOfStockMatch("Rod Gadget", products)).toBeNull();
  });

  it("stays quiet when the line is clearly a different, in-stock product", () => {
    const list = [
      { description: "Blue Widget", in_stock: false },
      { description: "Blue Widget Large", in_stock: true },
    ];
    expect(findOutOfStockMatch("Blue Widget Large", list)).toBeNull();
    expect(findOutOfStockMatch("blue widget large", list)).toBeNull();
    expect(findOutOfStockMatch("Blue Widget", list)).toEqual({ product: "Blue Widget", similar: false });
  });
});
