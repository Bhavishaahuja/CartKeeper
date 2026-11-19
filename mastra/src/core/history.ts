/**
 * Purchase-order history. Port of backend/core/history.py.
 *
 * The Python pack generates its seed history with Python's RNG. Rather than
 * replicate that, mastra/scripts/export_parity.py writes the rows to
 * packs/<pack>/seed_history.json and this side reads them.
 */

import { readFileSync } from 'node:fs';
import type { Pack } from './packs';
import { scoreSuppliers, type SupplierScore, type SupplierStats } from './score';

export interface OrderRow {
  supplier_id: string;
  promised_at: string;
  delivered_at: string | null;
  defect: boolean;
  [column: string]: unknown;
}

export function seedRows(pack: Pack): OrderRow[] {
  if (!pack.seed_history) return [];
  return JSON.parse(readFileSync(pack.seed_history, 'utf8')) as OrderRow[];
}

const DAY_MS = 86_400_000;

/** Calendar date (in the timestamp's own offset) as a day number, like Python's `datetime.fromisoformat(x).date()`. */
function dayNumber(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error(`not an ISO date: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
}

/** Mirror of vw_supplier_reliability. Undelivered orders are skipped. */
export function aggregate(rows: OrderRow[]): SupplierStats[] {
  const acc = new Map<string, SupplierStats>();
  for (const r of rows) {
    if (!r.delivered_at) continue;
    const daysLate = dayNumber(r.delivered_at) - dayNumber(r.promised_at);
    let a = acc.get(r.supplier_id);
    if (!a) {
      a = { supplier_id: r.supplier_id, orders: 0, on_time_orders: 0, late_days_sum: 0, defect_orders: 0 };
      acc.set(r.supplier_id, a);
    }
    a.orders += 1;
    a.on_time_orders += daysLate <= 0 ? 1 : 0;
    a.late_days_sum += Math.max(daysLate, 0);
    a.defect_orders += r.defect ? 1 : 0;
  }
  return [...acc.values()].sort((x, y) => (x.supplier_id < y.supplier_id ? -1 : x.supplier_id > y.supplier_id ? 1 : 0));
}

/** Scores for every supplier in the pack, from its seed history. */
export function supplierScoresFromSeed(pack: Pack): Record<string, SupplierScore> {
  return scoreSuppliers(
    aggregate(seedRows(pack)),
    pack.config.scoring_weights,
    pack.suppliers.map((s) => s.supplier_id),
  );
}
