/**
 * Exact parity with the Python reference. The fixture is written by
 * scripts/export_parity.py; regenerate it whenever score.py or policy.py change.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aggregate, seedRows, supplierScoresFromSeed } from '../src/core/history';
import { loadPack } from '../src/core/packs';
import { checkPolicy } from '../src/core/policy';
import { pyFixedGrouped, pyRound } from '../src/core/pyfmt';
import { scoreSuppliers } from '../src/core/score';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/parity.json', import.meta.url), 'utf8'));
const pack = loadPack(fixture.pack);

describe('seed history', () => {
  it('aggregates to the same stats', () => {
    const rows = seedRows(pack);
    expect(rows.length).toBe(fixture.aggregate.rows);
    expect(aggregate(rows)).toEqual(fixture.aggregate.expected);
  });

  it('scores to the same numbers', () => {
    expect(supplierScoresFromSeed(pack)).toEqual(fixture.seed_scores);
  });
});

describe('scoreSuppliers matches Python', () => {
  for (const c of fixture.score) {
    it(c.name, () => {
      expect(scoreSuppliers(c.stats, c.weights, c.supplier_ids)).toEqual(c.expected);
    });
  }
});

describe('checkPolicy matches Python', () => {
  const { score_sets: scoreSets, cases } = fixture.policy;
  it(`all ${cases.length} cases`, () => {
    for (const c of cases) {
      const got = checkPolicy(c.proposal, {
        pack,
        supplierScores: scoreSets[c.scores],
        scopeKey: c.scope_key,
        budget: c.budget,
        spent: c.spent,
      });
      expect(got, JSON.stringify(c.proposal) + ` scores=${c.scores} budget=${c.budget} spent=${c.spent}`).toEqual(c.expected);
    }
  });
});

describe('Python rounding', () => {
  it.each([
    [0.125, 2, 0.12], // exact tie -> even
    [0.375, 2, 0.38],
    [2.5, 0, 2],
    [3.5, 0, 4],
    [2.675, 2, 2.67], // binary value is just under the tie
    [1.005, 2, 1.0],
    [-0.125, 2, -0.12],
    [149.91, 2, 149.91],
  ])('round(%d, %i) == %d', (x, n, want) => {
    expect(pyRound(x, n)).toBe(want);
  });

  it('groups thousands like f"{x:,.2f}"', () => {
    expect(pyFixedGrouped(1720000)).toBe('1,720,000.00');
    expect(pyFixedGrouped(0.125)).toBe('0.12');
    expect(pyFixedGrouped(999.995)).toBe('1,000.00'); // binary value is just over the tie
    expect(pyFixedGrouped(-1234.5)).toBe('-1,234.50');
  });
});
