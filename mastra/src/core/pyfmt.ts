/**
 * Number rounding and formatting that match Python exactly.
 *
 * JS `toFixed` rounds an exact tie up; Python's `round()` and `format()` round
 * an exact tie to even. Both work on the double's exact binary value, so the
 * only difference is that tie case. These helpers find the exact decimal
 * expansion (`toFixed(100)` is exact for every double we deal with) and break
 * ties the Python way, so the port's numbers and messages match byte for byte.
 */

/** Decimal string of |x| rounded to `digits` places, Python-style (ties to even). */
function fixedAbs(x: number, digits: number): string {
  const exact = Math.abs(x).toFixed(100);
  const [int, frac = ''] = exact.split('.');
  const kept = int + frac.slice(0, digits);
  const rest = frac.slice(digits);
  const first = rest[0] ?? '0';
  const tail = rest.slice(1);
  const lastDigit = Number(kept[kept.length - 1]);
  let roundUp: boolean;
  if (first > '5') roundUp = true;
  else if (first < '5') roundUp = false;
  else if (/[1-9]/.test(tail)) roundUp = true;
  else roundUp = lastDigit % 2 === 1; // exact tie: round half to even
  let n = BigInt(kept);
  if (roundUp) n += 1n;
  const s = n.toString().padStart(digits + 1, '0');
  return digits === 0 ? s : `${s.slice(0, -digits)}.${s.slice(-digits)}`;
}

function isNegative(x: number, text: string): boolean {
  return x < 0 && /[1-9]/.test(text);
}

/** Python `round(x, digits)`. */
export function pyRound(x: number, digits = 0): number {
  if (!Number.isFinite(x)) return x;
  const text = fixedAbs(x, digits);
  const v = Number(text);
  return x < 0 ? -v : v;
}

/** Python `f"{x:,.2f}"` (any number of places). */
export function pyFixedGrouped(x: number, digits = 2): string {
  const text = fixedAbs(x, digits);
  const [int, frac] = text.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = frac === undefined ? grouped : `${grouped}.${frac}`;
  return isNegative(x, text) ? `-${body}` : body;
}

/**
 * Python `f"{x:g}"` for the values we format (scores and thresholds, 0-100):
 * up to 6 significant digits, trailing zeros dropped.
 */
export function pyG(x: number): string {
  if (Number.isInteger(x) && Math.abs(x) < 1e6) return String(x);
  const v = Number(x.toPrecision(6));
  if (Math.abs(v) >= 1e-4 && Math.abs(v) < 1e6) return String(v);
  throw new Error(`pyG: ${x} is outside the range this helper supports`);
}
