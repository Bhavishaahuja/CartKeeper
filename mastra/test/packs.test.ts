// Port of backend/tests/test_packs.py.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { loadPack, PACKS_DIR, PackError } from '../src/core/packs';

describe('the textile pack', () => {
  it('loads', () => {
    const pack = loadPack('manufacturing_textile');
    expect(pack.config.currency).toBe('usd');
    expect(pack.catalog.length).toBeGreaterThanOrEqual(20);
    expect(pack.machine('L-07')?.model).toBe('Picanol OMNIplus-i');
    expect(pack.config.approval_rules.at(-1)?.max_total).toBeNull();
    expect(pack.seed_history).toMatch(/seed_history\.json$/);
  });

  it('is read-only', () => {
    const pack = loadPack('manufacturing_textile');
    expect(() => {
      (pack.config.policy as { min_supplier_score: number }).min_supplier_score = 0;
    }).toThrow();
  });

  it('missing pack', () => {
    expect(() => loadPack('no_such_pack')).toThrow(/not found/);
  });
});

describe('a broken pack fails at load time', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ck-pack-'));
    cpSync(join(PACKS_DIR, 'manufacturing_textile'), join(root, 'p'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const editYaml = (fn: (d: any) => void) => {
    const path = join(root, 'p', 'pack.yaml');
    const data = parse(readFileSync(path, 'utf8'));
    fn(data);
    writeFileSync(path, stringify(data));
  };
  const load = () => loadPack('p', root);
  const expectError = (pattern: RegExp) => {
    expect(load).toThrow(PackError);
    expect(load).toThrow(pattern);
  };

  it('a typo key', () => {
    editYaml((d) => (d.policy.min_suplier_score = 50));
    expectError(/min_suplier_score/);
  });

  it('scoring weights must sum to one', () => {
    editYaml((d) => (d.scoring_weights.defect_rate = 0.9));
    expectError(/sum to 1/);
  });

  it('urgency weights must sum to one', () => {
    editYaml((d) => (d.urgency_levels.line_down.speed_weight = 0.9));
    expectError(/must equal 1/);
  });

  it('approval rules need a catch-all', () => {
    editYaml((d) => d.approval_rules.pop());
    expectError(/catch-all/);
  });

  it('approval rules must increase', () => {
    editYaml((d) => {
      const r = d.approval_rules;
      [r[0], r[1]] = [r[1], r[0]];
    });
    expectError(/strictly increasing/);
  });

  it('an unknown hook', () => {
    editYaml((d) => (d.hooks.pre_search = ['telepathy']));
    expectError(/telepathy/);
  });

  it('a supplier pricing an unknown sku', () => {
    const path = join(root, 'p', 'suppliers.json');
    writeFileSync(path, readFileSync(path, 'utf8').replace('"BRG-6205-2RS"', '"BRG-9999"'));
    expectError(/BRG-9999/);
  });

  it('bad json', () => {
    writeFileSync(join(root, 'p', 'catalog.json'), '[{');
    expectError(/could not parse/);
  });
});
