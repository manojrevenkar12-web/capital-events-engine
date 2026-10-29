import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addBusinessDays, allocate, EngineError, easterSunday, isBusinessDay, Q, subtractBusinessDays } from "../src/index.js";

describe("rounding", () => {
  it("rounds half to even", () => {
    const r = (n: number, d: number) => Q.of(BigInt(n), BigInt(d)).round();
    expect([r(5, 2), r(7, 2), r(-5, 2), r(-7, 2), r(9, 4), r(11, 4), r(0, 1)]).toEqual([2n, 4n, -2n, -4n, 2n, 3n, 0n]);
  });
  it("floors negatives towards minus infinity", () => {
    expect(Q.of(-1n, 3n).floor()).toBe(-1n);
    expect(Q.of(-3n, 3n).floor()).toBe(-1n);
  });
});

describe("TARGET2 calendar", () => {
  it("computes Easter", () => {
    expect([2024, 2025, 2026, 2027, 2038].map(easterSunday)).toEqual([
      "2024-03-31",
      "2025-04-20",
      "2026-04-05",
      "2027-03-28",
      "2038-04-25",
    ]);
  });
  it("closes weekends and the six TARGET2 holidays", () => {
    const closed = ["2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-12-25", "2026-12-26", "2026-10-31"];
    expect(closed.map(isBusinessDay)).toEqual(closed.map(() => false));
    expect(isBusinessDay("2026-10-29")).toBe(true);
    expect(isBusinessDay("2026-10-03")).toBe(false); // a Saturday; German Unity Day is not a TARGET2 holiday
  });
  it("counts business days strictly after the start", () => {
    expect(addBusinessDays("2026-04-02", 1)).toBe("2026-04-07"); // over Easter
    expect(addBusinessDays("2026-12-23", 2)).toBe("2026-12-28");
    expect(addBusinessDays("2026-10-31", 0)).toBe("2026-10-31");
    expect(subtractBusinessDays("2026-04-07", 1)).toBe("2026-04-02");
  });
  it("adding then subtracting returns a business day at or before the start", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3000 }), fc.integer({ min: 1, max: 40 }), (off, n) => {
        const start = new Date(Date.UTC(2024, 0, 1) + off * 86_400_000).toISOString().slice(0, 10);
        const fwd = addBusinessDays(start, n);
        expect(isBusinessDay(fwd)).toBe(true);
        expect(subtractBusinessDays(fwd, n) <= start).toBe(true);
      }),
    );
  });
});

describe("allocate", () => {
  it("breaks ties by remainder, then weight, then id", () => {
    const r = allocate(
      10n,
      new Map([
        ["b", 1n],
        ["a", 1n],
        ["c", 1n],
      ]),
    );
    expect([...r.entries()].sort()).toEqual([
      ["a", 4n],
      ["b", 3n],
      ["c", 3n],
    ]);
    const w = allocate(
      1n,
      new Map([
        ["small", 1n],
        ["big", 3n],
      ]),
    );
    expect(w.get("big")).toBe(1n);
  });
  it("gives nothing to zero weights and fails when every weight is zero", () => {
    expect(
      allocate(
        5n,
        new Map([
          ["a", 0n],
          ["b", 2n],
        ]),
      ).get("a"),
    ).toBe(0n);
    expect(() => allocate(1n, new Map([["a", 0n]]))).toThrow(EngineError);
    expect(allocate(0n, new Map([["a", 0n]])).get("a")).toBe(0n);
  });
  it("sums exactly and stays within a cent of the exact share", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.array(fc.bigInt({ min: 0n, max: 10n ** 11n }), { minLength: 1, maxLength: 40 }),
        (amount, ws) => {
          fc.pre(ws.some((w) => w > 0n));
          const weights = new Map(ws.map((w, i) => [`lp${i}`, w]));
          const r = allocate(amount, weights);
          const total = ws.reduce((a, b) => a + b, 0n);
          expect([...r.values()].reduce((a, b) => a + b, 0n)).toBe(amount);
          for (const [k, v] of r) {
            const exact = Q.of(amount * (weights.get(k) ?? 0n), total);
            expect(Q.of(v).sub(exact).cmp(Q.ONE)).toBe(-1);
            expect(exact.sub(v).cmp(Q.ONE)).toBe(-1);
          }
        },
      ),
    );
  });
});
