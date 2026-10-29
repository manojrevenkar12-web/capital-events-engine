import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { type AppConfig, CONFIG, loadConfig } from "../config/config.js";
import { createDb, type Db } from "./database.js";

export const DB = Symbol("DB");
/**
 * The unguarded connection, for the few places that are cross-tenant by design: migrations, the
 * outbox worker's pick query and health checks. Everything else uses DB.
 */
export const SYSTEM_DB = Symbol("SYSTEM_DB");

@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    { provide: DB, inject: [CONFIG], useFactory: (c: AppConfig) => createDb(c.DATABASE_URL) },
    { provide: SYSTEM_DB, inject: [CONFIG], useFactory: (c: AppConfig) => createDb(c.DATABASE_URL, { guard: false, poolSize: 3 }) },
  ],
  exports: [CONFIG, DB, SYSTEM_DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SYSTEM_DB) private readonly sys: Db,
  ) {}
  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.db.destroy(), this.sys.destroy()]);
  }
}
