/**
 * Scoring side-letter extraction against labelled answers. A grant counts as found when the
 * extractor proposes the same type with equal parameters; the category is scored separately
 * because a wrong category changes MFN eligibility, not the term itself.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sameParams } from "@cee/engine";
import { type Extractor, ground } from "../side-letters/extractor.js";

export interface Grant {
  type: string;
  params: Record<string, unknown>;
  category: string;
  quote?: string;
}

export interface SetScore {
  letters: number;
  expected: number;
  proposed: number;
  found: number;
  falsePositives: number;
  categoryRight: number;
  precision: number;
  recall: number;
  categoryAccuracy: number;
  byType: Record<string, { expected: number; found: number; falsePositives: number }>;
  misses: Array<{ letter: string; type: string; params: Record<string, unknown> }>;
  extras: Array<{ letter: string; type: string; params: Record<string, unknown> }>;
}

export const loadSet = (dir: string) => {
  const answers = JSON.parse(readFileSync(join(dir, "answers.json"), "utf8")) as Record<string, Grant[]>;
  const files = readdirSync(join(dir, "letters"))
    .filter((f) => f.endsWith(".txt"))
    .sort();
  const letters = files.map((f) => ({ id: f.replace(/\.txt$/, ""), text: readFileSync(join(dir, "letters", f), "utf8") }));
  const hash = createHash("sha256");
  for (const l of letters) hash.update(`${l.id}\n${l.text}\n`);
  hash.update(JSON.stringify(answers));
  return { answers, letters, sha256: hash.digest("hex") };
};

export const score = async (extractor: Extractor, dir: string, ctx = { feeRateBps: 200, carryBps: 2000 }) => {
  const { answers, letters, sha256 } = loadSet(dir);
  const s: SetScore = {
    letters: letters.length,
    expected: 0,
    proposed: 0,
    found: 0,
    falsePositives: 0,
    categoryRight: 0,
    precision: 0,
    recall: 0,
    categoryAccuracy: 0,
    byType: {},
    misses: [],
    extras: [],
  };
  const bt = (t: string) => {
    s.byType[t] ??= { expected: 0, found: 0, falsePositives: 0 };
    return s.byType[t];
  };
  for (const l of letters) {
    const expected = answers[l.id] ?? [];
    const { kept } = ground(l.text, await extractor.extract(l.text, ctx));
    const unused = [...kept];
    s.expected += expected.length;
    s.proposed += kept.length;
    for (const g of expected) {
      bt(g.type).expected += 1;
      const i = unused.findIndex((k) => k.type === g.type && sameParams(k.params, g.params));
      if (i >= 0) {
        const [hit] = unused.splice(i, 1);
        s.found += 1;
        bt(g.type).found += 1;
        if (hit?.category === g.category) s.categoryRight += 1;
      } else {
        s.misses.push({ letter: l.id, type: g.type, params: g.params });
      }
    }
    for (const extra of unused) {
      s.falsePositives += 1;
      bt(extra.type).falsePositives += 1;
      s.extras.push({ letter: l.id, type: extra.type, params: extra.params });
    }
  }
  s.precision = s.proposed ? s.found / s.proposed : 1;
  s.recall = s.expected ? s.found / s.expected : 1;
  s.categoryAccuracy = s.found ? s.categoryRight / s.found : 1;
  return { score: s, sha256 };
};
