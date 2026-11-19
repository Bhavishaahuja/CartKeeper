// Port of backend/tests/test_score.py.
import { describe, expect, it } from 'vitest';
import { aggregate, seedRows } from '../src/core/history';
import { loadPack } from '../src/core/packs';
import { PRIOR_STRENGTH, scoreSuppliers, type SupplierStats } from '../src/core/score';

const W = { on_time_rate: 0.5, avg_days_late: 0.2, defect_rate: 0.3 };
const S = (supplier_id: string, orders: number, on_time_orders: number, late_days_sum: number, defect_orders: number): SupplierStats => ({
  supplier_id, orders, on_time_orders, late_days_sum, defect_orders,
});

describe('scoreSuppliers', () => {
  it('scores are 0 to 100', () => {
    const out = scoreSuppliers([S('a', 10, 10, 0, 0), S('b', 10, 0, 50, 10)], W);
    for (const v of Object.values(out)) expect(v.score).toBeGreaterThanOrEqual(0), expect(v.score).toBeLessThanOrEqual(100);
    expect(out.a.score).toBeGreaterThan(out.b.score);
  });

  it('two lucky orders do not beat two hundred solid ones', () => {
    const out = scoreSuppliers([S('lucky', 2, 2, 0, 0), S('solid', 200, 190, 15, 4), S('weak', 150, 100, 160, 15)], W);
    expect(out.lucky.raw_on_time_rate).toBe(1.0);
    expect(out.solid.score).toBeGreaterThan(out.lucky.score);
    expect(out.lucky.low_confidence).toBe(true);
    expect(out.solid.low_confidence).toBe(false);
  });

  it('lots of history keeps its own rate', () => {
    const out = scoreSuppliers([S('big', 2000, 1000, 2000, 0), S('other', 2000, 2000, 0, 0)], W);
    expect(Math.abs(out.big.on_time_rate - 0.5)).toBeLessThan(0.01);
  });

  it('a supplier without history gets the pooled rate', () => {
    const out = scoreSuppliers([S('a', 100, 90, 20, 5)], W, ['a', 'new']);
    expect(out.new.orders).toBe(0);
    expect(out.new.on_time_rate).toBe(0.9);
    expect(out.new.low_confidence).toBe(true);
  });

  it('no history at all still scores', () => {
    const out = scoreSuppliers([], W, ['x']);
    expect(out.x.score).toBeGreaterThan(0);
    expect(out.x.score).toBeLessThan(100);
  });

  it('weights change the ranking', () => {
    const stats = [S('f', 100, 100, 0, 20), S('s', 100, 60, 80, 0)];
    const timing = scoreSuppliers(stats, { on_time_rate: 0.9, avg_days_late: 0.1, defect_rate: 0.0 });
    const quality = scoreSuppliers(stats, { on_time_rate: 0.1, avg_days_late: 0.0, defect_rate: 0.9 });
    expect(timing.f.score).toBeGreaterThan(timing.s.score);
    expect(quality.s.score).toBeGreaterThan(quality.f.score);
  });
});

describe('seed history', () => {
  it('scoring rediscovers the hidden reliability', () => {
    const pack = loadPack('manufacturing_textile');
    const out = scoreSuppliers(aggregate(seedRows(pack)), pack.config.scoring_weights);
    // SUP-02 is dependable and SUP-01 is often late in the hidden truth.
    expect(out['SUP-02'].score).toBeGreaterThan(out['SUP-01'].score + 15);
    // SUP-05 has 3 perfect orders: it must not outrank the proven suppliers.
    expect(out['SUP-05'].orders).toBe(3);
    expect(out['SUP-05'].score).toBeLessThan(out['SUP-02'].score);
    expect(out['SUP-05'].score).toBeLessThan(out['SUP-03'].score);
  });

  it('aggregate counts', () => {
    const rows = [
      { supplier_id: 'a', promised_at: '2026-01-10T10:00:00+00:00', delivered_at: '2026-01-10T18:00:00+00:00', defect: false },
      { supplier_id: 'a', promised_at: '2026-01-10T10:00:00+00:00', delivered_at: '2026-01-13T10:00:00+00:00', defect: true },
      { supplier_id: 'a', promised_at: '2026-01-10T10:00:00+00:00', delivered_at: null, defect: false },
    ];
    expect(aggregate(rows)).toEqual([S('a', 2, 1, 3, 1)]);
    expect(PRIOR_STRENGTH).toBeGreaterThan(2);
  });
});
