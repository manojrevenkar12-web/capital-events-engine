import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CSP } from "../csp";

describe("content security policy", () => {
  it("nginx sends the policy the e2e run is tested under, on every HTML response", () => {
    const conf = readFileSync(resolve(process.cwd(), "nginx.conf"), "utf8");
    const sent = [...conf.matchAll(/Content-Security-Policy "([^"]+)"/g)].map((m) => m[1]);
    expect(sent.filter((p) => p === CSP)).toHaveLength(2);
    expect(CSP).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  });
});
