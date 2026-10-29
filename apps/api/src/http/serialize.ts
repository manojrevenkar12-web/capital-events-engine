/** JSON responses: bigints as strings (money is never a float on the wire), dates as ISO. */
export const toWire = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
