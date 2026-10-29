/** Feeder fund pass-through of a master call, and whether it can collect in time (docs/SPEC.md 5). */
import { allocate } from "./allocate.js";
import { isExcused, waterFill } from "./call.js";
import { dayNumber, type IsoDate, subtractBusinessDays } from "./dates.js";
import { compareIds, EngineError } from "./errors.js";
import { maxBig } from "./rational.js";

export type MasterComponent =
  | { kind: "expense" | "fee"; amount: bigint }
  | { kind: "investment"; amount: bigint; sectors: readonly string[] };

export interface FeederLp {
  id: string;
  commitment: bigint;
  contributed: bigint;
  excuseSectors: readonly string[];
  noticeDays: number;
}

export interface FeederResult {
  lines: Map<string, { components: bigint[]; total: bigint }>;
  latestIssue: IsoDate;
  bridgeRequired: boolean;
}

export const feederCall = (
  masterComponents: readonly MasterComponent[],
  feederExpense: bigint,
  lps: readonly FeederLp[],
  masterIssueDate: IsoDate,
  masterDueDate: IsoDate,
  defaultNoticeDays: number,
  bufferDays: number,
): FeederResult => {
  const comps: MasterComponent[] = [...masterComponents, { kind: "expense", amount: feederExpense }];
  const sofar = new Map<string, bigint>(lps.map((l) => [l.id, 0n]));
  const per: Array<Map<string, bigint>> = [];
  for (const c of comps) {
    let amounts: Map<string, bigint>;
    if (c.kind === "investment") {
      const filled = waterFill(
        c.amount,
        lps
          .filter((l) => !isExcused(l.excuseSectors, c.sectors))
          .map((l) => ({
            id: l.id,
            commitment: l.commitment,
            cap: maxBig(0n, l.commitment - l.contributed - (sofar.get(l.id) ?? 0n)),
          })),
      );
      amounts = new Map(lps.map((l) => [l.id, filled.get(l.id) ?? 0n]));
    } else {
      amounts = allocate(c.amount, new Map(lps.map((l) => [l.id, l.commitment])));
    }
    for (const [id, v] of amounts) sofar.set(id, (sofar.get(id) ?? 0n) + v);
    per.push(amounts);
  }
  const over = lps.filter((l) => (sofar.get(l.id) ?? 0n) > l.commitment - l.contributed).map((l) => l.id);
  if (over.length > 0) throw new EngineError("OVER_CALL", "the pass-through exceeds unfunded commitments", over);

  const notice = Math.max(defaultNoticeDays, ...lps.map((l) => l.noticeDays));
  const payBy = subtractBusinessDays(masterDueDate, bufferDays);
  const latestIssue = subtractBusinessDays(payBy, notice);
  const lines = new Map<string, { components: bigint[]; total: bigint }>();
  for (const l of [...lps].sort((a, b) => compareIds(a.id, b.id))) {
    lines.set(l.id, { components: per.map((m) => m.get(l.id) ?? 0n), total: sofar.get(l.id) ?? 0n });
  }
  return { lines, latestIssue, bridgeRequired: dayNumber(latestIssue) < dayNumber(masterIssueDate) };
};
