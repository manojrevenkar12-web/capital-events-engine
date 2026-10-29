/**
 * Scenario generator for the differential test: realistic fund data plus the edge cases that
 * break implementations (ties, caps that cascade, excused LPs, 29 February, Easter, empty sets).
 * Deterministic for a seed. Writes one scenario per line.
 */
import { writeFileSync } from "node:fs";

let state = 0;
const seed = (s: number) => {
  state = s >>> 0 || 1;
};
const rnd = (): number => {
  // mulberry32
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)] as T;
const chance = (p: number) => rnd() < p;
const date = (from: string, spanDays: number) =>
  new Date(Date.parse(`${from}T00:00:00Z`) + int(0, spanDays) * 86_400_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const SECTORS = ["tobacco", "gambling", "weapons", "fossil_fuels", "alcohol", "software", "healthcare"];
const ids = (n: number) => {
  const style = pick(["plain", "padded", "mixed"]);
  return Array.from({ length: n }, (_, i) =>
    style === "plain" ? `LP${i}` : style === "padded" ? `lp-${String(i).padStart(4, "0")}` : pick(["A", "b", "Z", "é", "lp"]) + i,
  );
};
const commitment = () =>
  pick([
    () => int(1, 1000),
    () => int(1, 50) * 100_000_00,
    () => int(10_000_00, 5_000_000_00),
    () => 1_000_000_00, // equal commitments create ties
  ])();

const allocate = () => {
  const n = int(1, 12);
  const weights: Record<string, number> = {};
  const equal = chance(0.3);
  for (const id of ids(n)) weights[id] = equal ? 7 : chance(0.15) ? 0 : int(0, 1_000_000);
  if (Object.values(weights).every((w) => w === 0)) weights[Object.keys(weights)[0] ?? "x"] = 1;
  return { op: "allocate", input: { amount: pick([0, 1, int(1, 100), int(1, 10 ** 9)]), weights } };
};

const businessDays = () => ({
  op: "business_days",
  input: { date: pick([date("2024-01-01", 1500), "2026-04-02", "2026-12-23", "2027-03-25", "2028-02-28"]), n: int(-25, 25) },
});

const callLps = (n: number, issue: string) =>
  ids(n).map((id) => {
    const c = commitment();
    const contributed = chance(0.4) ? 0 : Math.floor(c * (chance(0.9) ? pick([0.05, 0.1, 0.3, 0.5, 0.6]) : pick([0.9, 0.99, 1])));
    return {
      id,
      commitment: c,
      contributed,
      net_invested: Math.floor(contributed * pick([0, 0.5, 0.8, 1])),
      admitted: chance(0.8) ? addDays(issue, -int(30, 900)) : addDays(issue, -int(0, 20)),
      fee_discount_bps: chance(0.2) ? pick([10, 25, 50, 200, 300]) : 0,
      excuse_sectors: chance(0.25) ? [pick(SECTORS)] : [],
      notice_days: chance(0.2) ? pick([5, 10, 15, 20]) : 0,
    };
  });

const capitalCall = () => {
  const issue = date("2025-01-01", 900);
  const lps = callLps(int(1, 25), issue);
  const room = lps.reduce((s, l) => s + Math.max(0, l.commitment - l.contributed), 0);
  const comps: object[] = [];
  for (let i = 0; i < int(1, 4); i++) {
    const k = pick(["expense", "fee", "investment", "investment"]);
    if (k === "expense") comps.push({ kind: "expense", amount: int(0, Math.max(1, Math.floor(room * 0.002))) });
    else if (k === "fee") {
      const start = addDays(issue, -int(0, 400));
      comps.push({ kind: "fee", period_start: start, period_end: addDays(start, pick([90, 91, 92, 181, 182, 184, 365, 366])) });
    } else {
      comps.push({
        kind: "investment",
        deal: `deal${i}`,
        sectors: chance(0.5) ? [pick(SECTORS)] : [],
        amount: Math.floor(room * (chance(0.9) ? pick([0, 0.01, 0.05, 0.1, 0.2, 0.3]) : pick([0.6, 0.95, 1, 1.01]))),
      });
    }
  }
  return {
    op: "capital_call",
    input: {
      fund: {
        fee_rate_bps: pick([150, 175, 200, 250]),
        investment_period_end: addDays(issue, int(-200, 600)),
        default_notice_days: pick([5, 10, 15]),
      },
      issue_date: issue,
      lps,
      components: comps,
    },
  };
};

const equalisation = () => {
  const close = date("2025-06-01", 700);
  const ipEnd = addDays(close, int(-100, 900));
  const all = ids(int(2, 16)).map((id) => ({
    id,
    commitment: commitment(),
    excuse_sectors: chance(0.2) ? [pick(SECTORS)] : [],
    fee_discount_bps: chance(0.2) ? pick([25, 50, 100]) : 0,
  }));
  const early = all.filter((_, i) => i < Math.max(1, Math.floor(all.length * pick([0.3, 0.5, 0.8]))));
  const prior: object[] = [];
  for (let k = 0; k < int(1, 5); k++) {
    const kind = pick(["expense", "investment", "fee"]);
    const due = addDays(close, -int(0, 700));
    const paid: Record<string, number> = {};
    if (kind === "fee") {
      const start = addDays(due, -int(0, 200));
      let end = addDays(start, pick([90, 181, 365]));
      if (Date.parse(end) > Date.parse(ipEnd) && chance(0.9)) end = ipEnd;
      const tot = early.reduce((s, l) => s + l.commitment, 0);
      for (const l of early) paid[l.id] = Math.round((l.commitment * 0.02 * 90) / 365) + (chance(0.1) ? int(-5, 5) : 0);
      for (const id of Object.keys(paid)) paid[id] = Math.max(0, paid[id] ?? 0);
      void tot;
      prior.push({ kind, due_date: due, period_start: start, period_end: end, paid });
    } else {
      const total = int(0, 10 ** 8);
      const tot = early.reduce((s, l) => s + l.commitment, 0);
      for (const l of early) paid[l.id] = Math.floor((total * l.commitment) / tot);
      prior.push(
        kind === "investment" ? { kind, due_date: due, sectors: chance(0.4) ? [pick(SECTORS)] : [], paid } : { kind, due_date: due, paid },
      );
    }
  }
  return {
    op: "equalisation",
    input: {
      close_date: close,
      rate_bps: pick([0, 400, 600, 800]),
      fund: { fee_rate_bps: pick([150, 200]), investment_period_end: ipEnd },
      lps: all,
      prior,
    },
  };
};

const distribution = () => {
  const d = date("2026-01-01", 1500);
  const lps = ids(int(1, 10)).map((id) => {
    const contributions = Array.from({ length: int(1, 5) }, () => ({
      date: pick([addDays(d, -int(0, 3000)), "2024-02-29", "2020-02-29"]),
      amount: int(0, 10 ** 9),
    }));
    const contributed = contributions.reduce((s, c) => s + c.amount, 0);
    const priorRoc = chance(0.5) ? 0 : Math.floor(contributed * pick([0.1, 0.5, 1]));
    const priorPref = chance(0.6) ? 0 : int(0, Math.floor(contributed * 0.3));
    const priorSplit = chance(0.7) ? 0 : int(0, Math.floor(contributed * 0.2));
    const distributions =
      priorRoc + priorPref + priorSplit > 0 ? [{ date: addDays(d, -int(0, 800)), amount: priorRoc + priorPref + priorSplit }] : [];
    const c = pick([0, 2000, 2000, 1500]);
    return {
      id,
      deal_contribution: chance(0.15) ? 0 : int(1, 10 ** 8),
      carry_discount_bps: chance(0.2) ? pick([500, 1000, 2000]) : 0,
      contributions,
      distributions,
      prior_roc: priorRoc,
      prior_pref: priorPref,
      prior_catch_up: c > 0 && priorPref > 0 && chance(0.5) ? Math.floor((priorPref * c) / (10000 - c)) : 0,
    };
  });
  if (lps.every((l) => l.deal_contribution === 0) && lps[0]) lps[0].deal_contribution = 1;
  const okFlows = lps.map((l) => ({
    ...l,
    contributions: l.contributions.filter((c) => c.date <= d),
    distributions: l.distributions.filter((x) => x.date <= d),
  }));
  return {
    op: "distribution",
    input: { date: d, amount: int(0, 3 * 10 ** 9), hurdle_bps: pick([0, 600, 800]), carry_bps: pick([0, 1500, 2000]), lps: okFlows },
  };
};

const feederCall = () => {
  const issue = date("2025-01-01", 900);
  const lps = ids(int(1, 15)).map((id) => {
    const c = commitment();
    return {
      id,
      commitment: c,
      contributed: Math.floor(c * (chance(0.9) ? pick([0, 0.1, 0.2, 0.4]) : pick([0.9, 1]))),
      excuse_sectors: chance(0.2) ? [pick(SECTORS)] : [],
      notice_days: chance(0.3) ? pick([10, 15, 20]) : 0,
    };
  });
  const room = lps.reduce((s, l) => s + l.commitment - l.contributed, 0);
  const comps = Array.from({ length: int(1, 3) }, () => {
    const k = pick(["expense", "fee", "investment"]);
    return k === "investment"
      ? { kind: k, amount: Math.floor(room * pick([0.01, 0.05, 0.1, 0.2])), sectors: chance(0.4) ? [pick(SECTORS)] : [] }
      : { kind: k, amount: int(0, Math.max(1, Math.floor(room * 0.001))) };
  });
  return {
    op: "feeder_call",
    input: {
      master_components: comps,
      feeder_expense: chance(0.5) ? 0 : int(1, Math.max(1, Math.floor(room * 0.0005))),
      lps,
      master_issue_date: issue,
      master_due_date: addDays(issue, int(7, 40)),
      default_notice_days: pick([5, 10]),
      buffer_days: pick([0, 1, 2, 3]),
    },
  };
};

const mfn = () => {
  const lps = ids(int(2, 10)).map((id) => ({ id, commitment: pick([1_000_000_00, 5_000_000_00, 10_000_000_00, int(1, 10 ** 10)]) }));
  const cats = [
    "ECONOMIC",
    "REPORTING",
    "GOVERNANCE",
    "REGULATORY_LP_SPECIFIC",
    "TAX_LP_SPECIFIC",
    "LPAC_SEAT",
    "FIRST_CLOSE_INCENTIVE",
    "CO_INVEST",
  ];
  const provisions = Array.from({ length: int(0, 14) }, (_, i) => {
    const type = pick(["FEE_DISCOUNT", "CARRY_DISCOUNT", "NOTICE_PERIOD", "EXCUSE_RIGHT", "REPORTING", "MFN", "LPAC_SEAT"]);
    const params =
      type === "FEE_DISCOUNT" || type === "CARRY_DISCOUNT"
        ? { bps: pick([10, 25, 50]) }
        : type === "NOTICE_PERIOD"
          ? { days: pick([10, 15, 20]) }
          : type === "EXCUSE_RIGHT"
            ? { sectors: [pick(SECTORS), ...(chance(0.4) ? [pick(SECTORS)] : [])] }
            : type === "REPORTING"
              ? { report: pick(["quarterly esg", "annual pai"]) }
              : type === "LPAC_SEAT"
                ? { seat: true }
                : {};
    return { id: `p${String(int(0, 99)).padStart(2, "0")}${i}`, lp: pick(lps).id, type, params, category: pick(cats) };
  });
  return { op: "mfn", input: { lps, provisions, electing_lp: pick(lps).id } };
};

const ops = [
  allocate,
  businessDays,
  capitalCall,
  capitalCall,
  equalisation,
  equalisation,
  distribution,
  distribution,
  feederCall,
  mfn,
  mfn,
];

const [n = "3000", s = "20261029", out = "scenarios.jsonl"] = process.argv.slice(2);
seed(Number(s));
const lines: string[] = [];
for (let i = 0; i < Number(n); i++) lines.push(JSON.stringify((ops[i % ops.length] ?? allocate)()));
writeFileSync(out, `${lines.join("\n")}\n`);
console.log(`wrote ${lines.length} scenarios to ${out} (seed ${s})`);
