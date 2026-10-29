/** Most-favoured-nation eligibility: size tier, carve-outs, equal-or-better, dedupe (docs/SPEC.md 6). */
import { compareIds, EngineError } from "./errors.js";

export const CARVE_OUTS = new Set(["REGULATORY_LP_SPECIFIC", "TAX_LP_SPECIFIC", "LPAC_SEAT", "FIRST_CLOSE_INCENTIVE", "CO_INVEST"]);

export interface Provision {
  id: string;
  lp: string;
  type: string;
  params: Record<string, unknown>;
  category: string;
}

/** Canonical form of params: keys sorted, lists compared as sets. */
const canonical = (v: unknown): unknown => {
  if (Array.isArray(v)) {
    const items = v.map(canonical).map((x) => JSON.stringify(x));
    return [...new Set(items)].sort();
  }
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
};

export const sameParams = (a: Record<string, unknown>, b: Record<string, unknown>): boolean =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const num = (p: Provision, key: string): number => {
  const v = p.params[key];
  if (typeof v !== "number") throw new EngineError("INVALID_INPUT", `provision ${p.id}: ${key} must be a number`);
  return v;
};
const strings = (p: Provision, key: string): string[] => {
  const v = p.params[key];
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) {
    throw new EngineError("INVALID_INPUT", `provision ${p.id}: ${key} must be a list of strings`);
  }
  return v as string[];
};

export const mfnEligible = (
  lps: ReadonlyArray<{ id: string; commitment: bigint }>,
  provisions: readonly Provision[],
  electingLp: string,
): string[] => {
  const commitment = new Map(lps.map((l) => [l.id, l.commitment]));
  const mine = commitment.get(electingLp);
  if (mine === undefined) throw new EngineError("INVALID_INPUT", `unknown electing LP ${electingLp}`);
  const held = provisions.filter((p) => p.lp === electingLp);

  const alreadyBetter = (p: Provision): boolean => {
    const same = held.filter((h) => h.type === p.type);
    switch (p.type) {
      case "FEE_DISCOUNT":
      case "CARRY_DISCOUNT":
        return same.some((h) => num(h, "bps") >= num(p, "bps"));
      case "NOTICE_PERIOD":
        return same.some((h) => num(h, "days") >= num(p, "days"));
      case "EXCUSE_RIGHT": {
        const union = new Set(same.flatMap((h) => strings(h, "sectors")));
        return strings(p, "sectors").every((s) => union.has(s));
      }
      default:
        return same.some((h) => sameParams(h.params, p.params));
    }
  };

  const eligible = provisions.filter((p) => {
    const theirs = commitment.get(p.lp);
    if (theirs === undefined) throw new EngineError("INVALID_INPUT", `provision ${p.id} held by unknown LP ${p.lp}`);
    return p.lp !== electingLp && theirs <= mine && !CARVE_OUTS.has(p.category) && p.type !== "MFN" && !alreadyBetter(p);
  });
  eligible.sort((a, b) => compareIds(a.id, b.id));
  const kept: Provision[] = [];
  for (const p of eligible) {
    if (!kept.some((k) => k.type === p.type && sameParams(k.params, p.params))) kept.push(p);
  }
  return kept.map((p) => p.id);
};
