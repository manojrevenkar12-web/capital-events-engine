/** Capital calls: expenses, management fees and investments with excuse and caps (docs/SPEC.md 2). */
import { allocate } from "./allocate.js";
import { addBusinessDays, dayNumber, days, type IsoDate, maxDate, minDate } from "./dates.js";
import { compareIds, EngineError } from "./errors.js";
import { maxBig, Q } from "./rational.js";
import type { CallComponent, CallLine, CallLp, FundTerms } from "./types.js";

const DAYS_PER_YEAR = 365n;
const BPS = 10_000n;

/** Exact fee for one LP over [start, end) with the basis switching at the investment period end. */
export const exactFee = (
  terms: Pick<FundTerms, "feeRateBps" | "investmentPeriodEnd">,
  lp: Pick<CallLp, "commitment" | "netInvested" | "feeDiscountBps">,
  start: IsoDate,
  end: IsoDate,
): Q => {
  const rate = BigInt(Math.max(0, terms.feeRateBps - lp.feeDiscountBps));
  const ipEnd = terms.investmentPeriodEnd;
  const parts: Array<[bigint, number]> = [
    [lp.commitment, days(start, minDate(end, ipEnd))],
    [lp.netInvested, days(maxDate(start, ipEnd), end)],
  ];
  let fee = Q.ZERO;
  for (const [basis, d] of parts) {
    if (d > 0) fee = fee.add(Q.of(basis * rate * BigInt(d), BPS * DAYS_PER_YEAR));
  }
  return fee;
};

export const isExcused = (excuseSectors: readonly string[], dealSectors: readonly string[]): boolean =>
  dealSectors.some((s) => excuseSectors.includes(s));

/**
 * Water-filling (docs/SPEC.md 2.4 step 3): allocate pro rata by commitment, pin LPs that would
 * exceed their cap at the cap, and spread the rest over the others until nobody is over.
 */
export const waterFill = (
  amount: bigint,
  participants: ReadonlyArray<{ id: string; commitment: bigint; cap: bigint }>,
): Map<string, bigint> => {
  const out = new Map<string, bigint>(participants.map((p) => [p.id, 0n]));
  let active = participants.filter((p) => p.cap > 0n);
  let remaining = amount;
  for (;;) {
    if (remaining === 0n) return out;
    if (active.length === 0) {
      throw new EngineError("INSUFFICIENT_UNFUNDED", "not enough unfunded commitment among participating LPs");
    }
    const a = allocate(remaining, new Map(active.map((p) => [p.id, p.commitment])));
    const over = active.filter((p) => (a.get(p.id) ?? 0n) > p.cap);
    if (over.length === 0) {
      for (const p of active) out.set(p.id, a.get(p.id) ?? 0n);
      return out;
    }
    for (const p of over) {
      out.set(p.id, p.cap);
      remaining -= p.cap;
    }
    const pinned = new Set(over.map((p) => p.id));
    active = active.filter((p) => !pinned.has(p.id));
  }
};

export const capitalCall = (
  terms: FundTerms,
  issueDate: IsoDate,
  lps: readonly CallLp[],
  components: readonly CallComponent[],
): Map<string, CallLine> => {
  dayNumber(issueDate);
  const sofar = new Map<string, bigint>(lps.map((l) => [l.id, 0n]));
  const perComponent: Array<Map<string, bigint>> = [];

  for (const c of components) {
    let amounts: Map<string, bigint>;
    if (c.kind === "expense") {
      amounts = allocate(c.amount, new Map(lps.map((l) => [l.id, l.commitment])));
    } else if (c.kind === "fee") {
      amounts = new Map(
        lps.map((l) => [
          l.id,
          dayNumber(l.admitted) <= dayNumber(c.periodStart) ? exactFee(terms, l, c.periodStart, c.periodEnd).round() : 0n,
        ]),
      );
    } else {
      const participants = lps
        .filter((l) => !isExcused(l.excuseSectors, c.sectors))
        .map((l) => ({
          id: l.id,
          commitment: l.commitment,
          cap: maxBig(0n, l.commitment - l.contributed - (sofar.get(l.id) ?? 0n)),
        }));
      const filled = waterFill(c.amount, participants);
      amounts = new Map(lps.map((l) => [l.id, filled.get(l.id) ?? 0n]));
    }
    for (const [id, v] of amounts) sofar.set(id, (sofar.get(id) ?? 0n) + v);
    perComponent.push(amounts);
  }

  const over = lps.filter((l) => (sofar.get(l.id) ?? 0n) > l.commitment - l.contributed).map((l) => l.id);
  if (over.length > 0) throw new EngineError("OVER_CALL", "the call exceeds the unfunded commitment of some LPs", over);

  const lines = new Map<string, CallLine>();
  for (const l of [...lps].sort((a, b) => compareIds(a.id, b.id))) {
    lines.set(l.id, {
      components: perComponent.map((m) => m.get(l.id) ?? 0n),
      total: sofar.get(l.id) ?? 0n,
      dueDate: addBusinessDays(issueDate, Math.max(terms.defaultNoticeDays, l.noticeDays)),
    });
  }
  return lines;
};
