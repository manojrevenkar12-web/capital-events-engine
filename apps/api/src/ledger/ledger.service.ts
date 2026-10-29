/**
 * Double-entry ledger. Every journal's postings sum to zero (debits positive, credits negative);
 * postings are immutable (database triggers); balances are maintained in the same transaction
 * and can be re-derived from postings at any time (verify).
 */
import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { DomainError } from "../common/errors.js";
import { big, newId } from "../common/util.js";
import type { Db } from "../db/database.js";
import { DB } from "../db/db.module.js";
import type { Database } from "../db/schema.js";

export interface Posting {
  account: string;
  investorId?: string;
  amount: bigint;
}

export const ACCOUNTS = {
  receivable: "lp.receivable",
  payable: "lp.payable",
  contributed: (kind: "expense" | "fee" | "investment") => `lp.contributed.${kind}`,
  distributed: (tier: "roc" | "pref" | "split") => `lp.distributed.${tier}`,
  bank: "fund.bank",
  carry: "gp.carry",
  gpPayable: "gp.payable",
  equalisationInterest: "fund.equalisation_interest",
  suspense: "fund.suspense",
} as const;

const CHUNK = 500;

@Injectable()
export class LedgerService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async post(
    trx: Transaction<Database>,
    tenantId: string,
    fundId: string,
    eventId: string | null,
    kind: string,
    description: string,
    postings: Posting[],
  ): Promise<string> {
    const lines = postings.filter((p) => p.amount !== 0n);
    if (lines.length < 2) throw new DomainError(500, "LEDGER_UNBALANCED", `journal ${kind} needs two postings`);
    const sum = lines.reduce((s, p) => s + p.amount, 0n);
    if (sum !== 0n) throw new DomainError(500, "LEDGER_UNBALANCED", `journal ${kind} is off by ${sum}`);
    const journalId = newId();
    await trx
      .insertInto("journal")
      .values({ id: journalId, tenant_id: tenantId, fund_id: fundId, event_id: eventId, kind, description })
      .execute();
    for (let i = 0; i < lines.length; i += CHUNK) {
      const chunk = lines.slice(i, i + CHUNK);
      await trx
        .insertInto("postings")
        .values(
          chunk.map((p, j) => ({
            tenant_id: tenantId,
            journal_id: journalId,
            seq: i + j,
            fund_id: fundId,
            account: p.account,
            investor_id: p.investorId ?? "",
            amount: p.amount.toString(),
          })),
        )
        .execute();
    }
    // fold into balances: one row per account and investor
    const folded = new Map<string, Posting>();
    for (const p of lines) {
      const k = `${p.account}|${p.investorId ?? ""}`;
      const cur = folded.get(k);
      folded.set(k, { account: p.account, investorId: p.investorId ?? "", amount: (cur?.amount ?? 0n) + p.amount });
    }
    const rows = [...folded.values()];
    for (let i = 0; i < rows.length; i += CHUNK) {
      await trx
        .insertInto("account_balances")
        .values(
          rows.slice(i, i + CHUNK).map((p) => ({
            tenant_id: tenantId,
            fund_id: fundId,
            account: p.account,
            investor_id: p.investorId ?? "",
            balance: p.amount.toString(),
          })),
        )
        .onDuplicateKeyUpdate({ balance: sql`balance + VALUES(balance)` })
        .execute();
    }
    return journalId;
  }

  /** Balances for a fund as account -> investor -> cents. */
  async balances(tenantId: string, fundId: string, q: Db | Transaction<Database> = this.db) {
    const rows = await q
      .selectFrom("account_balances")
      .select(["account", "investor_id", "balance"])
      .where("tenant_id", "=", tenantId)
      .where("fund_id", "=", fundId)
      .execute();
    const out = new Map<string, Map<string, bigint>>();
    for (const r of rows) {
      const m = out.get(r.account) ?? new Map<string, bigint>();
      m.set(r.investor_id, big(r.balance));
      out.set(r.account, m);
    }
    return out;
  }

  /** Re-derive balances from postings and check every journal balances. */
  async verify(tenantId: string, fundId: string) {
    const derived = await this.db
      .selectFrom("postings")
      .select(["account", "investor_id", sql<string>`SUM(amount)`.as("total")])
      .where("tenant_id", "=", tenantId)
      .where("fund_id", "=", fundId)
      .groupBy(["account", "investor_id"])
      .execute();
    const unbalanced = await this.db
      .selectFrom("postings")
      .select(["journal_id", sql<string>`SUM(amount)`.as("total")])
      .where("tenant_id", "=", tenantId)
      .where("fund_id", "=", fundId)
      .groupBy("journal_id")
      .having(sql`SUM(amount)`, "<>", 0)
      .execute();
    const stored = await this.balances(tenantId, fundId);
    const mismatches: Array<{ account: string; investorId: string; stored: string; derived: string }> = [];
    for (const d of derived) {
      const s = stored.get(d.account)?.get(d.investor_id) ?? 0n;
      if (s !== big(d.total)) mismatches.push({ account: d.account, investorId: d.investor_id, stored: s.toString(), derived: d.total });
    }
    const totalStored = [...stored.values()].flatMap((m) => [...m.values()]).reduce((a, b) => a + b, 0n);
    return {
      ok: mismatches.length === 0 && unbalanced.length === 0 && totalStored === 0n,
      accounts: derived.length,
      unbalancedJournals: unbalanced.map((u) => u.journal_id),
      mismatches,
      trialBalance: totalStored.toString(),
    };
  }
}
