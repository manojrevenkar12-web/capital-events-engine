import { Body, Controller, Get, Header, Inject, Param, Post, Query, UseInterceptors } from "@nestjs/common";
import { sql } from "kysely";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import { CurrentUser, Public, Roles } from "../auth/auth.guard.js";
import type { Principal, Role } from "../auth/principal.js";
import { issueToken } from "../auth/tokens.js";
import { DomainError, forbidden, notFound } from "../common/errors.js";
import { parse } from "../common/validation.js";
import { type AppConfig, CONFIG } from "../config/config.js";
import type { Db } from "../db/database.js";
import { SYSTEM_DB } from "../db/db.module.js";
import { EventsService } from "../events/events.service.js";
import { CreateCall, CreateClosing, CreateDistribution } from "../events/inputs.js";
import { NoticesService } from "../events/notices.service.js";
import { AddCommitment, CreateFund, CreateInvestor, FundsService } from "../funds/funds.service.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { PaymentsService, Resolve } from "../payments/payments.service.js";
import { Decision, Election, SideLettersService, UploadSideLetter } from "../side-letters/side-letters.service.js";
import { Accepts, AcceptsXml } from "./contract.js";
import { IdempotencyInterceptor } from "./idempotency.interceptor.js";
import { bankEntries, eventsIssued, registry } from "./metrics.js";
import { toWire } from "./serialize.js";

const STAFF: Role[] = ["preparer", "approver", "viewer"];
const IMMUTABILITY_TRIGGERS = ["audit_log_no_update", "audit_log_no_delete", "postings_no_update", "postings_no_delete"];

@Controller()
export class HealthController {
  private guardsVerified = false;
  constructor(@Inject(SYSTEM_DB) private readonly sys: Db) {}

  @Public()
  @Get("healthz")
  health() {
    return { status: "ok" };
  }

  @Public()
  @Get("readyz")
  async ready() {
    await sql`SELECT 1`.execute(this.sys);
    // The ledger and audit log are append-only only if these triggers exist. A migration that
    // could not create them (MySQL 8.4 with binary logging and no log_bin_trust_function_creators)
    // must not leave a server that looks healthy.
    if (!this.guardsVerified) {
      const found = await sql<{ name: string }>`SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE()`.execute(this.sys);
      const names = new Set(found.rows.map((r) => r.name));
      const missing = IMMUTABILITY_TRIGGERS.filter((t) => !names.has(t));
      if (missing.length) throw new DomainError(503, "NOT_READY", `append-only triggers missing: ${missing.join(", ")}`);
      this.guardsVerified = true;
    }
    const lag = await sql<{
      n: string;
      oldest: string | null;
    }>`SELECT COUNT(*) AS n, MIN(available_at) AS oldest FROM outbox WHERE status = 'pending'`.execute(this.sys);
    return { status: "ready", outboxPending: Number(lag.rows[0]?.n ?? 0) };
  }

  @Public()
  @Get("metrics")
  @Header("content-type", "text/plain; version=0.0.4")
  metrics() {
    return registry.metrics();
  }
}

export const TokenRequest = z.object({
  sub: z.string().min(1),
  name: z.string().optional(),
  tenantId: z.string(),
  roles: z.array(z.enum(["preparer", "approver", "viewer", "investor", "admin"])).min(1),
  investorId: z.string().optional(),
});

@Controller("v1/dev")
export class DevController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(SYSTEM_DB) private readonly sys: Db,
  ) {}

  /** Tenants to sign in to, for the local identity provider only. */
  @Public()
  @Get("tenants")
  async tenants() {
    if (!this.config.DEV_TOKENS) throw notFound("route", "/v1/dev/tenants");
    return this.sys.selectFrom("tenants").select(["id", "name"]).orderBy("created_at").execute();
  }

  /** The local identity provider; off unless DEV_TOKENS=on. Production verifies RS256 from JWKS_URL. */
  @Public()
  @Post("token")
  @Accepts(TokenRequest)
  async token(@Body() body: unknown) {
    if (!this.config.DEV_TOKENS) throw notFound("route", "/v1/dev/token");
    const r = parse(TokenRequest, body);
    return {
      token: await issueToken(this.config.JWT_SECRET ?? "", this.config.JWT_ISSUER, {
        sub: r.sub,
        ...(r.name ? { name: r.name } : {}),
        tid: r.tenantId,
        roles: r.roles,
        ...(r.investorId ? { inv: r.investorId } : {}),
      }),
    };
  }
}

@Controller("v1")
@UseInterceptors(IdempotencyInterceptor)
export class FundsController {
  constructor(
    private readonly funds: FundsService,
    private readonly ledger: LedgerService,
  ) {}

  @Roles(...STAFF)
  @Get("funds")
  async list(@CurrentUser() p: Principal) {
    return toWire(await this.funds.listFunds(p.tenantId));
  }

  @Roles("preparer")
  @Post("funds")
  @Accepts(CreateFund)
  async create(@CurrentUser() p: Principal, @Body() body: unknown) {
    return toWire(await this.funds.createFund(p, parse(CreateFund, body)));
  }

  @Roles(...STAFF)
  @Get("funds/:fundId")
  async get(@CurrentUser() p: Principal, @Param("fundId") id: string) {
    return toWire(await this.funds.fund(p.tenantId, id));
  }

  @Roles("preparer")
  @Post("funds/:fundId/commitments")
  @Accepts(AddCommitment)
  async commit(@CurrentUser() p: Principal, @Param("fundId") id: string, @Body() body: unknown) {
    return toWire(await this.funds.addCommitment(p, id, parse(AddCommitment, body)));
  }

  @Roles(...STAFF)
  @Get("funds/:fundId/capital-accounts")
  async accounts(@CurrentUser() p: Principal, @Param("fundId") id: string) {
    return toWire(await this.funds.capitalAccounts(p.tenantId, id));
  }

  @Roles(...STAFF)
  @Get("funds/:fundId/ledger/verify")
  async verify(@CurrentUser() p: Principal, @Param("fundId") id: string) {
    await this.funds.fund(p.tenantId, id);
    return toWire(await this.ledger.verify(p.tenantId, id));
  }

  @Roles(...STAFF)
  @Get("investors")
  async investors(@CurrentUser() p: Principal, @Query("q") q?: string) {
    return toWire(await this.funds.listInvestors(p.tenantId, q));
  }

  @Roles("preparer")
  @Post("investors")
  @Accepts(CreateInvestor)
  async createInvestor(@CurrentUser() p: Principal, @Body() body: unknown) {
    return toWire(await this.funds.createInvestor(p, parse(CreateInvestor, body)));
  }
}

@Controller("v1")
@UseInterceptors(IdempotencyInterceptor)
export class SideLettersController {
  constructor(private readonly letters: SideLettersService) {}

  @Roles("preparer")
  @Post("funds/:fundId/side-letters")
  @Accepts(UploadSideLetter)
  async upload(@CurrentUser() p: Principal, @Param("fundId") id: string, @Body() body: unknown) {
    return toWire(await this.letters.upload(p, id, parse(UploadSideLetter, body)));
  }

  @Roles(...STAFF)
  @Get("funds/:fundId/side-letters")
  async list(@CurrentUser() p: Principal, @Param("fundId") id: string) {
    return toWire(await this.letters.list(p.tenantId, id));
  }

  @Roles(...STAFF)
  @Get("side-letters/:id")
  async get(@CurrentUser() p: Principal, @Param("id") id: string) {
    return toWire(await this.letters.get(p.tenantId, id));
  }

  @Roles(...STAFF)
  @Get("funds/:fundId/provisions")
  async provisions(@CurrentUser() p: Principal, @Param("fundId") id: string, @Query("status") status?: string) {
    const s = z
      .enum(["proposed", "approved", "rejected"])
      .optional()
      .parse(status || undefined);
    return toWire(await this.letters.provisions(p.tenantId, id, s));
  }

  @Roles("approver")
  @Post("provisions/:id/decision")
  @Accepts(Decision)
  async decide(@CurrentUser() p: Principal, @Param("id") id: string, @Body() body: unknown) {
    return toWire(await this.letters.decide(p, id, parse(Decision, body)));
  }

  @Roles(...STAFF)
  @Get("funds/:fundId/compendium")
  async compendium(@CurrentUser() p: Principal, @Param("fundId") id: string) {
    return toWire(await this.letters.compendium(p.tenantId, id));
  }

  @Roles(...STAFF, "investor")
  @Get("funds/:fundId/mfn/:investorId")
  async eligible(@CurrentUser() p: Principal, @Param("fundId") id: string, @Param("investorId") inv: string) {
    if (p.roles.includes("investor") && p.investorId !== inv) throw forbidden("NOT_YOURS", "investors see their own election only");
    return toWire(await this.letters.mfnEligible(p.tenantId, id, inv));
  }

  @Roles("preparer", "investor")
  @Post("funds/:fundId/mfn/:investorId/election")
  @Accepts(Election)
  async elect(@CurrentUser() p: Principal, @Param("fundId") id: string, @Param("investorId") inv: string, @Body() body: unknown) {
    return toWire(await this.letters.elect(p, id, inv, parse(Election, body)));
  }
}

export const ApproveBody = z.object({ resultHash: z.string().length(64) });
export const FeederCallBody = z.object({ feederFundId: z.string(), issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

@Controller("v1")
@UseInterceptors(IdempotencyInterceptor)
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly payments: PaymentsService,
  ) {}

  @Roles(...STAFF)
  @Get("funds/:fundId/events")
  async list(@CurrentUser() p: Principal, @Param("fundId") id: string) {
    return toWire(await this.events.list(p.tenantId, id));
  }

  @Roles("preparer")
  @Post("funds/:fundId/calls")
  @Accepts(CreateCall)
  async call(@CurrentUser() p: Principal, @Param("fundId") id: string, @Body() body: unknown) {
    return toWire(await this.events.createCall(p, id, parse(CreateCall, body)));
  }

  @Roles("preparer")
  @Post("funds/:fundId/distributions")
  @Accepts(CreateDistribution)
  async distribution(@CurrentUser() p: Principal, @Param("fundId") id: string, @Body() body: unknown) {
    return toWire(await this.events.createDistribution(p, id, parse(CreateDistribution, body)));
  }

  @Roles("preparer")
  @Post("funds/:fundId/closings")
  @Accepts(CreateClosing)
  async closing(@CurrentUser() p: Principal, @Param("fundId") id: string, @Body() body: unknown) {
    return toWire(await this.events.createClosing(p, id, parse(CreateClosing, body)));
  }

  @Roles(...STAFF)
  @Get("events/:id")
  async get(@CurrentUser() p: Principal, @Param("id") id: string) {
    return toWire(await this.events.get(p.tenantId, id));
  }

  @Roles(...STAFF)
  @Get("events/:id/lines")
  async lines(@CurrentUser() p: Principal, @Param("id") id: string) {
    return toWire(await this.events.lines(p.tenantId, id));
  }

  @Roles("preparer")
  @Post("events/:id/calculate")
  async calculate(@CurrentUser() p: Principal, @Param("id") id: string) {
    return toWire(await this.events.calculate(p, id));
  }

  @Roles("approver")
  @Post("events/:id/approve")
  @Accepts(ApproveBody)
  async approve(@CurrentUser() p: Principal, @Param("id") id: string, @Body() body: unknown) {
    return toWire(await this.events.approve(p, id, parse(ApproveBody, body).resultHash));
  }

  @Roles("preparer", "approver")
  @Post("events/:id/issue")
  async issue(@CurrentUser() p: Principal, @Param("id") id: string) {
    const ev = await this.events.issue(p, id);
    eventsIssued.inc({ kind: ev.kind });
    return toWire(ev);
  }

  @Roles("preparer")
  @Post("events/:id/cancel")
  async cancel(@CurrentUser() p: Principal, @Param("id") id: string) {
    return toWire(await this.events.cancel(p, id));
  }

  @Roles(...STAFF)
  @Get("events/:id/feeder-plan")
  async feederPlan(@CurrentUser() p: Principal, @Param("id") id: string) {
    return toWire(await this.events.feederPlan(p.tenantId, id));
  }

  @Roles("preparer")
  @Post("events/:id/feeder-calls")
  @Accepts(FeederCallBody)
  async feederCall(@CurrentUser() p: Principal, @Param("id") id: string, @Body() body: unknown) {
    const b = parse(FeederCallBody, body);
    return toWire(await this.events.createFeederCall(p, id, b.feederFundId, b.issueDate));
  }

  @Roles(...STAFF)
  @Get("events/:id/payment-file")
  async paymentFile(@CurrentUser() p: Principal, @Param("id") id: string) {
    return toWire(await this.payments.paymentFile(p.tenantId, id));
  }
}

@Controller("v1")
@UseInterceptors(IdempotencyInterceptor)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Roles("preparer")
  @Post("funds/:fundId/bank/camt054")
  @AcceptsXml()
  async camt(@CurrentUser() p: Principal, @Param("fundId") id: string, @Body() body: unknown) {
    if (typeof body !== "string") throw new DomainError(415, "XML_REQUIRED", "send the camt.054 as application/xml");
    const r = await this.payments.importCamt054(p, id, body);
    bankEntries.inc({ status: "matched" }, r.matched);
    bankEntries.inc({ status: "unmatched" }, r.unmatched);
    bankEntries.inc({ status: "duplicate" }, r.duplicates);
    return toWire(r);
  }

  @Roles(...STAFF)
  @Get("funds/:fundId/bank/entries")
  async entries(@CurrentUser() p: Principal, @Param("fundId") id: string, @Query("status") status?: string) {
    const s = z
      .enum(["matched", "unmatched", "duplicate", "resolved"])
      .optional()
      .parse(status || undefined);
    return toWire(await this.payments.entries(p.tenantId, id, s));
  }

  @Roles("preparer")
  @Post("funds/:fundId/bank/entries/:entryId/resolve")
  @Accepts(Resolve)
  async resolve(@CurrentUser() p: Principal, @Param("fundId") id: string, @Param("entryId") entry: string, @Body() body: unknown) {
    return toWire(await this.payments.resolve(p, id, entry, parse(Resolve, body)));
  }
}

@Controller("v1")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Roles(...STAFF)
  @Get("audit")
  async list(@CurrentUser() p: Principal, @Query("after") after?: string) {
    return toWire(await this.audit.list(p.tenantId, Number(after ?? 0) || 0));
  }

  @Roles(...STAFF)
  @Get("audit/verify")
  async verify(@CurrentUser() p: Principal) {
    return this.audit.verify(p.tenantId);
  }
}

@Controller("v1/me")
export class PortalController {
  constructor(private readonly notices: NoticesService) {}

  @Roles("investor")
  @Get("notices")
  async list(@CurrentUser() p: Principal) {
    if (!p.investorId) throw forbidden("NO_INVESTOR", "the token does not name an investor");
    return toWire(await this.notices.forInvestor(p.tenantId, p.investorId));
  }
}
