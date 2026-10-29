import { describe, expect, it } from "vitest";
import { fingerprintCells, shortHash } from "../src/lib/fingerprint";
import { formatCents, parseEuros, ratio, sumCents } from "../src/lib/money";

describe("money stays in integer cents", () => {
  it("formats without floats, including amounts past 2^53", () => {
    expect(formatCents("123456789")).toBe("€1,234,567.89");
    expect(formatCents("-5")).toBe("−€0.05");
    expect(formatCents("90071992547409931")).toBe("€900,719,925,474,099.31");
    expect(formatCents("90127500000", { compact: true })).toBe("€901.27m");
  });
  it("parses what people type and refuses what is not an amount", () => {
    expect(parseEuros("12,500,000")).toBe("1250000000");
    expect(parseEuros("€ 1,250.5")).toBe("125050");
    expect(parseEuros("0.07")).toBe("7");
    for (const bad of ["", "abc", "1.234", "-5", "0", "1e6"]) expect(parseEuros(bad)).toBeNull();
  });
  it("sums and compares exactly", () => {
    expect(sumCents(["9007199254740993", "1"])).toBe(9007199254740994n);
    expect(ratio("1", "3")).toBeCloseTo(0.3333, 4);
    expect(ratio("1", "0")).toBe(0);
  });
});

describe("result fingerprint", () => {
  it("is mirror-symmetric and changes when the hash changes", () => {
    const a = fingerprintCells("2f2b6d05572ee999663927dbd913ebad491818cb925951b377b6ed257f5670f1");
    const b = fingerprintCells("3f2b6d05572ee999663927dbd913ebad491818cb925951b377b6ed257f5670f1");
    expect(a).toHaveLength(36);
    for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) expect(a[r * 6 + c]).toBe(a[r * 6 + 5 - c]);
    expect(a).not.toEqual(b);
    expect(shortHash("2f2b6d05aa")).toBe("2f2b 6d05");
  });
});
