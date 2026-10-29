import { loadConfig } from "../config/config.js";
import { createDb, migrate } from "./database.js";

const db = createDb(loadConfig().DATABASE_URL, { guard: false });
try {
  const applied = await migrate(db as never);
  console.log(applied.length ? `applied: ${applied.join(", ")}` : "schema is up to date");
} finally {
  await db.destroy();
}
