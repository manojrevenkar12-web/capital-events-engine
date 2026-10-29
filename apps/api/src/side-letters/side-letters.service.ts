/**
 * Side letters: upload, extraction (async, through the outbox), review with four eyes, the
 * compendium of approved terms, and MFN elections computed by the engine.
 */
import { mfnEligible } from "@cee/engine";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import type { Principal } from "../auth/principal.js";
import { conflict, forbidden, notFound } from "../common/errors.js";
import { big, newId, sha256 } from "../common/util.js";
import { type AppConfig, CONFIG } from "../config/config.js";
import type { Db } from "../db/database.js";
import { DB } from "../db/db.module.js";
import { FundsService } from "../funds/funds.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { ClaudeExtractor, type Extractor, ground, ParamSchemas, RulesExtractor } from "./extractor.js";

export const UploadSideLetter = z.object({
  investorId: z.string(),
  title: z.string().min(1).max(300),
  body: z.string().min(20).max(500_000),
});

export const Decision = z.object({
  decision: z.enum(["approve", "reject"]),
  /** A reviewer may correct the parameters before approving; the quote stays as extracted. */
  params: z.record(z.string(), z.unknown()).optional(),
});

export const Election = z.object({ provisionIds: z.array(z.string()).max(200) });

@Injectable()
export class SideLettersService implements OnModuleInit {
  private readonly log = new Logger("side-letters");
  readonly extractor: Extractor;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) config: AppConfig,
    private readonly audit: AuditService,
    private readonly funds: FundsService,
    private readonly outbox: OutboxService,
  ) {
    this.extractor =
      config.EXTRACTOR === "claude" && config.ANTHROPIC_API_KEY
        ? new ClaudeExtractor(config.ANTHROPIC_API_KEY, config.ANTHROPIC_MODEL)
        : new RulesExtractor();
  }

  onModuleInit(): void {
    this.outbox.register("side_letter.extract", (tenantId, p) => this.extract(tenantId, String(p.sideLetterId)));
  }

  async upload(p: Principal, fundId: string, input: z.infer<typeof UploadSideLetter>) {
    await this.funds.fund(p.tenantId, fundId);
    const id = newId();
    const digest = sha256(input.body);
    await this.db.transaction().execute(async (trx) => {
      const dup = await trx
        .selectFrom("side_letters")
        .select("id")
        .where("tenant_id", "=", p.tenantId)
        .where("fund_id", "=", fundId)
        .where("sha256", "=", digest)
        .executeTakeFirst();
      if (dup) throw conflict("DUPLICATE_SIDE_LETTER", "this letter was already uploaded", { id: dup.id });
      const commitment = await trx
        .selectFrom("commitments")
        .select("id")
        .where("tenant_id", "=", p.tenantId)
        .where("fund_id", "=", fundId)
        .where("investor_id", "=", input.investorId)
        .executeTakeFirst();
      if (!commitment) throw conflict("NOT_AN_INVESTOR", "the investor has no commitment in this fund");
      await trx
        .insertInto("side_letters")
        .values({
          id,
          tenant_id: p.tenantId,
          fund_id: fundId,
          investor_id: input.investorId,
          title: input.title,
          body: input.body,
          sha256: digest,
          status: "extracting",
          uploaded_by: p.sub,
        })
        .execute();
      await this.outbox.enqueue(trx, p.tenantId, "side_letter.extract", { sideLetterId: id });
      await this.audit.append(trx, p.tenantId, {
        actor: p.sub,
        action: "side_letter.uploaded",
        entity: "side_letter",
        entityId: id,
        payload: { sha256: digest },
      });
    });
    return { id, status: "extracting" };
  }

  /** Outbox handler: extract, ground, store as proposed. Idempotent: does nothing twice. */
  async extract(tenantId: string, sideLetterId: string): Promise<void> {
    const sl = await this.db
      .selectFrom("side_letters")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "=", sideLetterId)
      .executeTakeFirst();
    if (sl?.status !== "extracting") return;
    const fund = await this.funds.fund(tenantId, sl.fund_id);
    const proposed = await this.extractor.extract(sl.body, { feeRateBps: fund.fee_rate_bps, carryBps: fund.carry_bps });
    const { kept, dropped } = ground(sl.body, proposed);
    for (const d of dropped) this.log.warn(`side letter ${sideLetterId}: dropped ${d.p.type}: ${d.why}`);
    await this.db.transaction().execute(async (trx) => {
      const again = await trx
        .selectFrom("side_letters")
        .select("status")
        .where("tenant_id", "=", tenantId)
        .where("id", "=", sideLetterId)
        .forUpdate()
        .executeTakeFirst();
      if (again?.status !== "extracting") return;
      if (kept.length) {
        await trx
          .insertInto("provisions")
          .values(
            kept.map((k) => ({
              id: newId(),
              tenant_id: tenantId,
              fund_id: sl.fund_id,
              investor_id: sl.investor_id,
              side_letter_id: sl.id,
              source: "side_letter" as const,
              type: k.type,
              params: JSON.stringify(k.params),
              category: k.category,
              quote: k.quote,
              quote_start: k.start,
              quote_end: k.end,
              extractor: this.extractor.name,
              status: "proposed" as const,
            })),
          )
          .execute();
      }
      await trx
        .updateTable("side_letters")
        .set({ status: "in_review" })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", sideLetterId)
        .execute();
      await this.audit.append(trx, tenantId, {
        actor: `system:${this.extractor.name}`,
        action: "side_letter.extracted",
        entity: "side_letter",
        entityId: sideLetterId,
        payload: { proposed: kept.length, dropped: dropped.map((d) => ({ type: d.p.type, why: d.why })) },
      });
    });
  }

  async list(tenantId: string, fundId: string) {
    return this.db
      .selectFrom("side_letters as s")
      .innerJoin("investors as i", (j) => j.onRef("i.id", "=", "s.investor_id").onRef("i.tenant_id", "=", "s.tenant_id"))
      .select(["s.id", "s.title", "s.status", "s.investor_id", "i.name as investor_name", "s.created_at", "s.uploaded_by"])
      .where("s.tenant_id", "=", tenantId)
      .where("s.fund_id", "=", fundId)
      .orderBy("s.created_at", "desc")
      .execute();
  }

  async get(tenantId: string, id: string) {
    const sl = await this.db
      .selectFrom("side_letters")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .executeTakeFirst();
    if (!sl) throw notFound("side letter", id);
    const provisions = await this.db
      .selectFrom("provisions")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("side_letter_id", "=", id)
      .orderBy("quote_start")
      .execute();
    return { ...sl, provisions };
  }

  async provisions(tenantId: string, fundId: string, status?: "proposed" | "approved" | "rejected") {
    let q = this.db
      .selectFrom("provisions as p")
      .innerJoin("investors as i", (j) => j.onRef("i.id", "=", "p.investor_id").onRef("i.tenant_id", "=", "p.tenant_id"))
      .selectAll("p")
      .select("i.name as investor_name")
      .where("p.tenant_id", "=", tenantId)
      .where("p.fund_id", "=", fundId);
    if (status) q = q.where("p.status", "=", status);
    return q.orderBy("p.investor_id").orderBy("p.type").execute();
  }

  async decide(p: Principal, provisionId: string, input: z.infer<typeof Decision>) {
    return this.db.transaction().execute(async (trx) => {
      const prov = await trx
        .selectFrom("provisions")
        .selectAll()
        .where("tenant_id", "=", p.tenantId)
        .where("id", "=", provisionId)
        .forUpdate()
        .executeTakeFirst();
      if (!prov) throw notFound("provision", provisionId);
      if (prov.status !== "proposed") throw conflict("ALREADY_DECIDED", `provision is ${prov.status}`);
      if (prov.side_letter_id) {
        const sl = await trx
          .selectFrom("side_letters")
          .select("uploaded_by")
          .where("tenant_id", "=", p.tenantId)
          .where("id", "=", prov.side_letter_id)
          .executeTakeFirst();
        if (sl?.uploaded_by === p.sub) throw forbidden("FOUR_EYES", "the person who uploaded a side letter cannot approve its terms");
      }
      let params = prov.params;
      if (input.params) {
        const schema = ParamSchemas[prov.type];
        params = (schema ? schema.parse(input.params) : input.params) as Record<string, unknown>;
      }
      await trx
        .updateTable("provisions")
        .set({
          status: input.decision === "approve" ? "approved" : "rejected",
          params: JSON.stringify(params),
          decided_by: p.sub,
          decided_at: new Date(),
        })
        .where("tenant_id", "=", p.tenantId)
        .where("id", "=", provisionId)
        .execute();
      if (prov.side_letter_id) {
        const open = await trx
          .selectFrom("provisions")
          .select("id")
          .where("tenant_id", "=", p.tenantId)
          .where("side_letter_id", "=", prov.side_letter_id)
          .where("status", "=", "proposed")
          .where("id", "!=", provisionId)
          .executeTakeFirst();
        if (!open) {
          await trx
            .updateTable("side_letters")
            .set({ status: "reviewed" })
            .where("tenant_id", "=", p.tenantId)
            .where("id", "=", prov.side_letter_id)
            .execute();
        }
      }
      await this.audit.append(trx, p.tenantId, {
        actor: p.sub,
        action: `provision.${input.decision === "approve" ? "approved" : "rejected"}`,
        entity: "provision",
        entityId: provisionId,
        payload: { type: prov.type, params, edited: Boolean(input.params) },
      });
      return { id: provisionId, status: input.decision === "approve" ? "approved" : "rejected" };
    });
  }

  /** The provisions an investor may elect under its MFN right, from the engine (docs/SPEC.md 6). */
  async mfnEligible(tenantId: string, fundId: string, investorId: string) {
    const terms = await this.funds.termsByInvestor(tenantId, fundId);
    if (!terms.get(investorId)?.hasMfn) throw conflict("NO_MFN_RIGHT", "this investor has no approved MFN right");
    const lps = await this.funds.lps(tenantId, fundId);
    const approved = await this.provisions(tenantId, fundId, "approved");
    const ids = mfnEligible(
      lps.map((l) => ({ id: l.investorId, commitment: l.commitment })),
      approved.map((x) => ({ id: x.id, lp: x.investor_id, type: x.type, params: x.params, category: x.category })),
      investorId,
    );
    const byId = new Map(approved.map((x) => [x.id, x]));
    return ids.map((id) => byId.get(id)).filter((x) => x !== undefined);
  }

  async elect(p: Principal, fundId: string, investorId: string, input: z.infer<typeof Election>) {
    if (p.roles.includes("investor") && p.investorId !== investorId)
      throw forbidden("NOT_YOUR_ELECTION", "investors elect for themselves only");
    const eligible = await this.mfnEligible(p.tenantId, fundId, investorId);
    const allowed = new Map(eligible.map((e) => [e.id, e]));
    const bad = input.provisionIds.filter((id) => !allowed.has(id));
    if (bad.length) throw conflict("NOT_ELIGIBLE", "some provisions are not eligible for this investor", { ids: bad });
    return this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom("mfn_elections")
        .select(["id", "status"])
        .where("tenant_id", "=", p.tenantId)
        .where("fund_id", "=", fundId)
        .where("investor_id", "=", investorId)
        .forUpdate()
        .executeTakeFirst();
      if (existing?.status === "submitted") throw conflict("ALREADY_ELECTED", "the election was already submitted");
      const electionId = existing?.id ?? newId();
      const values = {
        eligible: JSON.stringify(eligible.map((e) => e.id)),
        elected: JSON.stringify(input.provisionIds),
        status: "submitted" as const,
        submitted_at: new Date(),
      };
      if (existing) {
        await trx.updateTable("mfn_elections").set(values).where("tenant_id", "=", p.tenantId).where("id", "=", electionId).execute();
      } else {
        await trx
          .insertInto("mfn_elections")
          .values({ id: electionId, tenant_id: p.tenantId, fund_id: fundId, investor_id: investorId, ...values })
          .execute();
      }
      for (const id of input.provisionIds) {
        const src = allowed.get(id);
        if (!src) continue;
        await trx
          .insertInto("provisions")
          .values({
            id: newId(),
            tenant_id: p.tenantId,
            fund_id: fundId,
            investor_id: investorId,
            side_letter_id: null,
            source: "mfn_election",
            type: src.type,
            params: JSON.stringify(src.params),
            category: src.category,
            quote: src.quote,
            quote_start: null,
            quote_end: null,
            extractor: "mfn",
            status: "approved",
            elected_from: src.id,
            decided_by: p.sub,
            decided_at: new Date(),
          })
          .execute();
      }
      await this.audit.append(trx, p.tenantId, {
        actor: p.sub,
        action: "mfn.elected",
        entity: "investor",
        entityId: investorId,
        payload: { fundId, eligible: eligible.length, elected: input.provisionIds },
      });
      return { electionId, elected: input.provisionIds.length, eligible: eligible.length };
    });
  }

  /** Compendium: every approved term per investor, with where it came from. */
  async compendium(tenantId: string, fundId: string) {
    const rows = await this.provisions(tenantId, fundId, "approved");
    const lps = await this.funds.lps(tenantId, fundId);
    const commitment = new Map(lps.map((l) => [l.investorId, big(l.commitment)]));
    const by = new Map<string, typeof rows>();
    for (const r of rows) by.set(r.investor_id, [...(by.get(r.investor_id) ?? []), r]);
    return [...by].map(([investorId, provisions]) => ({
      investorId,
      name: provisions[0]?.investor_name,
      commitment: (commitment.get(investorId) ?? 0n).toString(),
      provisions: provisions.map((x) => ({
        id: x.id,
        type: x.type,
        params: x.params,
        category: x.category,
        source: x.source,
        electedFrom: x.elected_from,
        quote: x.quote,
      })),
    }));
  }
}
