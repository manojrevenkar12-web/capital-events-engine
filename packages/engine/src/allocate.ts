/** Pro-rata allocation by largest remainder (docs/SPEC.md 1.5). */
import { compareIds, EngineError } from "./errors.js";
import { Q, sumBig, toQ } from "./rational.js";

export type Weights = ReadonlyMap<string, Q | bigint>;

export const allocate = (amount: bigint, weights: Weights): Map<string, bigint> => {
  if (amount < 0n) throw new EngineError("INVALID_INPUT", "cannot allocate a negative amount");
  const entries = [...weights.entries()].map(([k, w]) => [k, toQ(w)] as const);
  for (const [k, w] of entries) {
    if (w.isNegative()) throw new EngineError("INVALID_INPUT", `negative weight for ${k}`);
  }
  const out = new Map<string, bigint>(entries.map(([k]) => [k, 0n]));
  if (amount === 0n) return out;
  const total = entries.reduce((s, [, w]) => s.add(w), Q.ZERO);
  if (total.isZero()) throw new EngineError("NO_WEIGHT", "every weight is zero");

  const shares = entries.map(([k, w]) => {
    const exact = Q.of(amount).mul(w).div(total);
    const base = exact.floor();
    return { k, w, base, rem: exact.sub(base) };
  });
  for (const s of shares) out.set(s.k, s.base);
  let left = amount - sumBig(shares.map((s) => s.base));
  shares.sort((a, b) => b.rem.cmp(a.rem) || b.w.cmp(a.w) || compareIds(a.k, b.k));
  for (const s of shares) {
    if (left === 0n) break;
    if (s.w.isZero()) continue;
    out.set(s.k, (out.get(s.k) ?? 0n) + 1n);
    left -= 1n;
  }
  return out;
};
