import { describe, expect, it } from "vitest";
import { score } from "../src/eval/score.js";
import { ground, RulesExtractor, sentences } from "../src/side-letters/extractor.js";

describe("side-letter extraction", () => {
  it("splits sentences without breaking clause numbers", () => {
    const s = sentences("1. First clause applies. 2.1 Second clause, see Clause 7.2 of the LPA.\nThird");
    expect(s.map((x) => x.s)).toContain("Third");
  });

  it("drops proposals whose quote is not in the letter", () => {
    const text = "The Management Fee shall be reduced by 25 basis points per annum.";
    const { kept, dropped } = ground(text, [
      {
        type: "FEE_DISCOUNT",
        params: { bps: 25 },
        category: "ECONOMIC",
        quote: "The Management Fee shall be reduced by 25 basis points per annum.",
        start: -1,
        end: -1,
      },
      {
        type: "FEE_DISCOUNT",
        params: { bps: 75 },
        category: "ECONOMIC",
        quote: "The Management Fee shall be waived entirely.",
        start: -1,
        end: -1,
      },
      {
        type: "FEE_DISCOUNT",
        params: { bps: -5 },
        category: "ECONOMIC",
        quote: "The Management Fee shall be reduced by 25 basis points per annum.",
        start: -1,
        end: -1,
      },
    ]);
    expect(kept).toHaveLength(1);
    expect(dropped.map((d) => d.why)).toEqual(["quote not found in the letter", "parameters do not validate"]);
    expect(text.slice(kept[0]?.start, kept[0]?.end)).toBe(kept[0]?.quote);
  });

  it("reads the development letters (a set we tune against, not a measurement)", async () => {
    const { score: s } = await score(new RulesExtractor(), new URL("./fixtures/side-letters-dev", import.meta.url).pathname);
    expect(s.misses).toEqual([]);
    expect(s.extras).toEqual([]);
    expect(s.categoryAccuracy).toBe(1);
  });
});
