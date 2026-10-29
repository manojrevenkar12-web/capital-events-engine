/** Money arrives as integer cents in strings; it is formatted, never turned into floats. */
export const formatCents = (cents: string | bigint | number, opts: { currency?: string; compact?: boolean; sign?: boolean } = {}) => {
  const c = BigInt(cents);
  const neg = c < 0n;
  const a = neg ? -c : c;
  const units = a / 100n;
  const sign = neg ? "−" : opts.sign && c > 0n ? "+" : "";
  if (opts.compact && units >= 1_000_000n) {
    const m = Number(units / 10_000n) / 100;
    return `${sign}${opts.currency ?? "€"}${m.toLocaleString("en-GB", { maximumFractionDigits: 2 })}m`;
  }
  const whole = units.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${opts.currency ?? "€"}${whole}.${(a % 100n).toString().padStart(2, "0")}`;
};

export const ratio = (part: string, whole: string) => {
  const w = BigInt(whole);
  return w === 0n ? 0 : Number((BigInt(part) * 10_000n) / w) / 10_000;
};

export const sumCents = (xs: Array<string | bigint>) => xs.reduce<bigint>((s, x) => s + BigInt(x), 0n);

/** "1,250,000.5" or "1250000" in euros to integer cents; null when it is not an amount. */
export const parseEuros = (text: string): string | null => {
  const t = text.replace(/[\s,€]/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const cents = BigInt(m[1] ?? "0") * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
  return cents > 0n ? cents.toString() : null;
};
