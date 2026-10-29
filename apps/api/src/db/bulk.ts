/**
 * Set-based updates of event lines: one statement per chunk instead of one per investor.
 * MySQL 8's VALUES ROW(...) table constructor joined to the target; tenant_id is part of the
 * join condition (raw SQL bypasses the tenancy guard, so it is written out here explicitly).
 */
import { sql, type Transaction } from "kysely";
import type { Database } from "./schema.js";

const CHUNK = 1000;

/** Set the payment reference of many lines of one event. */
export const setEndToEndIds = async (
  trx: Transaction<Database>,
  tenantId: string,
  eventId: string,
  rows: Array<{ investorId: string; e2e: string }>,
) => {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const values = sql.join(rows.slice(i, i + CHUNK).map((r) => sql`ROW(${r.investorId}, ${r.e2e})`));
    await sql`UPDATE event_lines AS l JOIN (VALUES ${values}) AS v (investor_id, e2e)
      ON l.investor_id = v.investor_id
      SET l.end_to_end_id = v.e2e
      WHERE l.tenant_id = ${tenantId} AND l.event_id = ${eventId}`.execute(trx);
  }
};

/** Add payments to lines and recompute their status, for lines of any events. */
export const addPayments = async (
  trx: Transaction<Database>,
  tenantId: string,
  payments: Array<{ eventId: string; investorId: string; amount: bigint }>,
) => {
  // a multi-table UPDATE changes each line once, so two payments to one line must be summed first
  const sums = new Map<string, { eventId: string; investorId: string; amount: bigint }>();
  for (const p of payments) {
    const k = `${p.eventId}|${p.investorId}`;
    const cur = sums.get(k);
    sums.set(k, { ...p, amount: (cur?.amount ?? 0n) + p.amount });
  }
  const rows = [...sums.values()];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const values = sql.join(rows.slice(i, i + CHUNK).map((r) => sql`ROW(${r.eventId}, ${r.investorId}, ${r.amount.toString()})`));
    await sql`UPDATE event_lines AS l JOIN (VALUES ${values}) AS v (event_id, investor_id, amount)
      ON l.event_id = v.event_id AND l.investor_id = v.investor_id
      SET l.paid = l.paid + CAST(v.amount AS SIGNED),
          l.status = CASE
            WHEN l.paid + CAST(v.amount AS SIGNED) = l.total THEN 'paid'
            WHEN l.paid + CAST(v.amount AS SIGNED) < l.total THEN 'partial'
            ELSE 'overpaid' END
      WHERE l.tenant_id = ${tenantId}`.execute(trx);
  }
};
