/**
 * Differential test: run every scenario through the TypeScript engine and the independent
 * Python reference and compare the parsed results. Writes a report; exits non-zero on any
 * difference.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { runScenario } from "../../packages/engine/src/scenario.js";

const [file = "scenarios.jsonl", report = "reports/differential/latest.json"] = process.argv.slice(2);
const root = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const scenarios = readFileSync(file, "utf8").split("\n").filter(Boolean);

const t0 = performance.now();
const ours = scenarios.map((l) => runScenario(JSON.parse(l)));
const tsMs = performance.now() - t0;
const t1 = performance.now();
const ref = execFileSync("python3", ["-m", "cee_ref", "--batch", resolve(file)], {
  cwd: resolve(root, "reference"),
  maxBuffer: 1 << 30,
})
  .toString()
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const pyMs = performance.now() - t1;

const byOp: Record<string, { total: number; same: number; errors: number; codes: Record<string, number> }> = {};
const diffs: Array<{ index: number; op: string; scenario: unknown; engine: unknown; reference: unknown }> = [];
scenarios.forEach((line, i) => {
  const s = JSON.parse(line) as { op: string };
  byOp[s.op] ??= { total: 0, same: 0, errors: 0, codes: {} };
  const stat = byOp[s.op];
  stat.total += 1;
  const a = JSON.parse(JSON.stringify(ours[i]));
  const b = ref[i];
  if (a?.ok === false) {
    stat.errors += 1;
    stat.codes[a.error] = (stat.codes[a.error] ?? 0) + 1;
  }
  if (isDeepStrictEqual(a, b)) stat.same += 1;
  else diffs.push({ index: i, op: s.op, scenario: s, engine: a, reference: b });
});

const summary = {
  scenarios: scenarios.length,
  identical: scenarios.length - diffs.length,
  differences: diffs.length,
  byOp,
  timingMs: { engine: Math.round(tsMs), reference: Math.round(pyMs) },
};
mkdirSync(dirname(report), { recursive: true });
writeFileSync(report, `${JSON.stringify({ ...summary, examples: diffs.slice(0, 20) }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
process.exit(diffs.length === 0 ? 0 : 1);
