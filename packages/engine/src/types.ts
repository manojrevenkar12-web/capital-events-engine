import type { IsoDate } from "./dates.js";

export interface FundTerms {
  feeRateBps: number;
  /** First day after the investment period. */
  investmentPeriodEnd: IsoDate;
  defaultNoticeDays: number;
}

export interface CallLp {
  id: string;
  commitment: bigint;
  /** Net contributed so far: calls minus refunds. */
  contributed: bigint;
  /** Investment contributions minus capital returned: the fee basis after the investment period. */
  netInvested: bigint;
  admitted: IsoDate;
  feeDiscountBps: number;
  excuseSectors: readonly string[];
  noticeDays: number;
}

export type CallComponent =
  | { kind: "expense"; amount: bigint }
  | { kind: "fee"; periodStart: IsoDate; periodEnd: IsoDate }
  | { kind: "investment"; deal: string; sectors: readonly string[]; amount: bigint };

export interface CallLine {
  components: bigint[];
  total: bigint;
  dueDate: IsoDate;
}
