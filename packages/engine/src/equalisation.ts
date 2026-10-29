/** Subsequent closing: targets, deltas, fee catch-up and equalisation interest (docs/SPEC.md 3). */
import { allocate } from "./allocate.js";
import { exactFee, isExcused } from "./call.js";
import { dayNumber, days, type IsoDate } from "./dates.js";
import { compareIds, EngineError } from "./errors.js";
import { Q, sumBig } from "./rational.js";
import type { FundTerms } from "./types.js";

export interface EqualisationLp {
  id: string;
  /** Commitment after the closing. */
  commitment: bigint;
  excuseSectors: readonly string[];
  feeDiscountBps: number;
}

export type PriorComponent =
  | { kind: "expense"; dueDate: IsoDate; paid: ReadonlyMap<string, bigint> }
  | { kind: "investment"; dueDate: IsoDate; sectors: readonly string[]; paid: ReadonlyMap<string, bigint> }
  | { kind: "fee"; dueDate: IsoDate; periodStart: IsoDate; periodEnd: IsoDate; paid: ReadonlyMap<string, bigint> };

export interface EqualisationLine {
  capitalDelta: bigint;
  feeCatchUp: bigint;
  interestPaid: bigint;
  interestReceived: bigint;
  net: bigint;
  /**
   * Per prior component, in input order: the capital delta, or for a fee component the fee
   * catch-up. Lets a later closing see what each LP has paid per component. Not part of SPEC output.
   */
  deltas: bigint[];
}

const BPS_YEAR = 10_000n * 365n;

export const equalise = (
  terms: Pick<FundTerms, "feeRateBps" | "investmentPeriodEnd">,
  closeDate: IsoDate,
  rateBps: number,
  lps: readonly EqualisationLp[],
  prior: readonly PriorComponent[],
): Map<string, EqualisationLine> => {
  for (const k of prior) {
    if (k.kind === "fee" && dayNumber(k.periodEnd) > dayNumber(terms.investmentPeriodEnd)) {
      throw new EngineError("UNSUPPORTED_FEE_PERIOD", "fees on net invested capital are not equalised");
    }
  }
  const ids = lps.map((l) => l.id);
  const capital = new Map<string, bigint>(ids.map((id) => [id, 0n]));
  const feeCatchUp = new Map<string, bigint>(ids.map((id) => [id, 0n]));
  const exactPaid = new Map<string, Q>(ids.map((id) => [id, Q.ZERO]));
  const entitlement = new Map<string, Q>(ids.map((id) => [id, Q.ZERO]));
  const perComponent = new Map<string, bigint[]>(ids.map((id) => [id, []]));

  for (const k of prior) {
    const paid = (id: string) => k.paid.get(id) ?? 0n;
    const total = sumBig(k.paid.values());
    if (k.kind === "fee") {
      for (const l of lps) {
        const target = exactFee(terms, { ...l, netInvested: 0n }, k.periodStart, k.periodEnd).round();
        const d = target - paid(l.id);
        if (d > 0n) feeCatchUp.set(l.id, (feeCatchUp.get(l.id) ?? 0n) + d);
        perComponent.get(l.id)?.push(d > 0n ? d : 0n);
      }
      continue;
    }
    const weights =
      k.kind === "expense"
        ? new Map(lps.map((l) => [l.id, l.commitment]))
        : new Map(lps.map((l) => [l.id, isExcused(l.excuseSectors, k.sectors) ? 0n : l.commitment]));
    const target = allocate(total, weights);
    const elapsed = BigInt(Math.max(0, days(k.dueDate, closeDate)));
    let interestK = Q.ZERO;
    let refunded = 0n;
    const deltas = new Map<string, bigint>();
    for (const l of lps) {
      const d = (target.get(l.id) ?? 0n) - paid(l.id);
      deltas.set(l.id, d);
      perComponent.get(l.id)?.push(d);
      capital.set(l.id, (capital.get(l.id) ?? 0n) + d);
      if (d > 0n) {
        const x = Q.of(d * BigInt(rateBps) * elapsed, BPS_YEAR);
        exactPaid.set(l.id, (exactPaid.get(l.id) ?? Q.ZERO).add(x));
        interestK = interestK.add(x);
      } else if (d < 0n) {
        refunded += -d;
      }
    }
    if (refunded > 0n) {
      for (const [id, d] of deltas) {
        if (d < 0n) entitlement.set(id, (entitlement.get(id) ?? Q.ZERO).add(interestK.mul(-d).div(refunded)));
      }
    }
  }

  const interestPaid = new Map(ids.map((id) => [id, (exactPaid.get(id) ?? Q.ZERO).round()]));
  const collected = sumBig(interestPaid.values());
  const receivers = new Map([...entitlement].filter(([, e]) => e.isPositive()));
  let interestReceived = new Map<string, bigint>();
  if (receivers.size > 0) interestReceived = allocate(collected, receivers);
  else if (collected !== 0n) throw new EngineError("NO_WEIGHT", "interest collected but nobody to receive it");

  const lines = new Map<string, EqualisationLine>();
  for (const id of [...ids].sort(compareIds)) {
    const cd = capital.get(id) ?? 0n;
    const fc = feeCatchUp.get(id) ?? 0n;
    const ip = interestPaid.get(id) ?? 0n;
    const ir = interestReceived.get(id) ?? 0n;
    lines.set(id, {
      capitalDelta: cd,
      feeCatchUp: fc,
      interestPaid: ip,
      interestReceived: ir,
      net: cd + fc + ip - ir,
      deltas: perComponent.get(id) ?? [],
    });
  }
  return lines;
};
