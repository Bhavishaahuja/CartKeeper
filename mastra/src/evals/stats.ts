/** Small, dependency-free statistics for the eval report. */

/** Deterministic PRNG (mulberry32), so a report's intervals are reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN);

export interface Interval {
  mean: number;
  low: number;
  high: number;
  n: number;
}

/**
 * Percentile bootstrap CI of the mean over items. Each item's value is its mean
 * across runs, so items (not runs) are the unit that's resampled: repeated runs
 * of one item are not independent evidence.
 */
export function bootstrapMean(perItem: number[][], { resamples = 2000, level = 0.95, seed = 7 } = {}): Interval {
  const values = perItem.filter((runs) => runs.length).map(mean);
  const n = values.length;
  if (!n) return { mean: Number.NaN, low: Number.NaN, high: Number.NaN, n: 0 };
  const draw = rng(seed);
  const means: number[] = [];
  for (let b = 0; b < resamples; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[Math.floor(draw() * n)];
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  const tail = (1 - level) / 2;
  const at = (q: number) => means[Math.min(resamples - 1, Math.max(0, Math.floor(q * resamples)))];
  return { mean: mean(values), low: at(tail), high: at(1 - tail), n };
}
