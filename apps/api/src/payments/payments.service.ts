/**
 * Money movement: payment files out (pain.001), bank notifications in (camt.054), and the
 * reconciliation between them and what investors owe.
 *
 * Matching: by EndToEndId first, then by a payment reference found in the remittance text.
 * A re-sent notification is recognised by the bank's own reference (AcctSvcrRef) and booked
 * once. Money nobody can place goes to suspense, never onto a guessed investor; a person
 * resolves it.
 */
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { Transaction } from "kysely";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import type { Principal } from "../auth/principal.js";
import { conflict, notFound, unprocessable } from "../common/errors.js";
import { big, newId, sha256 } from "../common/util.js";
import type { Db } from "../db/database.js";
import { DB } from "../db/db.module.js";
import type { Database } from "../db/schema.js";
import { ACCOUNTS, LedgerService } from "../ledger/ledger.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { pain001, parseCamt054 } from "./iso20022.js";

export const Resolve = z.object({ eventId: z.string(), investorId: z.string(), note: z.string().min(3).max(300) });

const REF = /\b([A-Z0-9][A-Z0-9-]{2,24}-\d{4,6})\b/;

@Injectable()
export class PaymentsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit(): void {
    this.outbox.register("payments.pain001", (tenantId, p) => this.writePaymentFile(tenantId, String(p.eventId)));
  }

  /** Outbox handler: one pain.001 per distribution or closing, for every investor owed money. */
  async writePaymentFile(tenantId: string, eventId: string): Promise<void> {
    const exists = await this.db
      .selectFrom("payment_files")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("event_id", "=", eventId)
      .executeTakeFirst();
    if (exists) return;
    const ev = await this.db
      .selectFrom("capital_events")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "=", eventId)
      .executeTakeFirst();
    if (!ev) return;
    const fund = await this.db
      .selectFrom("funds")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "=", ev.fund_id)
      .executeTakeFirstOrThrow();
    const lines = await this.db
      .selectFrom("event_lines as l")
      .innerJoin("investors as i", (j) => j.onRef("i.id", "=", "l.investor_id").onRef("i.tenant_id", "=", "l.tenant_id"))
      .select(["l.investor_id", "l.total", "l.end_to_end_id", "i.name", "i.iban", "i.bic"])
      .where("l.tenant_id", "=", tenantId)
      .where("l.event_id", "=", eventId)
      .orderBy("l.end_to_end_id")
      .execute();
    // distributions pay positive totals; closings refund negative ones
    const owed = lines
      .map((l) => ({ ...l, amount: ev.kind === "distribution" ? big(l.total) : -big(l.total) }))
      .filter((l) => l.amount > 0n);
    if (owed.length === 0) return;
    const msgId = `${ev.reference}-PAY`.slice(0, 35);
    const { xml, controlSum } = pain001({
      msgId,
      createdAt: new Date().toISOString().slice(0, 19),
      debtorName: fund.name,
      debtorIban: fund.iban,
      debtorBic: fund.bic,
      executionDate: ev.issue_date,
      currency: fund.currency,
      transfers: owed.map((l) => ({
        endToEndId: l.end_to_end_id,
        amount: l.amount,
        creditorName: l.name,
        creditorIban: l.iban,
        creditorBic: l.bic,
        remittance: `${fund.name} ${ev.reference} ${ev.kind === "distribution" ? "distribution" : "equalisation refund"}`,
      })),
    });
    await this.db.transaction().execute(async (trx) => {
      const again = await trx
        .selectFrom("payment_files")
        .select("id")
        .where("tenant_id", "=", tenantId)
        .where("event_id", "=", eventId)
        .forUpdate()
        .executeTakeFirst();
      if (again) return;
      await trx
        .insertInto("payment_files")
        .values({
          id: newId(),
          tenant_id: tenantId,
          event_id: eventId,
          msg_id: msgId,
          xml,
          sha256: sha256(xml),
          transactions: owed.length,
          control_sum: controlSum.toString(),
        })
        .execute();
      // the instruction leaves the fund's account: settle what was payable
      await this.ledger.post(trx, tenantId, fund.id, eventId, "payments.instructed", `${msgId} sent`, [
        ...owed.map((l) => ({ account: ACCOUNTS.payable, investorId: l.investor_id, amount: l.amount })),
        { account: ACCOUNTS.bank, amount: -controlSum },
      ]);
      for (const l of owed) {
        await trx
          .updateTable("event_lines")
          .set({ paid: l.amount.toString(), status: "paid" })
          .where("tenant_id", "=", tenantId)
          .where("event_id", "=", eventId)
          .where("investor_id", "=", l.investor_id)
          .execute();
      }
      await this.audit.append(trx, tenantId, {
        actor: "system:payments",
        action: "payment_file.created",
        entity: "capital_event",
        entityId: eventId,
        payload: { msgId, transactions: owed.length, controlSum: controlSum.toString() },
      });
    });
  }

  async paymentFile(tenantId: string, eventId: string) {
    const f = await this.db
      .selectFrom("payment_files")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("event_id", "=", eventId)
      .executeTakeFirst();
    if (!f) throw notFound("payment file for event", eventId);
    return f;
  }

  /** Import a camt.054 and reconcile every credit in it. Re-importing the same message is a no-op. */
  async importCamt054(p: Principal, fundId: string, xml: string) {
    let parsed: ReturnType<typeof parseCamt054>;
    try {
      parsed = parseCamt054(xml);
    } catch (e) {
      throw unprocessable("INVALID_CAMT054", (e as Error).message);
    }
    return this.db.transaction().execute(async (trx) => {
      const fund = await trx
        .selectFrom("funds")
        .select(["id", "name"])
        .where("tenant_id", "=", p.tenantId)
        .where("id", "=", fundId)
        .forUpdate()
        .executeTakeFirst();
      if (!fund) throw notFound("fund", fundId);
      const seen = await trx
        .selectFrom("bank_statements")
        .select("id")
        .where("tenant_id", "=", p.tenantId)
        .where("msg_id", "=", parsed.msgId)
        .executeTakeFirst();
      if (seen) throw conflict("ALREADY_IMPORTED", `notification ${parsed.msgId} was already imported`, { statementId: seen.id });
      const statementId = newId();
      await trx
        .insertInto("bank_statements")
        .values({ id: statementId, tenant_id: p.tenantId, msg_id: parsed.msgId, sha256: sha256(xml), entries: parsed.entries.length })
        .execute();

      const result = { statementId, matched: 0, unmatched: 0, duplicates: 0, ignored: 0 };
      for (const e of parsed.entries) {
        if (!e.credit) {
          result.ignored += 1;
          continue;
        }
        const dup = await trx
          .selectFrom("bank_entries")
          .select("id")
          .where("tenant_id", "=", p.tenantId)
          .where("acct_svcr_ref", "=", e.acctSvcrRef)
          .where("status", "!=", "duplicate")
          .executeTakeFirst();
        const ref = e.endToEndId ?? REF.exec(e.remittance ?? "")?.[1] ?? null;
        const line =
          !dup && ref
            ? await trx
                .selectFrom("event_lines as l")
                .innerJoin("capital_events as ev", (j) => j.onRef("ev.id", "=", "l.event_id").onRef("ev.tenant_id", "=", "l.tenant_id"))
                .select(["l.event_id", "l.investor_id", "l.total", "l.paid"])
                .where("l.tenant_id", "=", p.tenantId)
                .where("l.end_to_end_id", "=", ref)
                .where("ev.fund_id", "=", fundId)
                .where("ev.status", "in", ["issued", "settled"])
                .executeTakeFirst()
            : undefined;
        const status = dup ? "duplicate" : line ? "matched" : "unmatched";
        await trx
          .insertInto("bank_entries")
          .values({
            id: newId(),
            tenant_id: p.tenantId,
            statement_id: statementId,
            acct_svcr_ref: e.acctSvcrRef,
            amount: e.amount.toString(),
            booking_date: e.bookingDate,
            end_to_end_id: e.endToEndId,
            remittance: e.remittance,
            debtor_name: e.debtorName,
            debtor_iban: e.debtorIban,
            event_id: line?.event_id ?? null,
            investor_id: line?.investor_id ?? null,
            status,
            note: dup ? "already booked from an earlier notification" : null,
          })
          .execute();
        if (dup) {
          result.duplicates += 1;
          continue;
        }
        if (line) {
          await this.applyPayment(trx, p.tenantId, fundId, line.event_id, line.investor_id, e.amount, `${e.acctSvcrRef}`);
          result.matched += 1;
        } else {
          await this.ledger.post(trx, p.tenantId, fundId, null, "payment.unplaced", `unplaced credit ${e.acctSvcrRef}`, [
            { account: ACCOUNTS.bank, amount: e.amount },
            { account: ACCOUNTS.suspense, amount: -e.amount },
          ]);
          result.unmatched += 1;
        }
      }
      await this.audit.append(trx, p.tenantId, {
        actor: p.sub,
        action: "camt054.imported",
        entity: "bank_statement",
        entityId: statementId,
        payload: { msgId: parsed.msgId, ...result },
      });
      return result;
    });
  }

  private async applyPayment(
    trx: Transaction<Database>,
    tenantId: string,
    fundId: string,
    eventId: string,
    investorId: string,
    amount: bigint,
    ref: string,
  ) {
    const line = await trx
      .selectFrom("event_lines")
      .select(["total", "paid"])
      .where("tenant_id", "=", tenantId)
      .where("event_id", "=", eventId)
      .where("investor_id", "=", investorId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const paid = big(line.paid) + amount;
    const total = big(line.total);
    const status = paid === total ? "paid" : paid < total ? "partial" : "overpaid";
    await trx
      .updateTable("event_lines")
      .set({ paid: paid.toString(), status })
      .where("tenant_id", "=", tenantId)
      .where("event_id", "=", eventId)
      .where("investor_id", "=", investorId)
      .execute();
    await this.ledger.post(trx, tenantId, fundId, eventId, "payment.received", `payment ${ref}`, [
      { account: ACCOUNTS.bank, amount },
      { account: ACCOUNTS.receivable, investorId, amount: -amount },
    ]);
    const open = await trx
      .selectFrom("event_lines")
      .select("investor_id")
      .where("tenant_id", "=", tenantId)
      .where("event_id", "=", eventId)
      .where("status", "in", ["open", "partial"])
      .executeTakeFirst();
    if (!open) {
      await trx
        .updateTable("capital_events")
        .set({ status: "settled" })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", eventId)
        .where("status", "=", "issued")
        .execute();
    }
  }

  async entries(tenantId: string, fundId: string, status?: "matched" | "unmatched" | "duplicate" | "resolved") {
    let q = this.db
      .selectFrom("bank_entries as b")
      .innerJoin("bank_statements as s", (j) => j.onRef("s.id", "=", "b.statement_id").onRef("s.tenant_id", "=", "b.tenant_id"))
      .selectAll("b")
      .select("s.msg_id")
      .where("b.tenant_id", "=", tenantId);
    if (status) q = q.where("b.status", "=", status);
    void fundId;
    return q.orderBy("b.booking_date", "desc").limit(500).execute();
  }

  /** A person places an unmatched credit on an investor's line. */
  async resolve(p: Principal, fundId: string, entryId: string, input: z.infer<typeof Resolve>) {
    return this.db.transaction().execute(async (trx) => {
      const e = await trx
        .selectFrom("bank_entries")
        .selectAll()
        .where("tenant_id", "=", p.tenantId)
        .where("id", "=", entryId)
        .forUpdate()
        .executeTakeFirst();
      if (!e) throw notFound("bank entry", entryId);
      if (e.status !== "unmatched") throw conflict("NOT_UNMATCHED", `entry is ${e.status}`);
      const amount = big(e.amount);
      await this.ledger.post(trx, p.tenantId, fundId, input.eventId, "payment.resolved", `placed ${e.acct_svcr_ref}`, [
        { account: ACCOUNTS.suspense, amount },
        { account: ACCOUNTS.bank, amount: -amount },
      ]);
      await this.applyPayment(trx, p.tenantId, fundId, input.eventId, input.investorId, amount, e.acct_svcr_ref);
      await trx
        .updateTable("bank_entries")
        .set({ status: "resolved", event_id: input.eventId, investor_id: input.investorId, note: input.note })
        .where("tenant_id", "=", p.tenantId)
        .where("id", "=", entryId)
        .execute();
      await this.audit.append(trx, p.tenantId, {
        actor: p.sub,
        action: "payment.resolved",
        entity: "bank_entry",
        entityId: entryId,
        payload: input,
      });
      return { id: entryId, status: "resolved" };
    });
  }
}
