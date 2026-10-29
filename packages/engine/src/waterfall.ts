/** Distributions through a European waterfall, LP by LP (docs/SPEC.md 4). */
import { allocate } from "./allocate.js";
import { addYears, dayNumber, days, type IsoDate } from "./dates.js";
import { compareIds, EngineError } from "./errors.js";
import { maxBig, maxQ, minBig, Q, sumBig } from "./rational.js";

export interface Flow {
  date: IsoDate;
  amount: bigint;
}

export interface WaterfallLp {
  id: string;
  dealContribution: bigint;
  carryDiscountBps: number;
  contributions: readonly Flow[];
  distributions: readonly Flow[];
  priorRoc: bigint;
  priorPref: bigint;
  priorCatchUp: bigint;
}

export interface WaterfallLine {
  gross: bigint;
  roc: bigint;
  pref: bigint;
  catchUp: bigint;
  gpSplit: bigint;
  lpSplit: bigint;
  lpTotal: bigint;
  gpTotal: bigint;
}

/** (1 + h)^n × (1 + h × f / 365): annual compounding on anniversaries, simple in between. */
export const growth = (hurdleBps: number, from: IsoDate, to: IsoDate): Q => {
  if (dayNumber(from) > dayNumber(to)) throw new EngineError("INVALID_INPUT", `cash flow on ${from} after ${to}`);
  const h = Q.of(BigInt(hurdleBps), 10_000n);
  let n = 0;
  while (dayNumber(addYears(from, n + 1)) <= dayNumber(to)) n += 1;
  const f = days(addYears(from, n), to);
  return Q.ONE.add(h)
    .pow(n)
    .mul(Q.ONE.add(h.mul(Q.of(BigInt(f), 365n))));
};

export const distribute = (
  date: IsoDate,
  amount: bigint,
  hurdleBps: number,
  carryBps: number,
  lps: readonly WaterfallLp[],
): Map<string, WaterfallLine> => {
  const gross = allocate(amount, new Map(lps.map((l) => [l.id, l.dealContribution])));
  const lines = new Map<string, WaterfallLine>();
  for (const l of [...lps].sort((a, b) => compareIds(a.id, b.id))) {
    const g = gross.get(l.id) ?? 0n;
    const contributed = sumBig(l.contributions.map((c) => c.amount));
    let hurdle = Q.ZERO;
    for (const c of l.contributions) hurdle = hurdle.add(Q.of(c.amount).mul(growth(hurdleBps, c.date, date)));
    for (const d of l.distributions) hurdle = hurdle.sub(Q.of(d.amount).mul(growth(hurdleBps, d.date, date)));
    const prefOwed = maxQ(Q.ZERO, hurdle.sub(contributed - l.priorRoc)).round();

    const roc = minBig(g, maxBig(0n, contributed - l.priorRoc));
    const pref = minBig(g - roc, prefOwed);
    const c = BigInt(Math.max(0, carryBps - l.carryDiscountBps));
    let catchUp = 0n;
    if (c > 0n) {
      const target = Q.of((l.priorPref + pref) * c, 10_000n - c);
      catchUp = minBig(g - roc - pref, maxQ(Q.ZERO, target.sub(l.priorCatchUp)).round());
    }
    const rest = g - roc - pref - catchUp;
    const gpSplit = Q.of(rest * c, 10_000n).round();
    const lpSplit = rest - gpSplit;
    lines.set(l.id, {
      gross: g,
      roc,
      pref,
      catchUp,
      gpSplit,
      lpSplit,
      lpTotal: roc + pref + lpSplit,
      gpTotal: catchUp + gpSplit,
    });
  }
  return lines;
};
