/** Test harness: a fake model (port of backend/tests/fakes.py) and a fresh Mastra per test. */
import { Mastra } from '@mastra/core/mastra';
import { cartkeeperRoutes } from '../../src/api/routes';
import { LibSQLStore } from '@mastra/libsql';
import type { MastraCompositeStore } from '@mastra/core/storage';
import { supplierScoresFromSeed } from '../../src/core/history';
import { loadPack, type Pack } from '../../src/core/packs';
import { StubPayments } from '../../src/core/payments';
import type { SupplierScore } from '../../src/core/score';
import { InMemoryStore } from '../../src/core/store';
import type { ModelCall, PurchaseModel } from '../../src/purchase/model';
import type { ScoredQuote } from '../../src/purchase/schema';
import { PurchaseService } from '../../src/purchase/service';
import { createPurchaseWorkflow } from '../../src/purchase/workflow';

export type CallName = 'Need' | 'Choice';
type Responder = (call: ModelCall) => unknown;

/** Stand-in for the agents so workflow tests run without an API key. */
export class FakeModel implements PurchaseModel {
  calls: [CallName, ModelCall][] = [];
  constructor(private readonly responders: Partial<Record<CallName, Responder>>) {}

  private respond(name: CallName, call: ModelCall) {
    this.calls.push([name, call]);
    const r = this.responders[name];
    if (!r) throw new Error(`FakeModel has no responder for ${name}`);
    return r(call);
  }
  async extractNeed(call: ModelCall) {
    return this.respond('Need', call);
  }
  async chooseOption(call: ModelCall) {
    return this.respond('Choice', call);
  }
}

export const mostReliable = (options: ScoredQuote[]) =>
  options.reduce((best, o) =>
    o.reliability.score > best.reliability.score ||
    (o.reliability.score === best.reliability.score && o.unit_price < best.unit_price)
      ? o
      : best,
  );

export function makeModel(need: Record<string, unknown>, pick: (options: ScoredQuote[]) => ScoredQuote = mostReliable) {
  return new FakeModel({
    Need: () => need,
    Choice: (call) => {
      const options = JSON.parse(call.user).options as ScoredQuote[];
      return { option_id: pick(options).option_id, qty: need.qty, rationale: 'test pick' };
    },
  });
}

export const HEALD = { item_need: 'heald wires', search_terms: ['heald wire'], machine_id: 'L-07', urgency: 'line_down', qty: 500 };
export const MOTOR = { item_need: 'drive motor', search_terms: ['drive motor'], machine_id: 'L-03', urgency: 'line_down', qty: 1 };

let cachedPack: Pack | undefined;
let cachedScores: Record<string, SupplierScore> | undefined;
export const pack = () => (cachedPack ??= loadPack('manufacturing_textile'));
export const scores = () => (cachedScores ??= supplierScoresFromSeed(pack()));

let dbCounter = 0;
/** A private in-memory LibSQL database per call. */
export const memoryStorage = () =>
  new LibSQLStore({ id: `test-${++dbCounter}`, url: ':memory:' });

export interface Harness {
  service: PurchaseService;
  mastra: Mastra;
  model: FakeModel;
  store: InMemoryStore;
  payments: StubPayments;
}

export function harness(
  need: Record<string, unknown>,
  opts: {
    model?: FakeModel;
    store?: InMemoryStore;
    payments?: StubPayments;
    storage?: LibSQLStore | MastraCompositeStore | unknown;
    quoteLatencyMs?: number;
  } = {},
): Harness {
  const model = opts.model ?? makeModel(need);
  const store = opts.store ?? InMemoryStore.fromDemo(pack());
  const payments = opts.payments ?? new StubPayments();
  const workflow = createPurchaseWorkflow({
    pack: pack(),
    store,
    payments,
    model,
    supplierScores: scores(),
    quoteLatencyMs: opts.quoteLatencyMs ?? 0,
  });
  const mastra = new Mastra({
    workflows: { purchase: workflow },
    storage: (opts.storage ?? memoryStorage()) as LibSQLStore,
    logger: false,
    server: { apiRoutes: cartkeeperRoutes({ pack: pack(), store }) },
  });
  return { service: new PurchaseService(mastra), mastra, model, store, payments };
}
