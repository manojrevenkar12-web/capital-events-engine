export type EngineErrorCode = "NO_WEIGHT" | "INSUFFICIENT_UNFUNDED" | "OVER_CALL" | "UNSUPPORTED_FEE_PERIOD" | "INVALID_INPUT";

/** A calculation that cannot be carried out as specified. `ids` lists the LPs concerned. */
export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly ids: string[];

  constructor(code: EngineErrorCode, message: string, ids: string[] = []) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.ids = [...ids].sort(compareIds);
  }
}

/** Ids compare by Unicode code point (docs/SPEC.md 1.6), not by locale. */
export const compareIds = (a: string, b: string): number => {
  const x = [...a].map((c) => c.codePointAt(0) ?? 0);
  const y = [...b].map((c) => c.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
};
