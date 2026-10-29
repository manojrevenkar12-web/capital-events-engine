import { createHash } from "node:crypto";
import { monotonicFactory } from "ulid";

const ulid = monotonicFactory();
export const newId = (): string => ulid();

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** JSON with sorted keys and bigints as strings, so hashes do not depend on key order. */
export const canonicalJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => {
    if (typeof x === "bigint") return x.toString();
    if (x && typeof x === "object" && !Array.isArray(x)) {
      return Object.fromEntries(
        Object.keys(x)
          .sort()
          .map((k) => [k, (x as Record<string, unknown>)[k]]),
      );
    }
    return x;
  });

export const big = (v: string | number | bigint | null | undefined): bigint => (v == null ? 0n : BigInt(v));

/** Cents to a display string, e.g. 1234567 -> "12,345.67". */
export const formatMoney = (cents: bigint, currency = "EUR"): string => {
  const neg = cents < 0n;
  const a = neg ? -cents : cents;
  const units = (a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${currency} ${units}.${(a % 100n).toString().padStart(2, "0")}`;
};

export const today = (): string => new Date().toISOString().slice(0, 10);

export const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
export const escapeHtml = escapeXml;
