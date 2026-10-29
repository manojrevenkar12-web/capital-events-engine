/**
 * Score the held-out side-letter set once. The first result is written with the set's hash
 * and never rewritten; later runs are reported against it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { RulesExtractor } from "../side-letters/extractor.js";
import { score } from "./score.js";

const root = resolve(process.cwd(), process.cwd().endsWith("apps/api") ? "../.." : ".");
const set = process.argv[2] ?? "side-letters-v1";
const dir = join(root, "heldout", set);
const status = readFileSync(join(dir, "STATUS"), "utf8").trim();
const { score: s, sha256 } = await score(new RulesExtractor(), dir);
const out = join(root, "reports", "heldout", set);
mkdirSync(out, { recursive: true });
const first = join(out, "first_run.json");
const record = { set, status, sha256, extractor: "rules-v1", at: new Date().toISOString(), ...s };
if (!existsSync(first)) {
  writeFileSync(first, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`first run recorded: ${first}`);
} else {
  const prior = JSON.parse(readFileSync(first, "utf8")) as { sha256: string };
  if (prior.sha256 !== sha256)
    throw new Error(`the set changed since its first run (${prior.sha256} -> ${sha256}); write a new set instead`);
}
writeFileSync(join(out, "latest.json"), `${JSON.stringify(record, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      status,
      precision: s.precision,
      recall: s.recall,
      categoryAccuracy: s.categoryAccuracy,
      found: s.found,
      expected: s.expected,
      falsePositives: s.falsePositives,
    },
    null,
    2,
  ),
);
