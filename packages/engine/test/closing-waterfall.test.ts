import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { distribute, equalise, feederCall, growth, mfnEligible, type Provision, Q } from "../src/index.js";

const terms = { feeRateBps: 200, investmentPeriodEnd: "2029-01-01" };

describe("equalisation", () => {
  it("makes a late LP pay its share with interest, refunded to the others", () => {
    const lps = [
      { id: "A", commitment: 1_000_000_00n, excuseSectors: [], feeDiscountBps: 0 },
      { id: "B", commitment: 1_000_000_00n, excuseSectors: [], feeDiscountBps: 0 },
    ];
    const lines = equalise(terms, "2026-07-01", 600, lps, [
      { kind: "investment", dueDate: "2026-01-01", sectors: [], paid: new Map([["A", 200_000_00n]]) },
    ]);
    const a = lines.get("A");
    const b = lines.get("B");
    expect(b?.capitalDelta).toBe(100_000_00n);
    expect(a?.capitalDelta).toBe(-100_000_00n);
    // 100k at 6% for 181 days
    expect(b?.interestPaid).toBe(Q.of(100_000_00n * 600n * 181n, 10_000n * 365n).round());
    expect(a?.interestReceived).toBe(b?.interestPaid);
    expect((a?.net ?? 0n) + (b?.net ?? 0n)).toBe(0n);
  });

  it("conserves capital and interest across any closing", () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 1n, max: 10n ** 9n }), { minLength: 2, maxLength: 12 }),
        fc.array(fc.record({ amount: fc.bigInt({ min: 0n, max: 10n ** 8n }), daysBack: fc.integer({ min: 0, max: 900 }) }), {
          minLength: 1,
          maxLength: 5,
        }),
        (commitments, calls) => {
          const lps = commitments.map((c, i) => ({ id: `lp${i}`, commitment: c, excuseSectors: [], feeDiscountBps: 0 }));
          const early = lps.slice(0, Math.max(1, Math.floor(lps.length / 2)));
          const prior = calls.map((c) => {
            const paid = new Map(
              [...early.entries()].map(([, l]) => [l.id, (c.amount * l.commitment) / early.reduce((s, x) => s + x.commitment, 0n)]),
            );
            const due = new Date(Date.UTC(2026, 6, 1) - c.daysBack * 86_400_000).toISOString().slice(0, 10);
            return { kind: "expense" as const, dueDate: due, paid };
          });
          const lines = [...equalise(terms, "2026-07-01", 800, lps, prior).values()];
          expect(lines.reduce((s, l) => s + l.capitalDelta, 0n)).toBe(0n);
          expect(lines.reduce((s, l) => s + l.interestPaid, 0n)).toBe(lines.reduce((s, l) => s + l.interestReceived, 0n));
        },
      ),
    );
  });
});

describe("European waterfall", () => {
  const lp = {
    id: "A",
    dealContribution: 1_000_000_00n,
    carryDiscountBps: 0,
    contributions: [{ date: "2020-01-01", amount: 1_000_000_00n }],
    distributions: [],
    priorRoc: 0n,
    priorPref: 0n,
    priorCatchUp: 0n,
  };

  it("returns capital, pays 8% compounded, catches up and splits 80/20", () => {
    const line = distribute("2023-01-01", 2_000_000_00n, 800, 2000, [lp]).get("A");
    expect(line).toMatchObject({
      roc: 1_000_000_00n,
      pref: 259_712_00n, // 1.08^3 − 1
      catchUp: 64_928_00n,
      gpSplit: 135_072_00n,
      lpSplit: 540_288_00n,
      gpTotal: 200_000_00n, // exactly 20% of the 1m profit
    });
  });

  it("accrues simply between anniversaries and handles 29 February", () => {
    expect(growth(800, "2024-02-29", "2025-02-28").toString()).toBe("27/25");
    expect(growth(800, "2026-01-01", "2026-07-02").cmp(Q.of(108n, 100n))).toBe(-1);
  });

  it("applies a carry discount from a side letter", () => {
    const line = distribute("2023-01-01", 2_000_000_00n, 800, 2000, [{ ...lp, carryDiscountBps: 500 }]).get("A");
    expect(line?.gpTotal).toBe(150_000_00n);
  });

  it("always splits gross between LP and GP", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 10n }), fc.integer({ min: 0, max: 3000 }), (amount, carry) => {
        const line = distribute("2023-01-01", amount, 800, carry, [lp]).get("A");
        expect((line?.lpTotal ?? 0n) + (line?.gpTotal ?? 0n)).toBe(amount);
      }),
    );
  });
});

describe("feeder", () => {
  it("flags a bridge when the feeder cannot collect before the master's due date", () => {
    const lps = [{ id: "F1", commitment: 100_00n, contributed: 0n, excuseSectors: [], noticeDays: 15 }];
    const r = feederCall([{ kind: "expense", amount: 10_00n }], 0n, lps, "2026-10-29", "2026-11-12", 10, 2);
    expect(r.latestIssue).toBe("2026-10-20"); // 12 Nov − 2 business days − 15 business days
    expect(r.bridgeRequired).toBe(true);
    const ok = feederCall([{ kind: "expense", amount: 10_00n }], 0n, lps, "2026-10-01", "2026-11-12", 10, 2);
    expect(ok.bridgeRequired).toBe(false);
  });
});

describe("MFN", () => {
  const lps = [
    { id: "big", commitment: 50_000_000_00n },
    { id: "mid", commitment: 10_000_000_00n },
    { id: "small", commitment: 1_000_000_00n },
  ];
  const p = (id: string, lp: string, type: string, params: Record<string, unknown>, category = "ECONOMIC"): Provision => ({
    id,
    lp,
    type,
    params,
    category,
  });
  const provisions = [
    p("p1", "big", "FEE_DISCOUNT", { bps: 50 }),
    p("p2", "small", "FEE_DISCOUNT", { bps: 25 }),
    p("p3", "small", "REPORTING", { report: "ESG annual" }, "REPORTING"),
    p("p4", "small", "LPAC", { seat: true }, "LPAC_SEAT"),
    p("p5", "mid", "EXCUSE_RIGHT", { sectors: ["tobacco"] }),
    p("p6", "small", "REPORTING", { report: "ESG annual" }, "REPORTING"),
    p("p7", "mid", "FEE_DISCOUNT", { bps: 10 }),
    p("p8", "mid", "MFN", {}),
  ];
  it("applies the size tier, carve-outs, equal-or-better and dedupe", () => {
    expect(mfnEligible(lps, provisions, "mid")).toEqual(["p2", "p3"]);
    expect(mfnEligible(lps, provisions, "big")).toEqual(["p3", "p5"]); // big already holds a better fee discount
  });
});
