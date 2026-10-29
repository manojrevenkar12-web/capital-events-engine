/**
 * Idempotency-Key for POSTs: the same key with the same body returns the first response
 * instead of acting twice (a retried "issue" must not book twice); the same key with a
 * different body is refused.
 */
import { type CallHandler, type ExecutionContext, Inject, Injectable, type NestInterceptor } from "@nestjs/common";
import { from, type Observable, of, switchMap } from "rxjs";
import type { Principal } from "../auth/principal.js";
import { unprocessable } from "../common/errors.js";
import { canonicalJson, sha256 } from "../common/util.js";
import type { Db } from "../db/database.js";
import { DB } from "../db/db.module.js";

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(DB) private readonly db: Db) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx
      .switchToHttp()
      .getRequest<{ method: string; url: string; headers: Record<string, string | undefined>; body: unknown; principal?: Principal }>();
    const key = req.headers["idempotency-key"];
    if (req.method !== "POST" || !key || !req.principal) return next.handle();
    const tenantId = req.principal.tenantId;
    const hash = sha256(`${req.method} ${req.url} ${canonicalJson(req.body ?? null)}`);
    return from(
      this.db.selectFrom("idempotency_keys").selectAll().where("tenant_id", "=", tenantId).where("idem_key", "=", key).executeTakeFirst(),
    ).pipe(
      switchMap((hit) => {
        if (hit) {
          if (hit.request_hash !== hash)
            throw unprocessable("IDEMPOTENCY_KEY_REUSED", "this Idempotency-Key was used for a different request");
          return of(hit.response);
        }
        return next.handle().pipe(
          switchMap((response) =>
            from(
              this.db
                .insertInto("idempotency_keys")
                .values({
                  tenant_id: tenantId,
                  idem_key: key.slice(0, 100),
                  request_hash: hash,
                  status_code: 200,
                  response: JSON.stringify(response ?? null),
                })
                .onDuplicateKeyUpdate({ status_code: 200 })
                .execute()
                .then(() => response),
            ),
          ),
        );
      }),
    );
  }
}
