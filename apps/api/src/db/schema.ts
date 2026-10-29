/** Table types for Kysely. Money columns are BIGINT cents, read as strings and converted at the edge. */
import type { ColumnType, Generated, JSONColumnType } from "kysely";

type Money = ColumnType<string, string | bigint | number, string | bigint | number>;
type DateCol = ColumnType<string, string, string>;
type Ts = ColumnType<Date, Date | string | undefined, Date | string>;

export interface TenantsTable {
  id: string;
  name: string;
  created_at: Ts;
}

export interface FundsTable {
  id: string;
  tenant_id: string;
  name: string;
  currency: string;
  kind: "master" | "feeder" | "parallel";
  master_fund_id: string | null;
  fee_rate_bps: number;
  investment_period_end: DateCol;
  default_notice_days: number;
  hurdle_bps: number;
  carry_bps: number;
  equalisation_rate_bps: number;
  first_close_date: DateCol;
  iban: string;
  bic: string;
  version: Generated<number>;
  created_at: Ts;
}

export interface InvestorsTable {
  id: string;
  tenant_id: string;
  name: string;
  kind: "individual" | "institution" | "feeder";
  country: string;
  kyc_status: "pending" | "verified" | "expired";
  iban: string;
  bic: string;
  feeder_fund_id: string | null;
  created_at: Ts;
}

export interface CommitmentsTable {
  id: string;
  tenant_id: string;
  fund_id: string;
  investor_id: string;
  amount: Money;
  admitted: DateCol;
  closing_id: string | null;
  created_at: Ts;
}

export interface ClosingsTable {
  id: string;
  tenant_id: string;
  fund_id: string;
  close_date: DateCol;
  status: "draft" | "completed" | "cancelled";
  admissions: JSONColumnType<Array<{ investorId: string; amount: string }>>;
  event_id: string | null;
  created_at: Ts;
}

export interface SideLettersTable {
  id: string;
  tenant_id: string;
  fund_id: string;
  investor_id: string;
  title: string;
  body: string;
  sha256: string;
  status: "extracting" | "in_review" | "reviewed";
  uploaded_by: string;
  created_at: Ts;
}

export interface ProvisionsTable {
  id: string;
  tenant_id: string;
  fund_id: string;
  investor_id: string;
  side_letter_id: string | null;
  source: "side_letter" | "mfn_election";
  type: string;
  params: JSONColumnType<Record<string, unknown>>;
  category: string;
  quote: string | null;
  quote_start: number | null;
  quote_end: number | null;
  extractor: string;
  status: "proposed" | "approved" | "rejected";
  elected_from: string | null;
  proposed_at: Ts;
  decided_by: string | null;
  decided_at: Ts | null;
}

export interface MfnElectionsTable {
  id: string;
  tenant_id: string;
  fund_id: string;
  investor_id: string;
  eligible: JSONColumnType<string[]>;
  elected: JSONColumnType<string[]>;
  status: "open" | "submitted";
  opened_at: Ts;
  submitted_at: Ts | null;
}

export type EventKind = "call" | "distribution" | "equalisation";
export type EventStatus = "draft" | "calculated" | "approved" | "issued" | "settled" | "cancelled";

export interface CapitalEventsTable {
  id: string;
  tenant_id: string;
  fund_id: string;
  kind: EventKind;
  reference: string;
  status: EventStatus;
  issue_date: DateCol;
  input: JSONColumnType<Record<string, unknown>>;
  result_hash: string | null;
  error: JSONColumnType<{ code: string; message: string; ids: string[] } | null>;
  created_by: string;
  version: Generated<number>;
  created_at: Ts;
  calculated_at: Ts | null;
  issued_at: Ts | null;
}

export interface EventLinesTable {
  tenant_id: string;
  event_id: string;
  investor_id: string;
  components: JSONColumnType<string[]>;
  total: Money;
  due_date: DateCol | null;
  detail: JSONColumnType<Record<string, string>>;
  paid: Money;
  status: "open" | "partial" | "paid" | "overpaid" | "nothing_due";
  end_to_end_id: string;
}

export interface ApprovalsTable {
  tenant_id: string;
  event_id: string;
  user_id: string;
  result_hash: string;
  decided_at: Ts;
}

export interface JournalTable {
  id: string;
  tenant_id: string;
  fund_id: string;
  event_id: string | null;
  kind: string;
  booked_at: Ts;
  description: string;
}

export interface PostingsTable {
  tenant_id: string;
  journal_id: string;
  seq: number;
  fund_id: string;
  account: string;
  investor_id: string;
  amount: Money;
}

export interface AccountBalancesTable {
  tenant_id: string;
  fund_id: string;
  account: string;
  investor_id: string;
  balance: Money;
}

export interface BankStatementsTable {
  id: string;
  tenant_id: string;
  msg_id: string;
  sha256: string;
  received_at: Ts;
  entries: number;
}

export interface BankEntriesTable {
  id: string;
  tenant_id: string;
  statement_id: string;
  acct_svcr_ref: string;
  amount: Money;
  booking_date: DateCol;
  end_to_end_id: string | null;
  remittance: string | null;
  debtor_name: string | null;
  debtor_iban: string | null;
  event_id: string | null;
  investor_id: string | null;
  status: "matched" | "unmatched" | "duplicate" | "resolved";
  note: string | null;
}

export interface PaymentFilesTable {
  id: string;
  tenant_id: string;
  event_id: string;
  msg_id: string;
  xml: string;
  sha256: string;
  transactions: number;
  control_sum: Money;
  created_at: Ts;
}

export interface NoticesTable {
  id: string;
  tenant_id: string;
  event_id: string;
  investor_id: string;
  kind: string;
  html: string;
  sha256: string;
  created_at: Ts;
}

export interface AuditLogTable {
  tenant_id: string;
  seq: number;
  at: Ts;
  actor: string;
  action: string;
  entity: string;
  entity_id: string;
  payload: JSONColumnType<Record<string, unknown>>;
  prev_hash: string;
  hash: string;
}

export interface OutboxTable {
  id: string;
  tenant_id: string;
  topic: string;
  payload: JSONColumnType<Record<string, unknown>>;
  status: "pending" | "done" | "failed";
  attempts: Generated<number>;
  last_error: string | null;
  available_at: Ts;
  created_at: Ts;
  processed_at: Ts | null;
}

export interface IdempotencyKeysTable {
  tenant_id: string;
  idem_key: string;
  request_hash: string;
  status_code: number;
  response: JSONColumnType<Record<string, unknown> | unknown[]>;
  created_at: Ts;
}

export interface Database {
  tenants: TenantsTable;
  funds: FundsTable;
  investors: InvestorsTable;
  commitments: CommitmentsTable;
  closings: ClosingsTable;
  side_letters: SideLettersTable;
  provisions: ProvisionsTable;
  mfn_elections: MfnElectionsTable;
  capital_events: CapitalEventsTable;
  event_lines: EventLinesTable;
  approvals: ApprovalsTable;
  journal: JournalTable;
  postings: PostingsTable;
  account_balances: AccountBalancesTable;
  bank_statements: BankStatementsTable;
  bank_entries: BankEntriesTable;
  payment_files: PaymentFilesTable;
  notices: NoticesTable;
  audit_log: AuditLogTable;
  outbox: OutboxTable;
  idempotency_keys: IdempotencyKeysTable;
}

/** Every table here except tenants is scoped by tenant_id; the tenancy guard enforces it. */
export const TENANT_TABLES = new Set<string>([
  "funds",
  "investors",
  "commitments",
  "closings",
  "side_letters",
  "provisions",
  "mfn_elections",
  "capital_events",
  "event_lines",
  "approvals",
  "journal",
  "postings",
  "account_balances",
  "bank_statements",
  "bank_entries",
  "payment_files",
  "notices",
  "audit_log",
  "outbox",
  "idempotency_keys",
]);
