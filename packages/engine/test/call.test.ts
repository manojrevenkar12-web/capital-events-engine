import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type CallLp, capitalCall, EngineError, exactFee, waterFill } from "../src/index.js";

const terms = { feeRateBps: 200, investmentPeriodEnd: "2027-01-01", defaultNoticeDays: 10 };
const lp = (id: string, commitment: bigint, extra: Partial<CallLp> = {}): CallLp => ({
  id,
  commitment,
  contributed: 0n,
  netInvested: 0n,
  admitted: "2025-01-01",
  feeDiscountBps: 0,
  excuseSectors: [],
  noticeDays: 0,
  ...extra,
});

describe("capital call", () => {
  it("reallocates an excused LP's share and respects the notice period", () => {
    const lines = capitalCall(
      terms,
      "2026-10-29",
      [lp("A", 100_00n), lp("B", 100_00n, { excuseSectors: ["defence"], noticeDays: 15 }), lp("C", 200_00n)],
      [{ kind: "investment", deal: "d1", sectors: ["defence"], amount: 90_00n }],
    );
    expect(lines.get("B")?.total).toBe(0n);
    expect(lines.get("A")?.total).toBe(30_00n);
    expect(lines.get("C")?.total).toBe(60_00n);
    expect(lines.get("A")?.dueDate).toBe("2026-11-12");
    expect(lines.get("B")?.dueDate).toBe("2026-11-19");
  });

  it("caps an LP at its unfunded commitment and spreads the rest", () => {
    const filled = waterFill(100n, [
      { id: "A", commitment: 50n, cap: 10n },
      { id: "B", commitment: 50n, cap: 100n },
    ]);
    expect(filled.get("A")).toBe(10n);
    expect(filled.get("B")).toBe(90n);
    expect(() => waterFill(100n, [{ id: "A", commitment: 1n, cap: 99n }])).toThrow(/unfunded/);
  });

  it("splits the fee basis at the end of the investment period", () => {
    const l = { commitment: 1_000_000_00n, netInvested: 400_000_00n, feeDiscountBps: 50 };
    const fee = exactFee(terms, l, "2026-07-01", "2027-07-01");
    // 184 days on 10m at 1.5%, 181 days on 4m at 1.5%
    const expected = (1_000_000_00 * 0.015 * 184) / 365 + (400_000_00 * 0.015 * 181) / 365;
    expect(Math.abs(Number(fee.round()) - expected)).toBeLessThan(1);
  });

  it("charges fees only to LPs admitted by the start of the period", () => {
    const lines = capitalCall(
      terms,
      "2026-01-02",
      [lp("A", 1_000_000_00n), lp("B", 1_000_000_00n, { admitted: "2026-02-01" })],
      [{ kind: "fee", periodStart: "2026-01-01", periodEnd: "2026-04-01" }],
    );
    expect(lines.get("A")?.total).toBe(4_931_51n); // 1m × 2% × 90/365
    expect(lines.get("B")?.total).toBe(0n);
  });

  it("refuses to call more than an LP has left", () => {
    try {
      capitalCall(terms, "2026-10-29", [lp("Z", 100n, { contributed: 95n }), lp("A", 1000n)], [{ kind: "expense", amount: 1100n }]);
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("OVER_CALL");
      expect((e as EngineError).ids).toEqual(["Z"]);
    }
  });

  it("never exceeds unfunded and always calls the full investment amount", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ c: fc.bigInt({ min: 1n, max: 10n ** 9n }), paidPct: fc.integer({ min: 0, max: 100 }), ex: fc.boolean() }), {
          minLength: 1,
          maxLength: 30,
        }),
        fc.integer({ min: 1, max: 100 }),
        (rows, pct) => {
          const lps = rows.map((r, i) =>
            lp(`lp${String(i).padStart(2, "0")}`, r.c, {
              contributed: (r.c * BigInt(r.paidPct)) / 100n,
              excuseSectors: r.ex ? ["s"] : [],
            }),
          );
          const room = lps.filter((l) => l.excuseSectors.length === 0).reduce((s, l) => s + l.commitment - l.contributed, 0n);
          fc.pre(room > 0n);
          const amount = (room * BigInt(pct)) / 100n;
          const lines = capitalCall(terms, "2026-10-29", lps, [{ kind: "investment", deal: "d", sectors: ["s"], amount }]);
          let total = 0n;
          for (const l of lps) {
            const t = lines.get(l.id)?.total ?? 0n;
            expect(t <= l.commitment - l.contributed).toBe(true);
            if (l.excuseSectors.length) expect(t).toBe(0n);
            total += t;
          }
          expect(total).toBe(amount);
        },
      ),
    );
  });
});
