/**
 * Append-only, hash-chained audit log per tenant. Each record's hash covers the previous hash
 * and the record, so editing or removing any row breaks every hash after it. The database also
 * refuses UPDATE and DELETE on the table (triggers in the migration).
 */
import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { canonicalJson, sha256 } from "../common/util.js";
import type { Db } from "../db/database.js";
import { DB } from "../db/db.module.js";
import type { Database } from "../db/schema.js";

export const GENESIS = "0".repeat(64);

export interface AuditEntry {
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  payload?: Record<string, unknown>;
}

const mysqlTs = (d: Date): string => d.toISOString().replace("T", " ").replace("Z", "");

export const auditHash = (prev: string, seq: number, at: string, e: AuditEntry): string =>
  sha256(
    prev + canonicalJson({ seq, at, actor: e.actor, action: e.action, entity: e.entity, entity_id: e.entityId, payload: e.payload ?? {} }),
  );

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Append inside the caller's transaction; serialised per tenant by locking the tenant row. */
  async append(trx: Transaction<Database>, tenantId: string, e: AuditEntry): Promise<void> {
    await sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`.execute(trx);
    const last = await trx
      .selectFrom("audit_log")
      .select(["seq", "hash"])
      .where("tenant_id", "=", tenantId)
      .orderBy("seq", "desc")
      .limit(1)
      .executeTakeFirst();
    const seq = Number(last?.seq ?? 0) + 1;
    const prev = last?.hash ?? GENESIS;
    const at = mysqlTs(new Date());
    await trx
      .insertInto("audit_log")
      .values({
        tenant_id: tenantId,
        seq,
        at,
        actor: e.actor,
        action: e.action,
        entity: e.entity,
        entity_id: e.entityId,
        payload: JSON.stringify(e.payload ?? {}),
        prev_hash: prev,
        hash: auditHash(prev, seq, at, e),
      })
      .execute();
  }

  async list(tenantId: string, after = 0, limit = 200) {
    return this.db
      .selectFrom("audit_log")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("seq", ">", after)
      .orderBy("seq")
      .limit(limit)
      .execute();
  }

  /** Recompute the chain; report the first record whose hash or link does not match. */
  async verify(tenantId: string): Promise<{ ok: boolean; records: number; brokenAt?: number }> {
    const rows = await this.db.selectFrom("audit_log").selectAll().where("tenant_id", "=", tenantId).orderBy("seq").execute();
    let prev = GENESIS;
    let expectSeq = 1;
    for (const r of rows) {
      const at = mysqlTs(new Date(r.at));
      const h = auditHash(prev, Number(r.seq), at, {
        actor: r.actor,
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        payload: r.payload,
      });
      if (Number(r.seq) !== expectSeq || r.prev_hash !== prev || r.hash !== h) {
        return { ok: false, records: rows.length, brokenAt: Number(r.seq) };
      }
      prev = r.hash;
      expectSeq += 1;
    }
    return { ok: true, records: rows.length };
  }
}
