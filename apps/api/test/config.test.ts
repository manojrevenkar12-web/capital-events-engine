import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/config.js";

describe("configuration", () => {
  it("refuses to start with neither an identity provider nor a secret", () => {
    expect(() => loadConfig({})).toThrow(/JWKS_URL/);
  });
  it("refuses dev tokens without a secret to sign them", () => {
    expect(() => loadConfig({ JWKS_URL: "https://login.example.com/jwks.json", DEV_TOKENS: "on" })).toThrow(/DEV_TOKENS/);
  });
  it("accepts an identity provider alone, and a local secret alone", () => {
    expect(loadConfig({ JWKS_URL: "https://login.example.com/jwks.json" }).JWT_SECRET).toBeUndefined();
    expect(loadConfig({ JWT_SECRET: "x".repeat(32), DEV_TOKENS: "on" }).DEV_TOKENS).toBe(true);
  });
});
