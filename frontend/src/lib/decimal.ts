/**
 * Fixed-point decimal arithmetic on bigint, for money and prices.
 *
 * Why not plain numbers: the inputs here are decimal quantities that IEEE-754
 * cannot hold exactly. `0.1 + 0.2 !== 0.3` is the famous case, but the one that
 * actually bites a position-size calculator is subtraction of nearby prices -
 * `1.1025 - 1.1` evaluates to 0.002499999999999991, so a 25-pip stop silently
 * becomes 24.99999 pips and every figure derived from it inherits the error.
 * Multiply that by a six-figure contract size and the rounding lands in dollars.
 *
 * Every value is an integer scaled by 10^SCALE. Eight places is comfortably more
 * than the five a 5-digit FX quote needs, and bigint has no precision ceiling on
 * the way up, so intermediate products can't overflow into approximation.
 */

export const SCALE = 8;
const SCALE_F = 10n ** BigInt(SCALE);

/** Scale of the money outputs: currency is quoted to 2dp. */
const MONEY_PLACES = 2;
const MONEY_UNIT = 10n ** BigInt(SCALE - MONEY_PLACES);

export const ZERO = 0n;
export const ONE = SCALE_F;

/**
 * Parses a decimal string into fixed-point, or null if it isn't a number.
 *
 * Deliberately string-in: routing through `parseFloat` first would reintroduce
 * exactly the representation error this module exists to avoid, because the
 * float is already wrong before we scale it.
 */
export function parseDecimal(input: string): bigint | null {
  const s = input.trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;

  const negative = s.startsWith("-");
  const body = s.replace(/^[+-]/, "");
  const [intPart, fracRaw = ""] = body.split(".");

  // Pad then clip: anything beyond SCALE places is truncated rather than
  // rejected, so a pasted 10dp price is usable instead of being an error.
  const frac = (fracRaw + "0".repeat(SCALE)).slice(0, SCALE);
  const magnitude = BigInt(intPart || "0") * SCALE_F + BigInt(frac);

  return negative ? -magnitude : magnitude;
}

/** Multiply two fixed-point values. */
export function mul(a: bigint, b: bigint): bigint {
  return (a * b) / SCALE_F;
}

/** Divide two fixed-point values. Caller must ensure `b` is non-zero. */
export function div(a: bigint, b: bigint): bigint {
  return (a * SCALE_F) / b;
}

export function abs(a: bigint): bigint {
  return a < 0n ? -a : a;
}

/**
 * Largest multiple of `step` that is <= `value`.
 *
 * Both operands share the same scale, so it cancels in the division and the
 * bigint quotient is already the floored number of whole steps.
 *
 * Floor, never round: rounding a 0.147 lot up to 0.15 would place more risk on
 * the trade than the user asked for, which is the one direction of error this
 * tool must never make silently.
 */
export function floorToStep(value: bigint, step: bigint): bigint {
  if (step <= 0n) return value;
  const steps = value / step;
  return steps * step;
}

/** Round to 2dp, half away from zero - the convention for cash amounts. */
export function roundMoney(value: bigint): bigint {
  const quotient = value / MONEY_UNIT;
  const remainder = value % MONEY_UNIT;
  if (abs(remainder) * 2n >= MONEY_UNIT) {
    return (quotient + (value < 0n ? -1n : 1n)) * MONEY_UNIT;
  }
  return quotient * MONEY_UNIT;
}

/** Fixed-point -> decimal string with exactly `places` decimals. */
export function formatDecimal(value: bigint, places: number): string {
  const negative = value < 0n;
  const magnitude = abs(value);

  const whole = magnitude / SCALE_F;
  const frac = magnitude % SCALE_F;
  const fracStr = frac.toString().padStart(SCALE, "0").slice(0, places);

  const body = places > 0 ? `${whole}.${fracStr}` : `${whole}`;
  return negative ? `-${body}` : body;
}

/** Fixed-point -> `$1,234.56`, with the sign rendered outside the symbol. */
export function formatMoney(value: bigint): string {
  const rounded = roundMoney(value);
  const negative = rounded < 0n;
  const [whole, frac = "00"] = formatDecimal(abs(rounded), MONEY_PLACES).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${frac}`;
}

/**
 * Fixed-point -> number, for chart props and other float-only APIs.
 * Never feed the result back into a calculation.
 */
export function toNumber(value: bigint): number {
  return Number(value) / Number(SCALE_F);
}
