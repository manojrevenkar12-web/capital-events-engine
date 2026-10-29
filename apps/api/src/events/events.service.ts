/**
 * Capital events: calls, distributions and closings (equalisation). Each moves
 * draft -> calculated -> approved -> issued -> settled, or is cancelled before issue.
 *
 * - Calculation runs the engine on the fund's current state, under a lock on the fund row, and
 *   stores the lines and a hash of them.
 * - Approval is four-eyes: an approver who did not create the event approves the exact result
 *   (its hash). Recalculating to a different result voids earlier approvals.
 * - Issue recalculates under the fund lock and refuses if the result changed since approval
 *   (another event moved the fund meanwhile), then books the ledger, assigns payment references
 *   and queues notices and payment files through the outbox, all in one transaction.
 */
import {
  addBusinessDays,
  type CallComponent,
  capitalCall,
  distribute,
  EngineError,
  equalise,
  type Flow,
  feederCall,
  type MasterComponent,
  type PriorComponent,
} from "@cee/engine";
import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import type { Principal } from "../auth/principal.js";
import { conflict, forbidden, notFound, unprocessable } from "../common/errors.js";
import { big, canonicalJson, newId, sha256 } from "../common/util.js";
import { type AppConfig, CONFIG } from "../config/config.js";
import { setEndToEndIds } from "../db/bulk.js";
import type { Db } from "../db/database.js";
import { DB } from "../db/db.module.js";
import type { Database, EventKind } from "../db/schema.js";
import { FundsService } from "../funds/funds.service.js";
import { ACCOUNTS, LedgerService, type Posting } from "../ledger/ledger.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import type { CallComponentInput, CreateCall, CreateClosing, CreateDistribution } from "./inputs.js";

type Trx = Transaction<Database>;
type FundRow = Awaited<ReturnType<FundsService["fund"]>>;

export interface Line {
  investorId: string;
  components: bigint[];
  total: bigint;
  dueDate: string | null;
  detail: Record<string, string>;
}

const linesHash = (lines: Line[]): string =>
  sha256(canonicalJson(lines.map((l) => ({ ...l, components: l.components.map(String), total: String(l.total) }))));

const toEngineComponent = (c: CallComponentInput): CallComponent =>
  c.kind === "fee"
    ? { kind: "fee", periodStart: c.periodStart, periodEnd: c.periodEnd }
    : c.kind === "expense"
      ? { kind: "expense", amount: BigInt(c.amount) }
      : { kind: "investment", deal: c.deal, sectors: c.sectors, amount: BigInt(c.amount) };

@Injectable()
export class EventsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly funds: FundsService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ---- create ----------------------------------------------------------------------------

  private async create(
    p: Principal,
    fundId: string,
    kind: EventKind,
    reference: string,
    issueDate: string,
    input: Record<string, unknown>,
  ) {
    await this.funds.fund(p.tenantId, fundId);
    const id = newId();
    await this.db.transaction().execute(async (trx) => {
      const dup = await trx
        .selectFrom("capital_events")
        .select("id")
        .where("tenant_id", "=", p.tenantId)
        .where("fund_id", "=", fundId)
        .where("reference", "=", reference)
        .executeTakeFirst();
      if (dup) throw conflict("DUPLICATE_REFERENCE", `${reference} already exists in this fund`, { id: dup.id });
      await trx
        .insertInto("capital_events")
        .values({
          id,
          tenant_id: p.tenantId,
          fund_id: fundId,
          kind,
          reference,
          status: "draft",
          issue_date: issueDate,
          input: JSON.stringify(input),
          result_hash: null,
          error: JSON.stringify(null),
          created_by: p.sub,
        })
        .execute();
      await this.audit.append(trx, p.tenantId, {
        actor: p.sub,
        action: `${kind}.created`,
        entity: "capital_event",
        entityId: id,
        payload: { reference },
      });
    });
    return this.get(p.tenantId, id);
  }

  createCall(p: Principal, fundId: string, i: z.infer<typeof CreateCall>) {
    return this.create(p, fundId, "call", i.reference, i.issueDate, { components: i.components });
  }

  createDistribution(p: Principal, fundId: string, i: z.infer<typeof CreateDistribution>) {
    return this.create(p, fundId, "distribution", i.reference, i.date, { deal: i.deal, amount: i.amount });
  }

  async createClosing(p: Principal, fundId: string, i: z.infer<typeof CreateClosing>) {
    const ids = i.admissions.map((a) => a.investorId);
    if (new Set(ids).size !== ids.length) throw unprocessable("DUPLICATE_ADMISSION", "an investor is listed twice");
    const kyc = await this.db
      .selectFrom("investors")
      .select(["id", "kyc_status"])
      .where("tenant_id", "=", p.tenantId)
      .where("id", "in", ids)
      .execute();
    const missing = ids.filter((id) => !kyc.some((k) => k.id === id));
    if (missing.length) throw notFound("investor", missing.join(", "));
    const unverified = kyc.filter((k) => k.kyc_status !== "verified").map((k) => k.id);
    if (unverified.length) throw conflict("KYC_NOT_VERIFIED", "every admitted investor must pass KYC", { ids: unverified });
    const ev = await this.create(p, fundId, "equalisation", i.reference, i.closeDate, { admissions: i.admissions });
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto("closings")
        .values({
          id: newId(),
          tenant_id: p.tenantId,
          fund_id: fundId,
          close_date: i.closeDate,
          status: "draft",
          admissions: JSON.stringify(i.admissions),
          event_id: ev.id,
        })
        .execute();
    });
    return ev;
  }

  // ---- read ------------------------------------------------------------------------------

  async get(tenantId: string, id: string) {
    const ev = await this.db
      .selectFrom("capital_events")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .executeTakeFirst();
    if (!ev) throw notFound("capital event", id);
    const approvals = await this.db
      .selectFrom("approvals")
      .select(["user_id", "result_hash", "decided_at"])
      .where("tenant_id", "=", tenantId)
      .where("event_id", "=", id)
      .execute();
    const totals = await this.db
      .selectFrom("event_lines")
      .select([
        (eb) => eb.fn.countAll<string>().as("lines"),
        (eb) => eb.fn.sum<string>("total").as("total"),
        (eb) => eb.fn.sum<string>("paid").as("paid"),
      ])
      .where("tenant_id", "=", tenantId)
      .where("event_id", "=", id)
      .executeTakeFirst();
    return {
      ...ev,
      approvals: approvals.map((a) => ({ ...a, current: a.result_hash === ev.result_hash })),
      totals: { lines: Number(totals?.lines ?? 0), total: totals?.total ?? "0", paid: totals?.paid ?? "0" },
    };
  }

  async list(tenantId: string, fundId: string) {
    return this.db
      .selectFrom("capital_events")
      .select(["id", "kind", "reference", "status", "issue_date", "created_by", "created_at", "issued_at", "error"])
      .where("tenant_id", "=", tenantId)
      .where("fund_id", "=", fundId)
      .orderBy("issue_date", "desc")
      .orderBy("created_at", "desc")
      .execute();
  }

  async lines(tenantId: string, eventId: string, investorId?: string) {
    let q = this.db
      .selectFrom("event_lines as l")
      .innerJoin("investors as i", (j) => j.onRef("i.id", "=", "l.investor_id").onRef("i.tenant_id", "=", "l.tenant_id"))
      .selectAll("l")
      .select("i.name as investor_name")
      .where("l.tenant_id", "=", tenantId)
      .where("l.event_id", "=", eventId);
    if (investorId) q = q.where("l.investor_id", "=", investorId);
    return q.orderBy("l.investor_id").execute();
  }

  // ---- feeders ---------------------------------------------------------------------------

  /** For each feeder fund invested in a master call: what its LPs owe and whether it can collect in time. */
  async feederPlan(tenantId: string, masterEventId: string) {
    const ev = await this.get(tenantId, masterEventId);
    if (ev.kind !== "call") throw unprocessable("NOT_A_CALL", "feeder plans are for capital calls");
    if (!ev.result_hash) throw conflict("NOT_CALCULATED", "calculate the master call first");
    const feeders = await this.db
      .selectFrom("investors as i")
      .innerJoin("funds as f", (j) => j.onRef("f.id", "=", "i.feeder_fund_id").onRef("f.tenant_id", "=", "i.tenant_id"))
      .select(["i.id as investor_id", "f.id as fund_id", "f.name", "f.default_notice_days"])
      .where("i.tenant_id", "=", tenantId)
      .where("i.feeder_fund_id", "is not", null)
      .execute();
    const lines = await this.lines(tenantId, masterEventId);
    const comps = ev.input.components as CallComponentInput[];
    const plans = [];
    for (const fd of feeders) {
      const line = lines.find((l) => l.investor_id === fd.investor_id);
      if (!line) continue;
      const lps = await this.funds.lps(tenantId, fd.fund_id);
      const master: MasterComponent[] = comps.map((c, i) =>
        c.kind === "investment"
          ? { kind: "investment", amount: big(line.components[i]), sectors: c.sectors }
          : { kind: c.kind, amount: big(line.components[i]) },
      );
      const r = feederCall(
        master,
        0n,
        lps.map((l) => ({
          id: l.investorId,
          commitment: l.commitment,
          contributed: l.contributed,
          excuseSectors: l.terms.excuseSectors,
          noticeDays: l.terms.noticeDays,
        })),
        ev.issue_date,
        line.due_date ?? ev.issue_date,
        fd.default_notice_days,
        2,
      );
      plans.push({
        feederFundId: fd.fund_id,
        feederName: fd.name,
        masterLineTotal: line.total,
        masterDueDate: line.due_date,
        latestIssue: r.latestIssue,
        bridgeRequired: r.bridgeRequired,
        investors: r.lines.size,
      });
    }
    return plans;
  }

  /** Create the feeder's own call mirroring its line of the master call (a draft, then the usual workflow). */
  async createFeederCall(p: Principal, masterEventId: string, feederFundId: string, issueDate: string) {
    const ev = await this.get(p.tenantId, masterEventId);
    const feeder = await this.db
      .selectFrom("investors")
      .select("id")
      .where("tenant_id", "=", p.tenantId)
      .where("feeder_fund_id", "=", feederFundId)
      .executeTakeFirst();
    if (!feeder) throw notFound("feeder investor for fund", feederFundId);
    const line = (await this.lines(p.tenantId, masterEventId, feeder.id))[0];
    if (!line || !ev.result_hash) throw conflict("NOT_CALCULATED", "calculate the master call first");
    const comps = (ev.input.components as CallComponentInput[]).map((c, i): CallComponentInput => {
      const amount = String(big(line.components[i]));
      if (c.kind === "investment") return { ...c, amount };
      return { kind: "expense", amount, description: c.kind === "fee" ? "Master fund management fee" : "Master fund expenses" };
    });
    return this.createCall(p, feederFundId, { reference: `${ev.reference}-F`.slice(0, 25), issueDate, components: comps });
  }

  // ---- calculate -------------------------------------------------------------------------

  private async lockFund(trx: Trx, tenantId: string, fundId: string): Promise<FundRow> {
    const f = await trx
      .selectFrom("funds")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "=", fundId)
      .forUpdate()
      .executeTakeFirst();
    if (!f) throw notFound("fund", fundId);
    return f;
  }

  /** Compute the event's lines from the fund's current state. Pure with respect to the database. */
  async compute(
    trx: Trx,
    tenantId: string,
    fund: FundRow,
    ev: { id: string; kind: EventKind; issue_date: string; input: Record<string, unknown> },
  ): Promise<Line[]> {
    if (ev.kind === "call") return this.computeCall(trx, tenantId, fund, ev);
    if (ev.kind === "distribution") return this.computeDistribution(trx, tenantId, fund, ev);
    return this.computeEqualisation(trx, tenantId, fund, ev);
  }

  private async computeCall(
    trx: Trx,
    tenantId: string,
    fund: FundRow,
    ev: { issue_date: string; input: Record<string, unknown> },
  ): Promise<Line[]> {
    const lps = await this.funds.lps(tenantId, fund.id, trx);
    const comps = (ev.input.components as CallComponentInput[]).map(toEngineComponent);
    const result = capitalCall(
      { feeRateBps: fund.fee_rate_bps, investmentPeriodEnd: fund.investment_period_end, defaultNoticeDays: fund.default_notice_days },
      ev.issue_date,
      lps.map((l) => ({
        id: l.investorId,
        commitment: l.commitment,
        contributed: l.contributed,
        netInvested: l.contributedInvestment - l.returnedCapital,
        admitted: l.admitted,
        feeDiscountBps: l.terms.feeDiscountBps,
        excuseSectors: l.terms.excuseSectors,
        noticeDays: l.terms.noticeDays,
      })),
      comps,
    );
    return [...result].map(([investorId, r]) => ({ investorId, components: r.components, total: r.total, dueDate: r.dueDate, detail: {} }));
  }

  /** Every issued call/equalisation component, with what each LP paid for it (net of later closings). */
  private async componentHistory(trx: Trx, tenantId: string, fund: FundRow) {
    const events = await trx
      .selectFrom("capital_events")
      .select(["id", "kind", "issue_date", "input"])
      .where("tenant_id", "=", tenantId)
      .where("fund_id", "=", fund.id)
      .where("status", "in", ["issued", "settled"])
      .orderBy("issue_date")
      .orderBy("issued_at")
      .execute();
    const ids = events.map((e) => e.id);
    const lines = ids.length
      ? await trx.selectFrom("event_lines").selectAll().where("tenant_id", "=", tenantId).where("event_id", "in", ids).execute()
      : [];
    const byEvent = new Map<string, typeof lines>();
    for (const l of lines) byEvent.set(l.event_id, [...(byEvent.get(l.event_id) ?? []), l]);

    const components: Array<{ key: string; c: CallComponentInput; due: string; paid: Map<string, bigint> }> = [];
    const index = new Map<string, (typeof components)[number]>();
    const flows = new Map<string, { contributions: Flow[]; distributions: Flow[]; roc: bigint; pref: bigint; catchUp: bigint }>();
    const flow = (id: string) => {
      let f = flows.get(id);
      if (!f) {
        f = { contributions: [], distributions: [], roc: 0n, pref: 0n, catchUp: 0n };
        flows.set(id, f);
      }
      return f;
    };
    for (const e of events) {
      const ls = byEvent.get(e.id) ?? [];
      if (e.kind === "call") {
        const comps = e.input.components as CallComponentInput[];
        const due = addBusinessDays(e.issue_date, fund.default_notice_days);
        comps.forEach((c, i) => {
          const entry = { key: `${e.id}:${i}`, c, due, paid: new Map(ls.map((l) => [l.investor_id, big(l.components[i])])) };
          components.push(entry);
          index.set(entry.key, entry);
        });
        for (const l of ls)
          if (big(l.total) > 0n) flow(l.investor_id).contributions.push({ date: l.due_date ?? e.issue_date, amount: big(l.total) });
      } else if (e.kind === "equalisation") {
        for (const l of ls) {
          const keys = JSON.parse(l.detail.keys ?? "[]") as string[];
          keys.forEach((k, i) => {
            const entry = index.get(k);
            if (entry) entry.paid.set(l.investor_id, (entry.paid.get(l.investor_id) ?? 0n) + big(l.components[i]));
          });
          // net capital and fee paid in (or refunded) at the closing
          const moved = big(l.detail.capital_delta) + big(l.detail.fee_catch_up);
          const f = flow(l.investor_id);
          if (moved > 0n) f.contributions.push({ date: e.issue_date, amount: moved });
          else if (moved < 0n) {
            // a refund reduces the latest contributions first
            let left = -moved;
            for (let i = f.contributions.length - 1; i >= 0 && left > 0n; i--) {
              const c = f.contributions[i];
              if (!c) continue;
              const take = c.amount < left ? c.amount : left;
              f.contributions[i] = { ...c, amount: c.amount - take };
              left -= take;
            }
          }
        }
        // admissions committed at this closing join the components from now on
        for (const entry of components) for (const l of ls) if (!entry.paid.has(l.investor_id)) entry.paid.set(l.investor_id, 0n);
      } else {
        for (const l of ls) {
          const f = flow(l.investor_id);
          if (big(l.total) > 0n) f.distributions.push({ date: e.issue_date, amount: big(l.total) });
          f.roc += big(l.detail.roc);
          f.pref += big(l.detail.pref);
          f.catchUp += big(l.detail.catch_up);
        }
      }
    }
    return { components, flows };
  }

  private async computeDistribution(
    trx: Trx,
    tenantId: string,
    fund: FundRow,
    ev: { issue_date: string; input: Record<string, unknown> },
  ): Promise<Line[]> {
    const lps = await this.funds.lps(tenantId, fund.id, trx);
    const { components, flows } = await this.componentHistory(trx, tenantId, fund);
    const deal = String(ev.input.deal);
    const dealContribution = new Map<string, bigint>();
    for (const entry of components) {
      if (entry.c.kind === "investment" && entry.c.deal === deal) {
        for (const [id, v] of entry.paid) dealContribution.set(id, (dealContribution.get(id) ?? 0n) + v);
      }
    }
    if ([...dealContribution.values()].every((v) => v === 0n)) throw unprocessable("UNKNOWN_DEAL", `no LP has funded deal ${deal}`);
    const result = distribute(
      ev.issue_date,
      BigInt(String(ev.input.amount)),
      fund.hurdle_bps,
      fund.carry_bps,
      lps.map((l) => {
        const f = flows.get(l.investorId);
        return {
          id: l.investorId,
          dealContribution: dealContribution.get(l.investorId) ?? 0n,
          carryDiscountBps: l.terms.carryDiscountBps,
          contributions: (f?.contributions ?? []).filter((c) => c.amount > 0n),
          distributions: f?.distributions ?? [],
          priorRoc: f?.roc ?? 0n,
          priorPref: f?.pref ?? 0n,
          priorCatchUp: f?.catchUp ?? 0n,
        };
      }),
    );
    return [...result].map(([investorId, r]) => ({
      investorId,
      components: [r.gross],
      total: r.lpTotal,
      dueDate: ev.issue_date,
      detail: {
        gross: String(r.gross),
        roc: String(r.roc),
        pref: String(r.pref),
        catch_up: String(r.catchUp),
        gp_split: String(r.gpSplit),
        lp_split: String(r.lpSplit),
        gp_total: String(r.gpTotal),
      },
    }));
  }

  private async computeEqualisation(
    trx: Trx,
    tenantId: string,
    fund: FundRow,
    ev: { issue_date: string; input: Record<string, unknown> },
  ): Promise<Line[]> {
    const lps = await this.funds.lps(tenantId, fund.id, trx);
    const admissions = ev.input.admissions as Array<{ investorId: string; amount: string }>;
    const terms = await this.funds.termsByInvestor(tenantId, fund.id, trx);
    const after = new Map(lps.map((l) => [l.investorId, l.commitment]));
    for (const a of admissions) after.set(a.investorId, (after.get(a.investorId) ?? 0n) + BigInt(a.amount));
    const { components } = await this.componentHistory(trx, tenantId, fund);
    const prior: PriorComponent[] = components.map((e) => {
      if (e.c.kind === "fee") return { kind: "fee", dueDate: e.due, periodStart: e.c.periodStart, periodEnd: e.c.periodEnd, paid: e.paid };
      if (e.c.kind === "investment") return { kind: "investment", dueDate: e.due, sectors: e.c.sectors, paid: e.paid };
      return { kind: "expense", dueDate: e.due, paid: e.paid };
    });
    const result = equalise(
      { feeRateBps: fund.fee_rate_bps, investmentPeriodEnd: fund.investment_period_end },
      ev.issue_date,
      fund.equalisation_rate_bps,
      [...after].map(([id, commitment]) => ({
        id,
        commitment,
        excuseSectors: terms.get(id)?.excuseSectors ?? [],
        feeDiscountBps: terms.get(id)?.feeDiscountBps ?? 0,
      })),
      prior,
    );
    const keys = JSON.stringify(components.map((c) => c.key));
    const kinds = JSON.stringify(components.map((c) => c.c.kind));
    const payDue = addBusinessDays(ev.issue_date, fund.default_notice_days);
    return [...result].map(([investorId, r]) => ({
      investorId,
      components: r.deltas,
      total: r.net,
      dueDate: r.net > 0n ? payDue : ev.issue_date,
      detail: {
        capital_delta: String(r.capitalDelta),
        fee_catch_up: String(r.feeCatchUp),
        interest_paid: String(r.interestPaid),
        interest_received: String(r.interestReceived),
        commitment_after: String(after.get(investorId) ?? 0n),
        keys,
        kinds,
      },
    }));
  }

  private async storeLines(trx: Trx, tenantId: string, eventId: string, lines: Line[]): Promise<void> {
    await trx.deleteFrom("event_lines").where("tenant_id", "=", tenantId).where("event_id", "=", eventId).execute();
    for (let i = 0; i < lines.length; i += 500) {
      await trx
        .insertInto("event_lines")
        .values(
          lines.slice(i, i + 500).map((l, j) => ({
            tenant_id: tenantId,
            event_id: eventId,
            investor_id: l.investorId,
            components: JSON.stringify(l.components.map(String)),
            total: l.total.toString(),
            due_date: l.dueDate,
            detail: JSON.stringify(l.detail),
            paid: "0",
            status: l.total === 0n ? ("nothing_due" as const) : ("open" as const),
            // a placeholder until issue assigns the payment reference
            end_to_end_id: `DRAFT-${eventId.slice(-12)}-${i + j}`,
          })),
        )
        .execute();
    }
  }

  async calculate(p: Principal, eventId: string) {
    const outcome = await this.db.transaction().execute(async (trx) => {
      const ev = await trx
        .selectFrom("capital_events")
        .selectAll()
        .where("tenant_id", "=", p.tenantId)
        .where("id", "=", eventId)
        .forUpdate()
        .executeTakeFirst();
      if (!ev) throw notFound("capital event", eventId);
      if (!["draft", "calculated", "approved"].includes(ev.status)) throw conflict("NOT_EDITABLE", `event is ${ev.status}`);
      const fund = await this.lockFund(trx, p.tenantId, ev.fund_id);
      try {
        const lines = await this.compute(trx, p.tenantId, fund, ev);
        const hash = linesHash(lines);
        await this.storeLines(trx, p.tenantId, eventId, lines);
        const approved = await this.approvalCount(trx, p.tenantId, eventId, hash);
        await trx
          .updateTable("capital_events")
          .set({
            status: approved >= this.config.REQUIRED_APPROVALS ? "approved" : "calculated",
            result_hash: hash,
            error: JSON.stringify(null),
            calculated_at: new Date(),
            version: (eb) => eb("version", "+", 1),
          })
          .where("tenant_id", "=", p.tenantId)
          .where("id", "=", eventId)
          .execute();
        await this.audit.append(trx, p.tenantId, {
          actor: p.sub,
          action: `${ev.kind}.calculated`,
          entity: "capital_event",
          entityId: eventId,
          payload: { hash, lines: lines.length },
        });
        return { ok: true as const };
      } catch (e) {
        if (!(e instanceof EngineError) && !(e instanceof Error && "code" in e && (e as { code: string }).code === "UNKNOWN_DEAL")) throw e;
        const err =
          e instanceof EngineError
            ? { code: e.code, message: e.message, ids: e.ids }
            : { code: "UNKNOWN_DEAL", message: e.message, ids: [] };
        await trx.deleteFrom("event_lines").where("tenant_id", "=", p.tenantId).where("event_id", "=", eventId).execute();
        await trx
          .updateTable("capital_events")
          .set({ status: "draft", result_hash: null, error: JSON.stringify(err) })
          .where("tenant_id", "=", p.tenantId)
          .where("id", "=", eventId)
          .execute();
        await this.audit.append(trx, p.tenantId, {
          actor: p.sub,
          action: `${ev.kind}.calculation_failed`,
          entity: "capital_event",
          entityId: eventId,
          payload: err,
        });
        return { ok: false as const, err };
      }
    });
    if (!outcome.ok) throw unprocessable(outcome.err.code, outcome.err.message, { ids: outcome.err.ids });
    return this.get(p.tenantId, eventId);
  }

  private async approvalCount(trx: Trx, tenantId: string, eventId: string, hash: string): Promise<number> {
    const r = await trx
      .selectFrom("approvals")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("tenant_id", "=", tenantId)
      .where("event_id", "=", eventId)
      .where("result_hash", "=", hash)
      .executeTakeFirst();
    return Number(r?.n ?? 0);
  }

  // ---- approve ---------------------------------------------------------------------------

  async approve(p: Principal, eventId: string, expectedHash: string) {
    await this.db.transaction().execute(async (trx) => {
      const ev = await trx
        .selectFrom("capital_events")
        .selectAll()
        .where("tenant_id", "=", p.tenantId)
        .where("id", "=", eventId)
        .forUpdate()
        .executeTakeFirst();
      if (!ev) throw notFound("capital event", eventId);
      if (!["calculated", "approved"].includes(ev.status) || !ev.result_hash) throw conflict("NOT_CALCULATED", `event is ${ev.status}`);
      if (ev.created_by === p.sub) throw forbidden("FOUR_EYES", "the person who prepared an event cannot approve it");
      if (ev.result_hash !== expectedHash) {
        throw conflict("RESULT_CHANGED", "the result was recalculated since you reviewed it", { current: ev.result_hash });
      }
      await trx
        .insertInto("approvals")
        .values({ tenant_id: p.tenantId, event_id: eventId, user_id: p.sub, result_hash: ev.result_hash })
        .onDuplicateKeyUpdate({ result_hash: ev.result_hash, decided_at: new Date() })
        .execute();
      const n = await this.approvalCount(trx, p.tenantId, eventId, ev.result_hash);
      if (n >= this.config.REQUIRED_APPROVALS) {
        await trx
          .updateTable("capital_events")
          .set({ status: "approved" })
          .where("tenant_id", "=", p.tenantId)
          .where("id", "=", eventId)
          .execute();
      }
      await this.audit.append(trx, p.tenantId, {
        actor: p.sub,
        action: `${ev.kind}.approved`,
        entity: "capital_event",
        entityId: eventId,
        payload: { hash: ev.result_hash, approvals: n },
      });
    });
    return this.get(p.tenantId, eventId);
  }

  async cancel(p: Principal, eventId: string) {
    await this.db.transaction().execute(async (trx) => {
      const ev = await trx
        .selectFrom("capital_events")
        .selectAll()
        .where("tenant_id", "=", p.tenantId)
        .where("id", "=", eventId)
        .forUpdate()
        .executeTakeFirst();
      if (!ev) throw notFound("capital event", eventId);
      if (["issued", "settled", "cancelled"].includes(ev.status))
        throw conflict("NOT_CANCELLABLE", `event is ${ev.status}; issued events are reversed, not cancelled`);
      await trx
        .updateTable("capital_events")
        .set({ status: "cancelled" })
        .where("tenant_id", "=", p.tenantId)
        .where("id", "=", eventId)
        .execute();
      if (ev.kind === "equalisation") {
        await trx
          .updateTable("closings")
          .set({ status: "cancelled" })
          .where("tenant_id", "=", p.tenantId)
          .where("event_id", "=", eventId)
          .execute();
      }
      await this.audit.append(trx, p.tenantId, {
        actor: p.sub,
        action: `${ev.kind}.cancelled`,
        entity: "capital_event",
        entityId: eventId,
      });
    });
    return this.get(p.tenantId, eventId);
  }

  // ---- issue -----------------------------------------------------------------------------

  async issue(p: Principal, eventId: string) {
    await this.db.transaction().execute(async (trx) => {
      const ev = await trx
        .selectFrom("capital_events")
        .selectAll()
        .where("tenant_id", "=", p.tenantId)
        .where("id", "=", eventId)
        .forUpdate()
        .executeTakeFirst();
      if (!ev) throw notFound("capital event", eventId);
      if (ev.status !== "approved" || !ev.result_hash) throw conflict("NOT_APPROVED", `event is ${ev.status}`);
      const fund = await this.lockFund(trx, p.tenantId, ev.fund_id);
      const lines = await this.compute(trx, p.tenantId, fund, ev);
      if (linesHash(lines) !== ev.result_hash) {
        throw conflict("STALE_CALCULATION", "the fund changed since this event was approved; recalculate and approve again");
      }
      const width = Math.max(4, String(lines.length).length);
      const sorted = [...lines].sort((a, b) => (a.investorId < b.investorId ? -1 : 1));
      await setEndToEndIds(
        trx,
        p.tenantId,
        eventId,
        sorted.map((l, n) => ({ investorId: l.investorId, e2e: `${ev.reference}-${String(n + 1).padStart(width, "0")}`.slice(0, 35) })),
      );
      await this.book(trx, p.tenantId, fund, ev, lines);
      if (ev.kind === "equalisation") await this.admit(trx, p.tenantId, fund, ev, lines);
      await trx
        .updateTable("capital_events")
        .set({ status: "issued", issued_at: new Date(), version: (eb) => eb("version", "+", 1) })
        .where("tenant_id", "=", p.tenantId)
        .where("id", "=", eventId)
        .execute();
      await this.outbox.enqueue(trx, p.tenantId, "notices.render", { eventId });
      if (ev.kind !== "call") await this.outbox.enqueue(trx, p.tenantId, "payments.pain001", { eventId });
      await this.audit.append(trx, p.tenantId, {
        actor: p.sub,
        action: `${ev.kind}.issued`,
        entity: "capital_event",
        entityId: eventId,
        payload: { hash: ev.result_hash, total: lines.reduce((s, l) => s + l.total, 0n).toString(), lines: lines.length },
      });
    });
    return this.get(p.tenantId, eventId);
  }

  private async book(
    trx: Trx,
    tenantId: string,
    fund: FundRow,
    ev: { id: string; kind: EventKind; reference: string; input: Record<string, unknown> },
    lines: Line[],
  ) {
    const postings: Posting[] = [];
    if (ev.kind === "call") {
      const comps = ev.input.components as CallComponentInput[];
      for (const l of lines) {
        if (l.total === 0n) continue;
        postings.push({ account: ACCOUNTS.receivable, investorId: l.investorId, amount: l.total });
        for (const [i, c] of comps.entries()) {
          postings.push({ account: ACCOUNTS.contributed(c.kind), investorId: l.investorId, amount: -(l.components[i] ?? 0n) });
        }
      }
    } else if (ev.kind === "distribution") {
      for (const l of lines) {
        const d = l.detail;
        postings.push(
          { account: ACCOUNTS.distributed("roc"), investorId: l.investorId, amount: big(d.roc) },
          { account: ACCOUNTS.distributed("pref"), investorId: l.investorId, amount: big(d.pref) },
          { account: ACCOUNTS.distributed("split"), investorId: l.investorId, amount: big(d.lp_split) },
          { account: ACCOUNTS.carry, investorId: l.investorId, amount: big(d.gp_total) },
          { account: ACCOUNTS.payable, investorId: l.investorId, amount: -l.total },
          { account: ACCOUNTS.gpPayable, amount: -big(d.gp_total) },
        );
      }
    } else {
      for (const l of lines) {
        const kinds = JSON.parse(l.detail.kinds ?? "[]") as Array<"expense" | "fee" | "investment">;
        for (const [i, v] of l.components.entries()) {
          postings.push({ account: ACCOUNTS.contributed(kinds[i] ?? "expense"), investorId: l.investorId, amount: -v });
        }
        postings.push({ account: ACCOUNTS.equalisationInterest, amount: -big(l.detail.interest_paid) + big(l.detail.interest_received) });
        postings.push({ account: l.total >= 0n ? ACCOUNTS.receivable : ACCOUNTS.payable, investorId: l.investorId, amount: l.total });
      }
    }
    await this.ledger.post(trx, tenantId, fund.id, ev.id, `${ev.kind}.issued`, `${ev.reference} issued`, postings);
  }

  private async admit(
    trx: Trx,
    tenantId: string,
    fund: FundRow,
    ev: { id: string; issue_date: string; input: Record<string, unknown> },
    lines: Line[],
  ) {
    const admissions = ev.input.admissions as Array<{ investorId: string; amount: string }>;
    for (const a of admissions) {
      const after = lines.find((l) => l.investorId === a.investorId)?.detail.commitment_after;
      const existing = await trx
        .selectFrom("commitments")
        .select("id")
        .where("tenant_id", "=", tenantId)
        .where("fund_id", "=", fund.id)
        .where("investor_id", "=", a.investorId)
        .executeTakeFirst();
      if (existing) {
        await trx
          .updateTable("commitments")
          .set({ amount: String(after) })
          .where("tenant_id", "=", tenantId)
          .where("id", "=", existing.id)
          .execute();
      } else {
        await trx
          .insertInto("commitments")
          .values({
            id: newId(),
            tenant_id: tenantId,
            fund_id: fund.id,
            investor_id: a.investorId,
            amount: String(after ?? a.amount),
            admitted: ev.issue_date,
          })
          .execute();
      }
    }
    await trx
      .updateTable("closings")
      .set({ status: "completed" })
      .where("tenant_id", "=", tenantId)
      .where("event_id", "=", ev.id)
      .execute();
  }
}
