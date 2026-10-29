export interface Fund {
  id: string;
  name: string;
  currency: string;
  kind: "master" | "feeder" | "parallel";
  committed: string;
  investors: number;
  fee_rate_bps: number;
  carry_bps: number;
  hurdle_bps: number;
  investment_period_end: string;
  first_close_date: string;
  default_notice_days: number;
}

export type EventStatus = "draft" | "calculated" | "approved" | "issued" | "settled" | "cancelled";

export interface CapitalEvent {
  id: string;
  fund_id: string;
  kind: "call" | "distribution" | "equalisation";
  reference: string;
  status: EventStatus;
  issue_date: string;
  created_by: string;
  created_at: string;
  issued_at: string | null;
  result_hash: string | null;
  input: Record<string, unknown>;
  error: { code: string; message: string; ids: string[] } | null;
  calculated_at?: string | null;
  approvals?: Array<{ user_id: string; result_hash: string; decided_at: string; current: boolean }>;
  totals?: { lines: number; total: string; paid: string };
}

export interface Line {
  investor_id: string;
  investor_name: string;
  components: string[];
  total: string;
  paid: string;
  due_date: string | null;
  status: "open" | "partial" | "paid" | "overpaid" | "nothing_due";
  end_to_end_id: string;
  detail: Record<string, string>;
}

export interface CapitalAccounts {
  totals: Record<"commitment" | "contributed" | "unfunded" | "distributed" | "receivable" | "payable", string> & { investors: number };
  rows: Array<{
    investorId: string;
    name: string;
    commitment: string;
    contributed: string;
    unfunded: string;
    distributed: string;
    receivable: string;
    payable: string;
    terms: { feeDiscountBps: number; carryDiscountBps: number; noticeDays: number; excuseSectors: string[]; hasMfn: boolean };
  }>;
}

export interface Provision {
  id: string;
  investor_id: string;
  investor_name?: string;
  side_letter_id: string | null;
  source: "side_letter" | "mfn_election";
  type: string;
  params: Record<string, unknown>;
  category: string;
  quote: string | null;
  quote_start: number | null;
  quote_end: number | null;
  extractor: string;
  status: "proposed" | "approved" | "rejected";
  decided_by: string | null;
}

export interface SideLetterSummary {
  id: string;
  title: string;
  status: "extracting" | "in_review" | "reviewed";
  investor_id: string;
  investor_name: string;
  created_at: string;
  uploaded_by: string;
}

export interface SideLetter extends SideLetterSummary {
  fund_id: string;
  body: string;
  provisions: Provision[];
}

export interface BankEntry {
  id: string;
  acct_svcr_ref: string;
  amount: string;
  booking_date: string;
  end_to_end_id: string | null;
  remittance: string | null;
  debtor_name: string | null;
  status: "matched" | "unmatched" | "duplicate" | "resolved";
  note: string | null;
  msg_id: string;
}

export interface AuditRecord {
  seq: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entity_id: string;
  hash: string;
}

export interface Investor {
  id: string;
  name: string;
  kind: string;
  country: string;
  kyc_status: "pending" | "verified" | "refused";
  feeder_fund_id: string | null;
}

export interface FeederPlanRow {
  feederFundId: string;
  feederName: string;
  masterLineTotal: string;
  masterDueDate: string;
  latestIssue: string;
  bridgeRequired: boolean;
  investors: number;
}
