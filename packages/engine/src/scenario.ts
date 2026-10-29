/**
 * The JSON scenario format shared with the independent reference implementation
 * (docs/SPEC.md 7). Parses and validates input, runs one operation, renders the result.
 */
import { allocate } from "./allocate.js";
import { capitalCall } from "./call.js";
import { addBusinessDays, dayNumber, subtractBusinessDays } from "./dates.js";
import { equalise, type PriorComponent } from "./equalisation.js";
import { EngineError } from "./errors.js";
import { feederCall, type MasterComponent } from "./feeder.js";
import { mfnEligible, type Provision } from "./mfn.js";
import type { CallComponent } from "./types.js";
import { distribute } from "./waterfall.js";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

export type ScenarioResult = { ok: true; output: Json } | { ok: false; error: string; ids?: string[] };

const bad = (msg: string): never => {
  throw new EngineError("INVALID_INPUT", msg);
};

const obj = (v: unknown, what: string): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : bad(`${what} must be an object`);
const arr = (v: unknown, what: string): Json[] => (Array.isArray(v) ? v : bad(`${what} must be a list`));
const str = (v: unknown, what: string): string => (typeof v === "string" ? v : bad(`${what} must be a string`));
const date = (v: unknown, what: string): string => {
  const s = str(v, what);
  dayNumber(s);
  return s;
};
const int = (v: unknown, what: string): number =>
  typeof v === "number" && Number.isSafeInteger(v) ? v : bad(`${what} must be an integer`);
const nonNeg = (v: unknown, what: string): number => {
  const n = int(v, what);
  return n >= 0 ? n : bad(`${what} must not be negative`);
};
const money = (v: unknown, what: string): bigint => BigInt(nonNeg(v, what));
const strList = (v: unknown, what: string): string[] => arr(v, what).map((x, i) => str(x, `${what}[${i}]`));
const optInt = (o: Obj, k: string, what: string): number => (o[k] === undefined ? 0 : nonNeg(o[k], what));
const uniqueIds = <T extends { id: string }>(xs: T[]): T[] => {
  const seen = new Set<string>();
  for (const x of xs) {
    if (seen.has(x.id)) bad(`duplicate id ${x.id}`);
    seen.add(x.id);
  }
  return xs;
};
const paidMap = (v: unknown, what: string): Map<string, bigint> =>
  new Map(Object.entries(obj(v, what)).map(([k, x]) => [k, money(x, `${what}.${k}`)]));
const toJson = (m: Map<string, Record<string, unknown>>): Obj => {
  const out: Obj = {};
  for (const [k, v] of m) {
    const line: Obj = {};
    for (const [f, x] of Object.entries(v)) {
      line[f] = typeof x === "bigint" ? Number(x) : Array.isArray(x) ? x.map((y) => Number(y)) : (x as Json);
    }
    out[k] = line;
  }
  return out;
};
const snake = (s: string): string => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const snakeKeys = (m: Map<string, Record<string, unknown>>): Map<string, Record<string, unknown>> =>
  new Map([...m].map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([f, x]) => [snake(f), x]))]));

const callComponent = (j: Json, i: number): CallComponent => {
  const c = obj(j, `components[${i}]`);
  switch (c.kind) {
    case "expense":
      return { kind: "expense", amount: money(c.amount, "amount") };
    case "fee":
      return { kind: "fee", periodStart: date(c.period_start, "period_start"), periodEnd: date(c.period_end, "period_end") };
    case "investment":
      return {
        kind: "investment",
        deal: str(c.deal ?? "", "deal"),
        sectors: strList(c.sectors ?? [], "sectors"),
        amount: money(c.amount, "amount"),
      };
    default:
      return bad(`unknown component kind ${String(c.kind)}`);
  }
};

const ops: Record<string, (input: Obj) => Json> = {
  allocate: (i) => {
    const weights = new Map(Object.entries(obj(i.weights, "weights")).map(([k, w]) => [k, money(w, `weight ${k}`)]));
    const r = allocate(money(i.amount, "amount"), weights);
    return Object.fromEntries([...r].map(([k, v]) => [k, Number(v)]));
  },

  business_days: (i) => {
    const n = int(i.n, "n");
    const d = date(i.date, "date");
    return { date: n >= 0 ? addBusinessDays(d, n) : subtractBusinessDays(d, -n) };
  },

  capital_call: (i) => {
    const f = obj(i.fund, "fund");
    const lps = uniqueIds(
      arr(i.lps, "lps").map((x, k) => {
        const l = obj(x, `lps[${k}]`);
        return {
          id: str(l.id, "id"),
          commitment: money(l.commitment, "commitment"),
          contributed: money(l.contributed ?? 0, "contributed"),
          netInvested: money(l.net_invested ?? 0, "net_invested"),
          admitted: date(l.admitted, "admitted"),
          feeDiscountBps: optInt(l, "fee_discount_bps", "fee_discount_bps"),
          excuseSectors: strList(l.excuse_sectors ?? [], "excuse_sectors"),
          noticeDays: optInt(l, "notice_days", "notice_days"),
        };
      }),
    );
    const lines = capitalCall(
      {
        feeRateBps: nonNeg(f.fee_rate_bps, "fee_rate_bps"),
        investmentPeriodEnd: date(f.investment_period_end, "investment_period_end"),
        defaultNoticeDays: nonNeg(f.default_notice_days, "default_notice_days"),
      },
      date(i.issue_date, "issue_date"),
      lps,
      arr(i.components, "components").map(callComponent),
    );
    return { lines: toJson(snakeKeys(lines as unknown as Map<string, Record<string, unknown>>)) };
  },

  equalisation: (i) => {
    const f = obj(i.fund, "fund");
    const lps = uniqueIds(
      arr(i.lps, "lps").map((x, k) => {
        const l = obj(x, `lps[${k}]`);
        return {
          id: str(l.id, "id"),
          commitment: money(l.commitment, "commitment"),
          excuseSectors: strList(l.excuse_sectors ?? [], "excuse_sectors"),
          feeDiscountBps: optInt(l, "fee_discount_bps", "fee_discount_bps"),
        };
      }),
    );
    const prior: PriorComponent[] = arr(i.prior, "prior").map((x, k) => {
      const p = obj(x, `prior[${k}]`);
      const base = { dueDate: date(p.due_date, "due_date"), paid: paidMap(p.paid ?? {}, "paid") };
      if (p.kind === "expense") return { kind: "expense", ...base };
      if (p.kind === "investment") return { kind: "investment", ...base, sectors: strList(p.sectors ?? [], "sectors") };
      if (p.kind === "fee") {
        return {
          kind: "fee",
          ...base,
          periodStart: date(p.period_start, "period_start"),
          periodEnd: date(p.period_end, "period_end"),
        };
      }
      return bad(`unknown prior kind ${String(p.kind)}`);
    });
    const known = new Set(lps.map((l) => l.id));
    for (const p of prior) for (const id of p.paid.keys()) if (!known.has(id)) bad(`paid by unknown LP ${id}`);
    const lines = equalise(
      {
        feeRateBps: nonNeg(f.fee_rate_bps, "fee_rate_bps"),
        investmentPeriodEnd: date(f.investment_period_end, "investment_period_end"),
      },
      date(i.close_date, "close_date"),
      nonNeg(i.rate_bps, "rate_bps"),
      lps,
      prior,
    );
    const specLines = new Map([...lines].map(([k, { deltas: _d, ...rest }]) => [k, rest]));
    return { lines: toJson(snakeKeys(specLines as unknown as Map<string, Record<string, unknown>>)) };
  },

  distribution: (i) => {
    const flows = (v: unknown, what: string) =>
      arr(v ?? [], what).map((x, k) => {
        const fl = obj(x, `${what}[${k}]`);
        return { date: date(fl.date, "date"), amount: money(fl.amount, "amount") };
      });
    const lps = uniqueIds(
      arr(i.lps, "lps").map((x, k) => {
        const l = obj(x, `lps[${k}]`);
        return {
          id: str(l.id, "id"),
          dealContribution: money(l.deal_contribution, "deal_contribution"),
          carryDiscountBps: optInt(l, "carry_discount_bps", "carry_discount_bps"),
          contributions: flows(l.contributions, "contributions"),
          distributions: flows(l.distributions, "distributions"),
          priorRoc: money(l.prior_roc ?? 0, "prior_roc"),
          priorPref: money(l.prior_pref ?? 0, "prior_pref"),
          priorCatchUp: money(l.prior_catch_up ?? 0, "prior_catch_up"),
        };
      }),
    );
    const d = date(i.date, "date");
    for (const l of lps) {
      for (const fl of [...l.contributions, ...l.distributions]) {
        if (dayNumber(fl.date) > dayNumber(d)) bad(`cash flow of ${l.id} after the distribution date`);
      }
    }
    const carry = nonNeg(i.carry_bps, "carry_bps");
    if (carry >= 10_000) bad("carry_bps must be below 10000");
    const lines = distribute(d, money(i.amount, "amount"), nonNeg(i.hurdle_bps, "hurdle_bps"), carry, lps);
    return { lines: toJson(snakeKeys(lines as unknown as Map<string, Record<string, unknown>>)) };
  },

  feeder_call: (i) => {
    const comps: MasterComponent[] = arr(i.master_components, "master_components").map((x, k) => {
      const c = obj(x, `master_components[${k}]`);
      if (c.kind === "investment") {
        return { kind: "investment", amount: money(c.amount, "amount"), sectors: strList(c.sectors ?? [], "sectors") };
      }
      if (c.kind === "expense" || c.kind === "fee") return { kind: c.kind, amount: money(c.amount, "amount") };
      return bad(`unknown component kind ${String(c.kind)}`);
    });
    const lps = uniqueIds(
      arr(i.lps, "lps").map((x, k) => {
        const l = obj(x, `lps[${k}]`);
        return {
          id: str(l.id, "id"),
          commitment: money(l.commitment, "commitment"),
          contributed: money(l.contributed ?? 0, "contributed"),
          excuseSectors: strList(l.excuse_sectors ?? [], "excuse_sectors"),
          noticeDays: optInt(l, "notice_days", "notice_days"),
        };
      }),
    );
    const r = feederCall(
      comps,
      money(i.feeder_expense ?? 0, "feeder_expense"),
      lps,
      date(i.master_issue_date, "master_issue_date"),
      date(i.master_due_date, "master_due_date"),
      nonNeg(i.default_notice_days, "default_notice_days"),
      nonNeg(i.buffer_days, "buffer_days"),
    );
    return {
      lines: toJson(snakeKeys(r.lines as unknown as Map<string, Record<string, unknown>>)),
      latest_issue: r.latestIssue,
      bridge_required: r.bridgeRequired,
    };
  },

  mfn: (i) => {
    const lps = uniqueIds(
      arr(i.lps, "lps").map((x, k) => {
        const l = obj(x, `lps[${k}]`);
        return { id: str(l.id, "id"), commitment: money(l.commitment, "commitment") };
      }),
    );
    const provisions: Provision[] = uniqueIds(
      arr(i.provisions, "provisions").map((x, k) => {
        const p = obj(x, `provisions[${k}]`);
        return {
          id: str(p.id, "id"),
          lp: str(p.lp, "lp"),
          type: str(p.type, "type"),
          params: obj(p.params ?? {}, "params") as Record<string, unknown>,
          category: str(p.category, "category"),
        };
      }),
    );
    return { eligible: mfnEligible(lps, provisions, str(i.electing_lp, "electing_lp")) };
  },
};

export const runScenario = (scenario: unknown): ScenarioResult => {
  try {
    const s = obj(scenario, "scenario");
    const op = ops[str(s.op, "op")];
    if (!op) return bad(`unknown op ${String(s.op)}`);
    return { ok: true, output: op(obj(s.input, "input")) };
  } catch (e) {
    if (e instanceof EngineError) {
      return e.code === "OVER_CALL" ? { ok: false, error: e.code, ids: e.ids } : { ok: false, error: e.code };
    }
    if (e instanceof RangeError || e instanceof TypeError) return { ok: false, error: "INVALID_INPUT" };
    throw e;
  }
};
