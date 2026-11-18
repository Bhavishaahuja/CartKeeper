/**
 * Industry pack loader. Port of backend/core/packs.py.
 *
 * A pack is a folder of config + seed data that tells the core how an industry
 * buys things. The core never branches on industry; it only reads what the pack
 * declares. Anything malformed fails at load time with every problem listed.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/** The repo-level packs/ folder, shared with the Python backend. */
export const PACKS_DIR =
  process.env.CARTKEEPER_PACKS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../packs');

/** Hooks the core knows how to run. A pack may only reference these. */
export const KNOWN_HOOKS: Record<string, ReadonlySet<string>> = {
  pre_search: new Set(['machine_compatibility']),
};

/** Bucket for requests that don't name a machine. */
export const GENERAL_SCOPE = 'general';
export const KNOWN_BUDGET_SCOPES = ['production_line', 'company'] as const;

const WEIGHT_TOLERANCE = 1e-6;

export class PackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackError';
  }
}

const unit = () => z.number().min(0).max(1);

export const UrgencyLevelSchema = z
  .strictObject({ label: z.string(), speed_weight: unit(), price_weight: unit() })
  .refine((u) => Math.abs(u.speed_weight + u.price_weight - 1) <= WEIGHT_TOLERANCE, {
    message: 'speed_weight + price_weight must equal 1',
  });

export const ApprovalRuleSchema = z.strictObject({
  max_total: z.number().positive().nullable().default(null),
  approver_role: z.string(),
});

export const PolicySchema = z.strictObject({
  approved_suppliers_only: z.boolean(),
  min_supplier_score: z.number().min(0).max(100),
  blocked_categories: z.array(z.string()).default([]),
});

export const ScoringWeightsSchema = z
  .strictObject({ on_time_rate: unit(), avg_days_late: unit(), defect_rate: unit() })
  .superRefine((w, ctx) => {
    const total = w.on_time_rate + w.avg_days_late + w.defect_rate;
    if (Math.abs(total - 1) > WEIGHT_TOLERANCE) {
      ctx.addIssue({ code: 'custom', message: `scoring weights must sum to 1, got ${Number(total.toPrecision(6))}` });
    }
  });

export const PackConfigSchema = z
  .strictObject({
    name: z.string(),
    currency: z.literal('usd'),
    budget_scope: z.enum(KNOWN_BUDGET_SCOPES),
    urgency_levels: z
      .record(z.string(), UrgencyLevelSchema)
      .refine((r) => Object.keys(r).length >= 1, { message: 'needs at least one urgency level' }),
    approval_rules: z.array(ApprovalRuleSchema).min(1),
    policy: PolicySchema,
    scoring_weights: ScoringWeightsSchema,
    hooks: z.record(z.string(), z.array(z.string())).default({}),
  })
  .superRefine((cfg, ctx) => {
    const caps = cfg.approval_rules.map((r) => r.max_total);
    const bounded = caps.slice(0, -1);
    if (caps[caps.length - 1] !== null) {
      ctx.addIssue({ code: 'custom', path: ['approval_rules'], message: 'last approval rule must have max_total: null (catch-all)' });
    } else if (bounded.includes(null)) {
      ctx.addIssue({ code: 'custom', path: ['approval_rules'], message: 'only the last approval rule may have max_total: null' });
    } else if (bounded.some((c, i) => i > 0 && (c as number) <= (bounded[i - 1] as number))) {
      ctx.addIssue({ code: 'custom', path: ['approval_rules'], message: 'approval rule max_total values must be strictly increasing' });
    }
    for (const [stage, names] of Object.entries(cfg.hooks)) {
      const known = KNOWN_HOOKS[stage];
      if (!known) {
        ctx.addIssue({ code: 'custom', path: ['hooks'], message: `unknown hook stage '${stage}'` });
        continue;
      }
      const unknown = [...new Set(names)].filter((n) => !known.has(n)).sort();
      if (unknown.length) {
        ctx.addIssue({ code: 'custom', path: ['hooks'], message: `unknown ${stage} hooks: ${JSON.stringify(unknown)}` });
      }
    }
  });

export const CatalogItemSchema = z.strictObject({
  sku: z.string(),
  name: z.string(),
  category: z.string(),
  unit: z.string(),
  keywords: z.array(z.string()).default([]),
  compatible_models: z.array(z.string()).nullable().default(null), // null = fits anything
});

export const PriceEntrySchema = z.strictObject({
  unit_price: z.number().positive(),
  lead_days: z.int().min(0),
});

export const SupplierSchema = z.strictObject({
  supplier_id: z.string(),
  name: z.string(),
  approved: z.boolean(),
  categories: z.array(z.string()),
  price_list: z.record(z.string(), PriceEntrySchema),
});

export const InventoryEntrySchema = z.strictObject({
  on_hand: z.int().min(0),
  location: z.string(),
});

export const MemberSchema = z.strictObject({ user_id: z.string(), name: z.string(), role: z.string() });

export const DemoCompanySchema = z.strictObject({
  name: z.string(),
  budgets: z.record(z.string(), z.number()),
  members: z.array(MemberSchema),
});

export const MachineSchema = z.strictObject({
  machine_id: z.string(),
  type: z.string(),
  model: z.string(),
  line: z.string(),
});

export const PackDataSchema = z.strictObject({
  key: z.string(),
  config: PackConfigSchema,
  catalog: z.array(CatalogItemSchema),
  suppliers: z.array(SupplierSchema),
  machines: z.array(MachineSchema),
  inventory: z.record(z.string(), InventoryEntrySchema).default({}),
  /** Path to the seed purchase-order history (JSON rows), if the pack ships one. */
  seed_history: z.string().nullable().default(null),
  demo_company: DemoCompanySchema.nullable().default(null),
});

export type PackConfig = z.infer<typeof PackConfigSchema>;
export type CatalogItem = z.infer<typeof CatalogItemSchema>;
export type Supplier = z.infer<typeof SupplierSchema>;
export type Machine = z.infer<typeof MachineSchema>;
export type PackData = z.infer<typeof PackDataSchema>;

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}

/** A validated, read-only pack. */
export class Pack {
  readonly key: string;
  readonly config: PackConfig;
  readonly catalog: readonly CatalogItem[];
  readonly suppliers: readonly Supplier[];
  readonly machines: readonly Machine[];
  readonly inventory: PackData['inventory'];
  readonly seed_history: string | null;
  readonly demo_company: PackData['demo_company'];

  constructor(data: PackData) {
    deepFreeze(data);
    this.key = data.key;
    this.config = data.config;
    this.catalog = data.catalog;
    this.suppliers = data.suppliers;
    this.machines = data.machines;
    this.inventory = data.inventory;
    this.seed_history = data.seed_history;
    this.demo_company = data.demo_company;
    Object.freeze(this);
  }

  /** Copy with some top-level fields replaced (the Pydantic `model_copy(update=...)`). */
  with(update: Partial<PackData>): Pack {
    return new Pack(structuredClone({ ...this.toData(), ...update }));
  }

  toData(): PackData {
    return {
      key: this.key,
      config: this.config,
      catalog: [...this.catalog],
      suppliers: [...this.suppliers],
      machines: [...this.machines],
      inventory: this.inventory,
      seed_history: this.seed_history,
      demo_company: this.demo_company,
    };
  }

  item(sku: string): CatalogItem | undefined {
    return this.catalog.find((i) => i.sku === sku);
  }

  supplier(supplierId: string): Supplier | undefined {
    return this.suppliers.find((s) => s.supplier_id === supplierId);
  }

  machine(machineId: string): Machine | undefined {
    return this.machines.find((m) => m.machine_id === machineId);
  }

  /** Which budget bucket a request draws from. */
  scopeKey(machineId: string | null | undefined): string {
    if (this.config.budget_scope === 'company') return 'company';
    const machine = machineId ? this.machine(machineId) : undefined;
    return machine ? machine.line : GENERAL_SCOPE;
  }

  /** Approval roles from lowest to highest tier. */
  approverRoles(): string[] {
    return this.config.approval_rules.map((r) => r.approver_role).filter((r) => r !== 'none');
  }
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const v of values) (seen.has(v) ? dups : seen).add(v);
  return [...dups];
}

/** Checks that span files: duplicate ids, prices for unknown parts, missing budgets or approvers. */
export function crossCheck(pack: Pack): string[] {
  const problems: string[] = [];
  for (const d of duplicates(pack.catalog.map((i) => i.sku))) problems.push(`catalog: duplicate sku '${d}'`);
  for (const d of duplicates(pack.suppliers.map((s) => s.supplier_id))) problems.push(`suppliers: duplicate supplier_id '${d}'`);
  for (const d of duplicates(pack.machines.map((m) => m.machine_id))) problems.push(`machines: duplicate machine_id '${d}'`);

  const bySku = new Map(pack.catalog.map((i) => [i.sku, i]));
  for (const s of pack.suppliers) {
    for (const sku of Object.keys(s.price_list)) {
      const item = bySku.get(sku);
      if (!item) problems.push(`suppliers: ${s.supplier_id} prices unknown sku '${sku}'`);
      else if (!s.categories.includes(item.category)) {
        problems.push(`suppliers: ${s.supplier_id} prices '${sku}' but doesn't list category '${item.category}'`);
      }
    }
  }

  for (const sku of Object.keys(pack.inventory)) {
    if (!bySku.has(sku)) problems.push(`inventory: unknown sku '${sku}'`);
  }

  if (pack.demo_company) {
    const expected =
      pack.config.budget_scope === 'company'
        ? new Set(['company'])
        : new Set([...pack.machines.map((m) => m.line), GENERAL_SCOPE]);
    const missing = [...expected].filter((k) => !(k in pack.demo_company!.budgets)).sort();
    if (missing.length) problems.push(`demo_company: no budget for ${JSON.stringify(missing)}`);
    const roles = new Set(pack.demo_company.members.map((m) => m.role));
    for (const role of pack.approverRoles()) {
      if (!roles.has(role)) problems.push(`demo_company: nobody has approver role '${role}'`);
    }
  }

  const knownModels = new Set(pack.machines.map((m) => m.model));
  for (const item of pack.catalog) {
    for (const model of item.compatible_models ?? []) {
      if (!knownModels.has(model)) problems.push(`catalog: ${item.sku} references unknown machine model '${model}'`);
    }
  }
  return problems;
}

function read(path: string): unknown {
  if (!existsSync(path)) throw new PackError(`missing pack file: ${path}`);
  const text = readFileSync(path, 'utf8');
  try {
    return ['.yaml', '.yml'].includes(extname(path)) ? parseYaml(text) : JSON.parse(text);
  } catch (e) {
    throw new PackError(`could not parse ${path}: ${(e as Error).message}`);
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const loc = issue.path.map(String).join('.');
      const keys = issue.code === 'unrecognized_keys' ? ` (${issue.keys.join(', ')})` : '';
      return `  ${loc}: ${issue.message}${keys}`;
    })
    .join('\n');
}

/** Validate already-read pack data. Throws PackError on any problem. */
export function buildPack(raw: unknown): Pack {
  const parsed = PackDataSchema.safeParse(raw);
  const key = (raw as { key?: string })?.key ?? '?';
  if (!parsed.success) throw new PackError(`pack '${key}' is invalid:\n${formatIssues(parsed.error)}`);
  const pack = new Pack(parsed.data);
  const problems = crossCheck(pack);
  if (problems.length) {
    throw new PackError(`pack '${key}' is inconsistent:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  }
  return pack;
}

/** Load and validate the pack in `packsDir/key`. Throws PackError on any problem. */
export function loadPack(key: string, packsDir: string = PACKS_DIR): Pack {
  const root = join(packsDir, key);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new PackError(`pack '${key}' not found in ${packsDir}`);
  }
  const raw: Record<string, unknown> = {
    key,
    config: read(join(root, 'pack.yaml')),
    catalog: read(join(root, 'catalog.json')),
    suppliers: read(join(root, 'suppliers.json')),
    machines: read(join(root, 'machines.json')),
  };
  for (const name of ['inventory', 'demo_company'] as const) {
    const path = join(root, `${name}.json`);
    if (existsSync(path)) raw[name] = read(path);
  }
  const seed = join(root, 'seed_history.json');
  if (existsSync(seed)) raw.seed_history = seed;
  return buildPack(raw);
}
