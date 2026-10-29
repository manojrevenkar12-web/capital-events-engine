/**
 * Exact rationals over bigint. Every intermediate amount in the engine is one of these, so
 * nothing is lost to floating point and rounding happens only where docs/SPEC.md says.
 */

const abs = (x: bigint): bigint => (x < 0n ? -x : x);

const gcd = (a: bigint, b: bigint): bigint => {
  let x = abs(a);
  let y = abs(b);
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
};

export class Q {
  readonly n: bigint;
  readonly d: bigint;

  private constructor(n: bigint, d: bigint) {
    this.n = n;
    this.d = d;
  }

  static of(n: bigint | number, d: bigint | number = 1n): Q {
    let num = BigInt(n);
    let den = BigInt(d);
    if (den === 0n) throw new RangeError("division by zero");
    if (den < 0n) {
      num = -num;
      den = -den;
    }
    const g = gcd(num, den) || 1n;
    return new Q(num / g, den / g);
  }

  static readonly ZERO = Q.of(0n);
  static readonly ONE = Q.of(1n);

  add(o: Q | bigint): Q {
    const b = toQ(o);
    return Q.of(this.n * b.d + b.n * this.d, this.d * b.d);
  }
  sub(o: Q | bigint): Q {
    const b = toQ(o);
    return Q.of(this.n * b.d - b.n * this.d, this.d * b.d);
  }
  mul(o: Q | bigint): Q {
    const b = toQ(o);
    return Q.of(this.n * b.n, this.d * b.d);
  }
  div(o: Q | bigint): Q {
    const b = toQ(o);
    if (b.n === 0n) throw new RangeError("division by zero");
    return Q.of(this.n * b.d, this.d * b.n);
  }
  pow(k: number): Q {
    let r: Q = Q.ONE;
    for (let i = 0; i < k; i++) r = r.mul(this);
    return r;
  }
  cmp(o: Q | bigint): -1 | 0 | 1 {
    const b = toQ(o);
    const l = this.n * b.d;
    const r = b.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  isZero(): boolean {
    return this.n === 0n;
  }
  isNegative(): boolean {
    return this.n < 0n;
  }
  isPositive(): boolean {
    return this.n > 0n;
  }
  /** Largest integer not greater than this value. */
  floor(): bigint {
    const q = this.n / this.d;
    return this.n < 0n && q * this.d !== this.n ? q - 1n : q;
  }
  /** Round half to even (docs/SPEC.md 1.2). */
  round(): bigint {
    const f = this.floor();
    const frac = this.sub(f); // in [0, 1)
    const c = frac.cmp(Q.of(1n, 2n));
    if (c < 0) return f;
    if (c > 0) return f + 1n;
    return f % 2n === 0n ? f : f + 1n;
  }
  toString(): string {
    return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`;
  }
}

export const toQ = (x: Q | bigint): Q => (typeof x === "bigint" ? Q.of(x) : x);

export const maxQ = (a: Q, b: Q): Q => (a.cmp(b) >= 0 ? a : b);
export const minBig = (a: bigint, b: bigint): bigint => (a < b ? a : b);
export const maxBig = (a: bigint, b: bigint): bigint => (a > b ? a : b);
export const sumBig = (xs: Iterable<bigint>): bigint => {
  let s = 0n;
  for (const x of xs) s += x;
  return s;
};
