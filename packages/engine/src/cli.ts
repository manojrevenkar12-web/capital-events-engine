#!/usr/bin/env node
/** cee-engine <scenario.json> | --batch <file.jsonl>: the scenario runner the differential tests use. */
import { readFileSync } from "node:fs";
import { runScenario } from "./scenario.js";

const [flag, file] = process.argv.slice(2);
if (flag === "--batch" && file) {
  const out: string[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim()) out.push(JSON.stringify(runScenario(JSON.parse(line))));
  }
  process.stdout.write(`${out.join("\n")}\n`);
} else if (flag) {
  process.stdout.write(`${JSON.stringify(runScenario(JSON.parse(readFileSync(flag, "utf8"))))}\n`);
} else {
  process.stderr.write("usage: cee-engine <scenario.json> | --batch <file.jsonl>\n");
  process.exit(2);
}
