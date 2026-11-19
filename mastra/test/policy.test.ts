// Port of backend/tests/test_policy.py.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPack, type Pack } from '../src/core/packs';
import { checkPolicy } from '../src/core/policy';

let pack: Pack;
beforeAll(() => {
  pack = loadPack('manufacturing_textile');
});

const GOOD_SCORES = Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`SUP-0${i}`, { score: 90 }]));

function check(
  sku: string,
  supplierId: string,
  qty: number,
  { budget = 3000 as number | null, spent = 0, scores = GOOD_SCORES as Record<string, { score: number }>, packOverride = undefined as Pack | undefined } = {},
) {
  return checkPolicy(
    { sku, supplier_id: supplierId, qty },
    { pack: packOverride ?? pack, supplierScores: scores, scopeKey: 'line_2', budget, spent },
  );
}

describe('approval tiers', () => {
  // SUP-02 sells the OMNI drive motor at $890 and heald wires at $0.19.
  it.each([
    [1, 'auto_approve', 'none'], // $0.19
    [789, 'auto_approve', 'none'], // $149.91
  ])('qty %i of heald wire is %s', (qty, expected, role) => {
    const r = check('HW-330-OMNI', 'SUP-02', qty);
    expect([r.decision, r.approver_role]).toEqual([expected, role]);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('exact limit is auto-approved', () => {
    const r = check('VB-B52', 'SUP-03', 20); // $7.50 x 20 = exactly $150
    expect(r.total).toBe(150.0);
    expect(r.decision).toBe('auto_approve');
  });

  it('just over the auto limit needs the manager', () => {
    const r = check('HW-330-OMNI', 'SUP-02', 790); // $150.10
    expect([r.decision, r.approver_role]).toEqual(['needs_approval', 'maintenance_manager']);
  });

  it('manager tier', () => {
    const r = check('MTR-DRV-OMNI', 'SUP-02', 1); // $890
    expect([r.decision, r.approver_role]).toEqual(['needs_approval', 'maintenance_manager']);
    expect(r.reasons[0]).toContain('maintenance manager');
  });

  it('owner tier', () => {
    const r = check('MTR-DRV-OMNI', 'SUP-02', 2); // $1,780
    expect([r.decision, r.approver_role]).toEqual(['needs_approval', 'owner']);
  });

  it('exact manager limit stays with the manager', () => {
    let r = check('SNS-PROX-M18', 'SUP-02', 62, { budget: 5000 }); // $24 x 62 = $1,488
    expect(r.approver_role).toBe('maintenance_manager');
    r = check('VB-B52', 'SUP-03', 200, { budget: 5000 }); // $7.50 x 200 = $1,500.00
    expect(r.total).toBe(1500.0);
    expect(r.approver_role).toBe('maintenance_manager');
  });
});

describe('blocks', () => {
  it('over the remaining budget', () => {
    const r = check('MTR-DRV-OMNI', 'SUP-02', 1, { budget: 3000, spent: 2500 });
    expect(r.decision).toBe('blocked');
    expect(r.remaining).toBe(500);
    expect(r.reasons[0]).toContain('$500.00 left in line_2');
  });

  it('budget exactly used up is allowed', () => {
    const r = check('MTR-DRV-OMNI', 'SUP-02', 1, { budget: 3000, spent: 2110 });
    expect(r.decision).toBe('needs_approval');
  });

  it('unapproved supplier', () => {
    const r = check('HW-330-OMNI', 'SUP-05', 10);
    expect(r.decision).toBe('blocked');
    expect(r.reasons[0]).toContain('not an approved supplier');
  });

  it('low-score supplier', () => {
    const r = check('HW-330-OMNI', 'SUP-01', 10, { scores: { ...GOOD_SCORES, 'SUP-01': { score: 55 } } });
    expect(r.decision).toBe('blocked');
    expect(r.reasons[0]).toContain('below the minimum of 60');
  });

  it('missing score', () => {
    expect(check('HW-330-OMNI', 'SUP-01', 10, { scores: {} }).decision).toBe('blocked');
  });

  it('blocked category', () => {
    const strict = pack.with({
      config: { ...pack.config, policy: { ...pack.config.policy, blocked_categories: ['motors'] } },
    });
    const r = check('MTR-DRV-OMNI', 'SUP-02', 1, { packOverride: strict });
    expect(r.decision).toBe('blocked');
    expect(r.reasons[0]).toContain('motors');
  });

  it('ignores an invented price, sku, or pairing', () => {
    let r = checkPolicy(
      { sku: 'HW-330-OMNI', supplier_id: 'SUP-02', qty: 500, unit_price: 0.01, total: 5.0 },
      { pack, supplierScores: GOOD_SCORES, scopeKey: 'line_2', budget: 3000, spent: 0 },
    );
    expect(r.total).toBe(95.0); // re-read from the catalog, not the proposal
    r = check('MADE-UP-SKU', 'SUP-02', 1);
    expect(r.decision).toBe('blocked');
    r = check('DYE-RB5-KG', 'SUP-02', 1); // real sku, but SUP-02 doesn't sell it
    expect(r.decision).toBe('blocked');
  });

  it('zero qty', () => {
    expect(check('HW-330-OMNI', 'SUP-02', 0).decision).toBe('blocked');
  });

  it('no budget for the scope', () => {
    expect(check('HW-330-OMNI', 'SUP-02', 1, { budget: null }).decision).toBe('blocked');
  });
});
