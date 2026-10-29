/** What a fund's approved side-letter provisions mean for the calculations, per investor. */
export interface InvestorTerms {
  feeDiscountBps: number;
  carryDiscountBps: number;
  noticeDays: number;
  excuseSectors: string[];
  hasMfn: boolean;
}

export const NO_TERMS: InvestorTerms = { feeDiscountBps: 0, carryDiscountBps: 0, noticeDays: 0, excuseSectors: [], hasMfn: false };

export const foldTerms = (provisions: Array<{ type: string; params: Record<string, unknown> }>): InvestorTerms => {
  const t: InvestorTerms = { ...NO_TERMS, excuseSectors: [] };
  for (const p of provisions) {
    const n = (k: string) => (typeof p.params[k] === "number" ? (p.params[k] as number) : 0);
    switch (p.type) {
      case "FEE_DISCOUNT":
        t.feeDiscountBps = Math.max(t.feeDiscountBps, n("bps"));
        break;
      case "CARRY_DISCOUNT":
        t.carryDiscountBps = Math.max(t.carryDiscountBps, n("bps"));
        break;
      case "NOTICE_PERIOD":
        t.noticeDays = Math.max(t.noticeDays, n("days"));
        break;
      case "EXCUSE_RIGHT":
        for (const s of (p.params.sectors as string[] | undefined) ?? []) if (!t.excuseSectors.includes(s)) t.excuseSectors.push(s);
        break;
      case "MFN":
        t.hasMfn = true;
        break;
      default:
        break;
    }
  }
  t.excuseSectors.sort();
  return t;
};
