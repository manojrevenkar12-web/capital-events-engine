/** pnpm --filter @cee/api openapi [out]: writes the OpenAPI document generated from the controllers. */
import "reflect-metadata";
import { writeFileSync } from "node:fs";
import { buildOpenApi } from "./http/openapi.js";

const out = process.argv[2] ?? "../../docs/openapi.json";
writeFileSync(out, `${JSON.stringify(buildOpenApi(), null, 2)}\n`);
console.log(`wrote ${out}`);
