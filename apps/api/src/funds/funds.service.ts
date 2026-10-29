import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import type { Principal } from "../auth/principal.js";
import { conflict, notFound } from "../common/errors.js";
import { big, newId } from "../common/util.js";
import type { Db } from "../db/database.js";
import { DB } from "../db/db.module.js";
import type { Database } from "../db/schema.js";
import { ACCOUNTS, LedgerService } from "../ledger/ledger.service.js";
import { foldTerms, type InvestorTerms, NO_TERMS } from "./terms.js";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cents = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));

export const CreateFund = z.object({
  name: z.string().min(1).max(200),
  currency: z.string().length(3).default("EUR"),
  kind: z.enum(["master", "feeder", "parallel"]).default("master"),
  masterFundId: z.string().optional(),
  feeRateBps: z.number().int().min(0).max(10_000),
  investmentPeriodEnd: iso,
  defaultNoticeDays: z.number().int().min(0).max(60).default(10),
  hurdleBps: z.number().int().min(0).max(5_000).default(800),
  carryBps: z.number().int().min(0).max(9_999).default(2_000),
  equalisationRateBps: z.number().int().min(0).max(5_000).default(600),
  firstCloseDate: iso,
  iban: z.string().min(15).max(34),
  bic: z.string().min(8).max(11),
});

export const CreateInvestor = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(["individual", "institution", "feeder"]),
  country: z.string().length(2),
  kycStatus: z.enum(["pending", "verified", "expired"]).default("pending"),
  iban: z.string().min(15).max(34),
  bic: z.string().min(8).max(11),
  feederFundId: z.string().optional(),
});

export const AddCommitment = z.object({ investorId: z.string(), amount: cents });

export interface FundLp {
  investorId: string;
  name: string;
  commitment: bigint;
  admitted: string;
  contributed: bigint;
  contributedInvestment: bigint;
  returnedCapital: bigint;
  terms: InvestorTerms;
}

@Injectable()
export class FundsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {}

  async createFund(p: Principal, input: z.infer<typeof CreateFund>) {
    const id = newId();
    await this.db.transaction().execute(async (trx) => {
      if (input.masterFundId) await this.fund(p.tenantId, input.masterFundId, trx);
      await trx
        .insertInto("funds")
        .values({
          id,
          tenant_id: p.tenantId,
          name: input.name,
          currency: input.currency,
          kind: input.kind,
          master_fund_id: input.masterFundId ?? null,
          fee_rate_bps: input.feeRateBps,
          investment_period_end: input.investmentPeriodEnd,
          default_notice_days: input.defaultNoticeDays,
          hurdle_bps: input.hurdleBps,
          carry_bps: input.carryBps,
          equalisation_rate_bps: input.equalisationRateBps,
          first_close_date: input.firstCloseDate,
          iban: input.iban,
          bic: input.bic,
        })
        .execute();
      await this.audit.append(trx, p.tenantId, {
        actor: p.sub,
        action: "fund.created",
        entity: "fund",
        entityId: id,
        payload: { name: input.name },
      });
    });
    return this.fund(p.tenantId, id);
  }

  async fund(tenantId: string, id: string, q: Db | Transaction<Database> = this.db) {
    const f = await q.selectFrom("funds").selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    if (!f) throw notFound("fund", id);
    return f;
  }

  async listFunds(tenantId: string) {
    const funds = await this.db.selectFrom("funds").selectAll().where("tenant_id", "=", tenantId).orderBy("name").execute();
    const totals = await this.db
      .selectFrom("commitments")
      .select(["fund_id", (eb) => eb.fn.sum<string>("amount").as("committed"), (eb) => eb.fn.countAll<string>().as("investors")])
      .where("tenant_id", "=", tenantId)
      .groupBy("fund_id")
      .execute();
    const t = new Map(totals.map((r) => [r.fund_id, r]));
    return funds.map((f) => ({ ...f, committed: t.get(f.id)?.committed ?? "0", investors: Number(t.get(f.id)?.investors ?? 0) }));
  }

  async createInvestor(p: Principal, input: z.infer<typeof CreateInvestor>) {
    const id = newId();
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto("investors")
        .values({
          id,
          tenant_id: p.tenantId,
          name: input.name,
          kind: input.kind,
          country: input.country,
          kyc_status: input.kycStatus,
          iban: input.iban,
          bic: input.bic,
          feeder_fund_id: input.feederFundId ?? null,
        })
        .execute();
      await this.audit.append(trx, p.tenantId, { actor: p.sub, action: "investor.created", entity: "investor", entityId: id });
    });
    return { id };
  }

  async listInvestors(tenantId: string, search?: string, limit = 100) {
    let q = this.db.selectFrom("investors").selectAll().where("tenant_id", "=", tenantId);
    if (search) q = q.where("name", "like", `%${search.replace(/[%_]/g, "")}%`);
    return q.orderBy("name").limit(limit).execute();
  }

  /** Commitments at the first closing; later investors come in through a closing (equalisation). */
  async addCommitment(p: Principal, fundId: string, input: z.infer<typeof AddCommitment>) {
    return this.db.transaction().execute(async (trx) => {
      const fund = await this.fund(p.tenantId, fundId, trx);
      const issued = await trx
        .selectFrom("capital_events")
        .select("id")
        .where("tenant_id", "=", p.tenantId)
        .where("fund_id", "=", fundId)
        .where("status", "in", ["issued", "settled"])
        .limit(1)
        .executeTakeFirst();
      if (issued) throw conflict("FIRST_CLOSE_OVER", "the fund has issued capital events; admit investors through a closing");
      const inv = await trx
        .selectFrom("investors")
        .select(["id", "kyc_status"])
        .where("tenant_id", "=", p.tenantId)
        .where("id", "=", input.investorId)
        .executeTakeFirst();
      if (!inv) throw notFound("investor", input.investorId);
      if (inv.kyc_status !== "verified") throw conflict("KYC_NOT_VERIFIED", "an investor must pass KYC before it can commit");
      const id = newId();
      await trx
        .insertInto("commitments")
        .values({
          id,
          tenant_id: p.tenantId,
          fund_id: fundId,
          investor_id: input.investorId,
          amount: input.amount,
          admitted: fund.first_close_date,
        })
        .execute();
      await this.audit.append(trx, p.tenantId, {
        actor: p.sub,
        action: "commitment.added",
        entity: "fund",
        entityId: fundId,
        payload: { investorId: input.investorId, amount: input.amount.toString() },
      });
      return { id };
    });
  }

  async termsByInvestor(tenantId: string, fundId: string, q: Db | Transaction<Database> = this.db): Promise<Map<string, InvestorTerms>> {
    const rows = await q
      .selectFrom("provisions")
      .select(["investor_id", "type", "params"])
      .where("tenant_id", "=", tenantId)
      .where("fund_id", "=", fundId)
      .where("status", "=", "approved")
      .execute();
    const by = new Map<string, Array<{ type: string; params: Record<string, unknown> }>>();
    for (const r of rows) by.set(r.investor_id, [...(by.get(r.investor_id) ?? []), r]);
    return new Map([...by].map(([k, v]) => [k, foldTerms(v)]));
  }

  /** Every LP of the fund with its commitment, ledger position and side-letter terms. */
  async lps(tenantId: string, fundId: string, q: Db | Transaction<Database> = this.db): Promise<FundLp[]> {
    const rows = await q
      .selectFrom("commitments as c")
      .innerJoin("investors as i", (j) => j.onRef("i.id", "=", "c.investor_id").onRef("i.tenant_id", "=", "c.tenant_id"))
      .select(["c.investor_id", "i.name", "c.amount", "c.admitted"])
      .where("c.tenant_id", "=", tenantId)
      .where("c.fund_id", "=", fundId)
      .orderBy("c.investor_id")
      .execute();
    const bal = await this.ledger.balances(tenantId, fundId, q);
    const terms = await this.termsByInvestor(tenantId, fundId, q);
    const credit = (acct: string, id: string) => -(bal.get(acct)?.get(id) ?? 0n);
    return rows.map((r) => {
      const inv = credit(ACCOUNTS.contributed("investment"), r.investor_id);
      const contributed = inv + credit(ACCOUNTS.contributed("expense"), r.investor_id) + credit(ACCOUNTS.contributed("fee"), r.investor_id);
      return {
        investorId: r.investor_id,
        name: r.name,
        commitment: big(r.amount),
        admitted: r.admitted,
        contributed,
        contributedInvestment: inv,
        returnedCapital: bal.get(ACCOUNTS.distributed("roc"))?.get(r.investor_id) ?? 0n,
        terms: terms.get(r.investor_id) ?? NO_TERMS,
      };
    });
  }

  async capitalAccounts(tenantId: string, fundId: string) {
    await this.fund(tenantId, fundId);
    const lps = await this.lps(tenantId, fundId);
    const bal = await this.ledger.balances(tenantId, fundId);
    const get = (a: string, id: string) => bal.get(a)?.get(id) ?? 0n;
    const rows = lps.map((l) => {
      const distributed =
        get(ACCOUNTS.distributed("roc"), l.investorId) +
        get(ACCOUNTS.distributed("pref"), l.investorId) +
        get(ACCOUNTS.distributed("split"), l.investorId);
      return {
        investorId: l.investorId,
        name: l.name,
        commitment: l.commitment.toString(),
        contributed: l.contributed.toString(),
        unfunded: (l.commitment - l.contributed).toString(),
        distributed: distributed.toString(),
        receivable: get(ACCOUNTS.receivable, l.investorId).toString(),
        payable: (-get(ACCOUNTS.payable, l.investorId)).toString(),
        terms: l.terms,
      };
    });
    const sum = (k: "commitment" | "contributed" | "unfunded" | "distributed" | "receivable" | "payable") =>
      rows.reduce((s, r) => s + BigInt(r[k]), 0n).toString();
    return {
      totals: {
        investors: rows.length,
        commitment: sum("commitment"),
        contributed: sum("contributed"),
        unfunded: sum("unfunded"),
        distributed: sum("distributed"),
        receivable: sum("receivable"),
        payable: sum("payable"),
      },
      rows,
    };
  }
}
