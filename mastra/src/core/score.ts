/**
 * CartLens layer: supplier reliability scores from the company's own order history.
 * Port of backend/core/score.py. Pure functions, no I/O, no LLM.
 *
 * Inputs are per-supplier counts (the shape of vw_supplier_reliability); output
 * is a 0-100 score per supplier. Two corrections keep small samples honest:
 * - Rates are ratios of totals (sum of on-time orders / sum of orders), not an
 *   average of per-month ratios, so every order counts once.
 * - Each supplier's rates are shrunk toward the pooled rate across all suppliers,
 *   with the pull fading as its order count grows. A supplier with 2 lucky orders
 *   sits near the pooled average; one with 200 solid orders keeps its own record.
 */

import { pyRound } from './pyfmt';

export const PRIOR_STRENGTH = 20; // orders' worth of pull toward the pooled rate
export const LATE_DAYS_CAP = 5.0; // avg days late at or above this scores 0 on that component
export const DEFECT_RATE_CAP = 0.25; // defect rate at or above this scores 0 on that component
/** (on_time_rate, avg_days_late, defect_rate) when there is no history at all. */
export const NEUTRAL_PRIOR: readonly [number, number, number] = [0.85, 1.0, 0.05];

export interface SupplierStats {
  supplier_id: string;
  orders: number; // delivered orders
  on_time_orders: number;
  late_days_sum: number; // sum of days late across all delivered orders (on-time = 0)
  defect_orders: number;
}

export interface ScoringWeights {
  on_time_rate: number;
  avg_days_late: number;
  defect_rate: number;
}

export interface SupplierScore {
  score: number;
  on_time_rate: number;
  avg_days_late: number;
  defect_rate: number;
  orders: number;
  raw_on_time_rate: number | null;
  low_confidence: boolean;
}

/** Python's `sum()` over floats: plain left-to-right addition from 0. */
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function pooled(stats: SupplierStats[]): readonly [number, number, number] {
  const n = sum(stats.map((s) => s.orders));
  if (n === 0) return NEUTRAL_PRIOR;
  return [
    sum(stats.map((s) => s.on_time_orders)) / n,
    sum(stats.map((s) => s.late_days_sum)) / n,
    sum(stats.map((s) => s.defect_orders)) / n,
  ];
}

const shrink = (total: number, n: number, prior: number) => (total + PRIOR_STRENGTH * prior) / (n + PRIOR_STRENGTH);

/** Score every supplier in `stats`, plus any id in `supplierIds` with no history. */
export function scoreSuppliers(
  stats: SupplierStats[],
  weights: ScoringWeights,
  supplierIds: string[] = [],
): Record<string, SupplierScore> {
  const byId = new Map(stats.map((s) => [s.supplier_id, s]));
  for (const sid of supplierIds) {
    if (!byId.has(sid)) byId.set(sid, { supplier_id: sid, orders: 0, on_time_orders: 0, late_days_sum: 0, defect_orders: 0 });
  }

  const [pOnTime, pLate, pDefect] = pooled(stats);
  const out: Record<string, SupplierScore> = {};
  for (const [sid, s] of byId) {
    const onTime = shrink(s.on_time_orders, s.orders, pOnTime);
    const late = shrink(s.late_days_sum, s.orders, pLate);
    const defect = shrink(s.defect_orders, s.orders, pDefect);
    // Same order as the Python dict, so the float sum matches bit for bit.
    const components: [keyof ScoringWeights, number][] = [
      ['on_time_rate', onTime],
      ['avg_days_late', 1 - Math.min(late / LATE_DAYS_CAP, 1.0)],
      ['defect_rate', 1 - Math.min(defect / DEFECT_RATE_CAP, 1.0)],
    ];
    const score = 100 * sum(components.map(([k, v]) => weights[k] * v));
    out[sid] = {
      score: pyRound(score, 1),
      on_time_rate: pyRound(onTime, 3),
      avg_days_late: pyRound(late, 2),
      defect_rate: pyRound(defect, 3),
      orders: s.orders,
      raw_on_time_rate: s.orders ? pyRound(s.on_time_orders / s.orders, 3) : null,
      low_confidence: s.orders < PRIOR_STRENGTH,
    };
  }
  return out;
}
