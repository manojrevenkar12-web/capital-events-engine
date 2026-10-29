/**
 * Transactional outbox. Work that must follow a commit (rendering notices, writing payment
 * files) is recorded in the same transaction as the state change, then done by a worker that
 * claims rows with FOR UPDATE SKIP LOCKED, so several replicas can run it without double work.
 */
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { newId } from "../common/util.js";
import { type AppConfig, CONFIG } from "../config/config.js";
import type { Db } from "../db/database.js";
import { SYSTEM_DB } from "../db/db.module.js";
import type { Database } from "../db/schema.js";

export type OutboxHandler = (tenantId: string, payload: Record<string, unknown>) => Promise<void>;

const MAX_ATTEMPTS = 8;

@Injectable()
export class OutboxService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger("outbox");
  private readonly handlers = new Map<string, OutboxHandler>();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(SYSTEM_DB) private readonly sys: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  register(topic: string, handler: OutboxHandler): void {
    this.handlers.set(topic, handler);
  }

  async enqueue(trx: Transaction<Database>, tenantId: string, topic: string, payload: Record<string, unknown>): Promise<void> {
    await trx
      .insertInto("outbox")
      .values({ id: newId(), tenant_id: tenantId, topic, payload: JSON.stringify(payload), status: "pending", available_at: new Date() })
      .execute();
  }

  onApplicationBootstrap(): void {
    if (process.env.OUTBOX_WORKER === "off") return;
    this.timer = setInterval(() => void this.drain(), this.config.OUTBOX_POLL_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Process due messages until none are left. Returns how many were handled. */
  async drain(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let handled = 0;
    try {
      for (;;) {
        const n = await this.processBatch();
        handled += n;
        if (n === 0) return handled;
      }
    } finally {
      this.running = false;
    }
  }

  private async processBatch(): Promise<number> {
    return this.sys.transaction().execute(async (trx) => {
      const rows = await sql<{ id: string; tenant_id: string; topic: string; payload: string | Record<string, unknown>; attempts: number }>`
        SELECT id, tenant_id, topic, payload, attempts FROM outbox
        WHERE status = 'pending' AND available_at <= CURRENT_TIMESTAMP(3)
        ORDER BY available_at LIMIT 10 FOR UPDATE SKIP LOCKED`.execute(trx);
      for (const r of rows.rows) {
        const payload = typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload;
        const handler = this.handlers.get(r.topic);
        try {
          if (!handler) throw new Error(`no handler for ${r.topic}`);
          await handler(r.tenant_id, payload);
          await sql`UPDATE outbox SET status = 'done', processed_at = CURRENT_TIMESTAMP(3), attempts = attempts + 1 WHERE id = ${r.id}`.execute(
            trx,
          );
        } catch (e) {
          const attempts = r.attempts + 1;
          const failed = attempts >= MAX_ATTEMPTS;
          const backoffMs = 2 ** attempts * 250;
          this.log.warn(`${r.topic} ${r.id} failed (attempt ${attempts}): ${(e as Error).message}`);
          await sql`UPDATE outbox SET attempts = ${attempts}, last_error = ${String((e as Error).message).slice(0, 500)},
            status = ${failed ? "failed" : "pending"}, available_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${backoffMs * 1000} MICROSECOND)
            WHERE id = ${r.id}`.execute(trx);
        }
      }
      return rows.rows.length;
    });
  }
}
