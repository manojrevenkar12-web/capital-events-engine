/**
 * Investor notices: one per investor per issued event, rendered once after issue (outbox) and
 * shown in the investor portal. Calls carry the payment instructions and the reference the
 * bank statement will be matched on.
 */
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { big, escapeHtml, formatMoney, newId, sha256 } from "../common/util.js";
import type { Db } from "../db/database.js";
import { DB } from "../db/db.module.js";
import { OutboxService } from "../outbox/outbox.service.js";

const LABEL: Record<string, string> = { expense: "Fund expenses", fee: "Management fee", investment: "Investment" };

@Injectable()
export class NoticesService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit(): void {
    this.outbox.register("notices.render", (tenantId, p) => this.render(tenantId, String(p.eventId)));
  }

  async render(tenantId: string, eventId: string): Promise<void> {
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
      .selectAll("l")
      .select("i.name")
      .where("l.tenant_id", "=", tenantId)
      .where("l.event_id", "=", eventId)
      .execute();
    const done = new Set(
      (
        await this.db
          .selectFrom("notices")
          .select("investor_id")
          .where("tenant_id", "=", tenantId)
          .where("event_id", "=", eventId)
          .execute()
      ).map((n) => n.investor_id),
    );
    const money = (c: bigint) => escapeHtml(formatMoney(c, fund.currency));
    const rows: Array<{
      id: string;
      tenant_id: string;
      event_id: string;
      investor_id: string;
      kind: string;
      html: string;
      sha256: string;
    }> = [];
    for (const l of lines) {
      if (done.has(l.investor_id) || big(l.total) === 0n) continue;
      let body = "";
      if (ev.kind === "call") {
        const comps = ev.input.components as Array<{ kind: string; deal?: string; periodStart?: string; periodEnd?: string }>;
        body = `<table>${comps
          .map((c, i) => {
            const what =
              c.kind === "investment"
                ? `${LABEL[c.kind]} (${escapeHtml(c.deal ?? "")})`
                : c.kind === "fee"
                  ? `${LABEL.fee} ${c.periodStart} to ${c.periodEnd}`
                  : LABEL[c.kind];
            return `<tr><td>${what}</td><td class="n">${money(big(l.components[i]))}</td></tr>`;
          })
          .join("")}<tr class="total"><td>Total due</td><td class="n">${money(big(l.total))}</td></tr></table>
          <p>Please pay by <strong>${l.due_date}</strong> to ${escapeHtml(fund.name)}, IBAN ${escapeHtml(fund.iban)}, BIC ${escapeHtml(fund.bic)},
          quoting the reference <strong>${escapeHtml(l.end_to_end_id)}</strong>.</p>`;
      } else if (ev.kind === "distribution") {
        const d = l.detail;
        body = `<table>
          <tr><td>Return of capital</td><td class="n">${money(big(d.roc))}</td></tr>
          <tr><td>Preferred return</td><td class="n">${money(big(d.pref))}</td></tr>
          <tr><td>Share of profits</td><td class="n">${money(big(d.lp_split))}</td></tr>
          <tr class="total"><td>Paid to you</td><td class="n">${money(big(l.total))}</td></tr>
          <tr><td>Carried interest withheld</td><td class="n">${money(big(d.gp_total))}</td></tr></table>
          <p>Paid on ${ev.issue_date}, reference ${escapeHtml(l.end_to_end_id)}.</p>`;
      } else {
        const d = l.detail;
        const pay = big(l.total) > 0n;
        body = `<table>
          <tr><td>Capital equalisation</td><td class="n">${money(big(d.capital_delta))}</td></tr>
          <tr><td>Management fee catch-up</td><td class="n">${money(big(d.fee_catch_up))}</td></tr>
          <tr><td>Equalisation interest paid</td><td class="n">${money(big(d.interest_paid))}</td></tr>
          <tr><td>Equalisation interest received</td><td class="n">${money(big(d.interest_received))}</td></tr>
          <tr class="total"><td>${pay ? "Total due" : "Refunded to you"}</td><td class="n">${money(pay ? big(l.total) : -big(l.total))}</td></tr></table>
          <p>${pay ? `Please pay by <strong>${l.due_date}</strong> quoting <strong>${escapeHtml(l.end_to_end_id)}</strong>.` : `Refund reference ${escapeHtml(l.end_to_end_id)}.`}</p>`;
      }
      const title =
        ev.kind === "call" ? "Capital call notice" : ev.kind === "distribution" ? "Distribution notice" : "Closing and equalisation notice";
      const html = `<article class="notice"><header><h1>${title}</h1><p>${escapeHtml(fund.name)} · ${escapeHtml(ev.reference)} · ${ev.issue_date}</p>
        <p>To ${escapeHtml(l.name)}</p></header>${body}</article>`;
      rows.push({
        id: newId(),
        tenant_id: tenantId,
        event_id: eventId,
        investor_id: l.investor_id,
        kind: ev.kind,
        html,
        sha256: sha256(html),
      });
    }
    for (let i = 0; i < rows.length; i += 200) {
      await this.db
        .insertInto("notices")
        .values(rows.slice(i, i + 200))
        .onDuplicateKeyUpdate({ sha256: (eb) => eb.ref("notices.sha256") })
        .execute();
    }
  }

  async forInvestor(tenantId: string, investorId: string) {
    return this.db
      .selectFrom("notices as n")
      .innerJoin("capital_events as e", (j) => j.onRef("e.id", "=", "n.event_id").onRef("e.tenant_id", "=", "n.tenant_id"))
      .innerJoin("funds as f", (j) => j.onRef("f.id", "=", "e.fund_id").onRef("f.tenant_id", "=", "e.tenant_id"))
      .select(["n.id", "n.kind", "n.html", "n.created_at", "e.reference", "e.issue_date", "f.name as fund_name"])
      .where("n.tenant_id", "=", tenantId)
      .where("n.investor_id", "=", investorId)
      .orderBy("e.issue_date", "desc")
      .execute();
  }
}
