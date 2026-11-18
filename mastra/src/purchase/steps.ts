/**
 * Step logic, one function per LangGraph node in backend/core/nodes.py.
 *
 * Each takes the purchase record and returns the fields it changes. The model
 * reads the request and picks among options; code finds the options and builds
 * the proposal from catalog data, so prices and SKUs in a proposal always come
 * from the pack, never from model output.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import type { CatalogItem, Pack } from '../core/packs';
import type { Payments } from '../core/payments';
import { checkPolicy, type PolicyResult } from '../core/policy';
import { pyFixedGrouped, pyRound } from '../core/pyfmt';
import type { SupplierScore } from '../core/score';
import type { Ledger } from '../core/store';
import { choiceSchema, needSchema, type PurchaseModel } from './model';
import type { Purchase, Quote, ScoredQuote } from './schema';

export const MAX_OPTION_ITEMS = 5;
export const MAX_REPLANS = 1;
export const QUOTE_LATENCY_MS = 400; // per simulated supplier quote

export interface PurchaseDeps {
  pack: Pack;
  store: Ledger;
  payments: Payments;
  model: PurchaseModel;
  supplierScores: Record<string, SupplierScore>;
  quoteLatencyMs?: number;
}

type Patch = Partial<Purchase>;

/** Python repr() of a string, for messages that quote the user's words. */
function pyRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  const body = s.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`).replaceAll('\n', '\\n');
  return `${quote}${body}${quote}`;
}

const now = () => performance.timeOrigin + performance.now();

// --- intake -------------------------------------------------------------------

export function intakeSystemPrompt(pack: Pack): string {
  const urgencyLines = Object.entries(pack.config.urgency_levels)
    .map(([k, u]) => `- ${k}: ${u.label}`)
    .join('\n');
  const machineLines = pack.machines.map((m) => `- ${m.machine_id}: ${m.model} (${m.type}, ${m.line})`).join('\n');
  return (
    `You turn purchase requests from a ${pack.config.name} floor into a structured need.\n\n` +
    `Urgency levels:\n${urgencyLines}\n\n` +
    'A machine that has stopped or a line that is down means the most urgent level.\n\n' +
    `Machine registry:\n${machineLines}`
  );
}

export async function intake(s: Purchase, { pack, model }: PurchaseDeps): Promise<Patch> {
  const schema = needSchema(pack);
  const raw = await model.extractNeed({ system: intakeSystemPrompt(pack), user: s.raw_request }, schema);
  const need = schema.parse(raw);
  return {
    need: {
      ...need,
      qty: Math.max(1, Math.trunc(need.qty)),
      search_terms: need.search_terms.map((t) => t.trim()).filter(Boolean).slice(0, 6),
    },
  };
}

// --- sourcing -------------------------------------------------------------------

function matchScore(item: CatalogItem, terms: string[]): number {
  const haystack = [item.name.toLowerCase(), item.sku.toLowerCase(), ...item.keywords.map((k) => k.toLowerCase())];
  let n = 0;
  for (const term of terms.map((t) => t.toLowerCase())) {
    for (const h of haystack) if (h.includes(term) || term.includes(h)) n += 1;
  }
  return n;
}

/** Find the catalog items that best match the need and fit the named machine. */
export function resolveItems(s: Purchase, { pack }: PurchaseDeps): Patch {
  const need = s.need!;
  const terms = need.search_terms.length ? need.search_terms : [need.item_need];
  const machine = need.machine_id ? pack.machine(need.machine_id) : undefined;
  const scored: [number, CatalogItem][] = [];
  for (const item of pack.catalog) {
    if (machine && item.compatible_models && !item.compatible_models.includes(machine.model)) continue;
    const score = matchScore(item, terms);
    if (score > 0) scored.push([score, item]);
  }
  const best = Math.max(0, ...scored.map(([score]) => score));
  const candidates = scored
    .filter(([score]) => score === best)
    .map(([, i]) => ({ sku: i.sku, name: i.name, category: i.category, unit: i.unit, compatible_models: i.compatible_models }))
    .slice(0, MAX_OPTION_ITEMS);
  return { candidates, inventory_hit: null, quotes: [], sourcing: { started_ms: now() } };
}

/**
 * Only a request that resolves to exactly one item can be filled from stock;
 * otherwise we'd be guessing which part the technician meant.
 */
export function checkInventory(s: Purchase, { pack }: PurchaseDeps): Patch {
  const candidates = s.candidates ?? [];
  const qty = s.need!.qty;
  if (candidates.length !== 1) return { inventory_hit: null };
  const item = candidates[0];
  const stock = pack.inventory[item.sku];
  if (!stock || stock.on_hand < qty) return { inventory_hit: null };
  return { inventory_hit: { sku: item.sku, name: item.name, qty, on_hand: stock.on_hand, location: stock.location } };
}

export interface QuoteRequest {
  supplier_id: string;
  skus: string[];
  qty: number;
}

/** One quote request per approved supplier that carries any candidate. */
export function quoteRequests(s: Purchase, { pack }: PurchaseDeps): QuoteRequest[] {
  const skus = (s.candidates ?? []).map((c) => c.sku);
  const qty = s.need!.qty;
  const out: QuoteRequest[] = [];
  for (const sup of pack.suppliers) {
    if (pack.config.policy.approved_suppliers_only && !sup.approved) continue;
    const carried = skus.filter((sku) => Object.hasOwn(sup.price_list, sku));
    if (carried.length) out.push({ supplier_id: sup.supplier_id, skus: carried, qty });
  }
  return out;
}

/** Ask one supplier for a quote. Simulated: price list lookup plus network-like latency. */
export async function quoteSupplier(req: QuoteRequest, { pack, quoteLatencyMs = QUOTE_LATENCY_MS }: PurchaseDeps): Promise<Quote[]> {
  const started = now();
  if (quoteLatencyMs > 0) await sleep(quoteLatencyMs);
  const sup = pack.supplier(req.supplier_id)!;
  const elapsed = Math.round(now() - started);
  return req.skus.map((sku) => {
    const item = pack.item(sku)!;
    const price = sup.price_list[sku];
    return {
      sku,
      name: item.name,
      category: item.category,
      unit: item.unit,
      compatible_models: item.compatible_models,
      supplier_id: sup.supplier_id,
      supplier_name: sup.name,
      unit_price: price.unit_price,
      lead_days: price.lead_days,
      latency_ms: elapsed,
    };
  });
}

export function mergeQuotes(s: Purchase): Patch {
  const quotes = s.quotes ?? [];
  const perSupplier: Record<string, number> = {};
  for (const q of quotes) perSupplier[q.supplier_id] = q.latency_ms;
  const roundMs = Math.round(now() - (s.sourcing?.started_ms ?? now()));
  return {
    sourcing: {
      suppliers_quoted: Object.keys(perSupplier).length,
      round_ms: roundMs,
      sequential_ms: Object.values(perSupplier).reduce((a, b) => a + b, 0),
      per_supplier_ms: perSupplier,
    },
  };
}

export function reserveFromStoreroom(s: Purchase): Patch {
  const hit = s.inventory_hit!;
  return {
    proposal: null,
    status: 'reserved',
    final_message: `In stock: ${hit.qty} x ${hit.name} reserved from ${hit.location} (${hit.on_hand} on hand). Nothing to buy.`,
  };
}

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

/** Attach each supplier's reliability (computed in code from order history) to its quotes. */
export function scoreQuotes(s: Purchase, { supplierScores }: PurchaseDeps): Patch {
  const ordered = [...(s.quotes ?? [])].sort(
    (a, b) => cmp(a.sku, b.sku) || cmp(a.unit_price, b.unit_price) || cmp(a.supplier_id, b.supplier_id),
  );
  const scored: ScoredQuote[] = ordered.map((q, i) => {
    const r = supplierScores[q.supplier_id];
    if (!r) throw new Error(`no reliability score for supplier ${q.supplier_id}`);
    const { latency_ms: _latency, ...rest } = q;
    return {
      option_id: `opt-${i + 1}`,
      ...rest,
      reliability: {
        score: r.score,
        on_time_rate: r.on_time_rate,
        avg_days_late: r.avg_days_late,
        defect_rate: r.defect_rate,
        orders: r.orders,
        low_confidence: r.low_confidence,
      },
    };
  });
  return { scored_quotes: scored };
}

// --- propose --------------------------------------------------------------------

export const PROPOSE_SYSTEM =
  'You are the purchasing agent for a manufacturer. Pick the single best option for the need. ' +
  'Only pick a part that fits the named machine (compatible_models null means it fits anything). ' +
  'Weigh speed against price using the urgency weights. Each option carries the supplier\'s ' +
  'reliability score (0-100) and on-time rate, learned from this company\'s own order history: ' +
  'a late or defective delivery costs more than the price difference when a machine is stopped, ' +
  'so treat reliability as part of speed. If you pick a pricier option over a cheaper one, say ' +
  'why and cite both suppliers\' on-time rates or scores. Keep qty as requested unless the unit ' +
  'makes that impossible. Explain the pick in 1 to 3 plain sentences.';

export const PROPOSE_RETRY_SYSTEM =
  ' Your previous pick was blocked by company policy for the reasons in previous_attempt; ' +
  'the options left all pass those checks. Mention briefly why you switched.';

export async function propose(s: Purchase, { pack, model }: PurchaseDeps): Promise<Patch> {
  const need = s.need!;
  const retrying = s.replan_count > 0;
  const quotes = (retrying ? s.eligible_quotes : s.scored_quotes) ?? [];
  if (!quotes.length) {
    return {
      proposal: null,
      status: 'no_match',
      final_message: `Nothing in stock and no approved supplier carries anything matching ${pyRepr(need.item_need)}.`,
    };
  }

  const machine = need.machine_id ? pack.machine(need.machine_id) : undefined;
  const urgency = pack.config.urgency_levels[need.urgency];
  const context: Record<string, unknown> = {
    need,
    machine: machine ?? null,
    urgency: { level: need.urgency, ...urgency },
    options: quotes,
  };
  if (retrying) context.previous_attempt = s.previous_attempt ?? null;
  const system = PROPOSE_SYSTEM + (retrying ? PROPOSE_RETRY_SYSTEM : '');

  const schema = choiceSchema(quotes.map((q) => q.option_id));
  const choice = schema.parse(await model.chooseOption({ system, user: JSON.stringify(context, null, 2) }, schema));

  // Rebuild the proposal from catalog data. The model only chose an option id.
  const picked = quotes.find((q) => q.option_id === choice.option_id)!;
  const qty = Math.max(1, Math.trunc(choice.qty));
  const unitPrice = pack.supplier(picked.supplier_id)!.price_list[picked.sku].unit_price;
  return {
    proposal: {
      supplier_id: picked.supplier_id,
      supplier_name: picked.supplier_name,
      sku: picked.sku,
      name: picked.name,
      qty,
      unit_price: unitPrice,
      total: pyRound(unitPrice * qty, 2),
      lead_days: picked.lead_days,
      supplier_score: picked.reliability.score,
      rationale: choice.rationale.trim(),
    },
  };
}

// --- the conscience: policy, approval, retry -------------------------------------

export function check(
  proposal: { sku: string; supplier_id: string; qty: number },
  s: Purchase,
  { pack, supplierScores, store }: PurchaseDeps,
): PolicyResult {
  const scope = pack.scopeKey(s.need?.machine_id);
  return checkPolicy(proposal, {
    pack,
    supplierScores,
    scopeKey: scope,
    budget: store.budget(scope),
    spent: store.spent(scope),
  });
}

export function policyCheck(s: Purchase, deps: PurchaseDeps): Patch {
  if (!s.proposal) return {};
  return { policy_result: check(s.proposal, s, deps) };
}

/**
 * After a block, keep only the options that would pass policy at the requested
 * qty, so the model can pick again. At most MAX_REPLANS times.
 */
export function replan(s: Purchase, deps: PurchaseDeps): Patch {
  const blocked = s.proposal;
  if (!blocked || s.policy_result?.decision !== 'blocked' || s.replan_count >= MAX_REPLANS) {
    return { retry: false };
  }
  const qty = s.need!.qty;
  const eligible = (s.scored_quotes ?? []).filter(
    (q) => check({ sku: q.sku, supplier_id: q.supplier_id, qty }, s, deps).decision !== 'blocked',
  );
  return {
    replan_count: s.replan_count + 1,
    eligible_quotes: eligible,
    previous_attempt: {
      proposal: { sku: blocked.sku, supplier_id: blocked.supplier_id, qty: blocked.qty, total: blocked.total },
      reasons: s.policy_result.reasons,
    },
    retry: eligible.length > 0,
  };
}

export function explainAndClose(s: Purchase): Patch {
  const reasons = (s.policy_result?.reasons ?? []).join(' ');
  const tried = s.replan_count ? ' I looked for another option within policy and none fits.' : '';
  return { status: 'blocked', final_message: `Not purchased. ${reasons}${tried}` };
}

/** Find who signs off: the required role, or the next role up if nobody holds it. */
export function routeApprover(s: Purchase, { pack, store }: PurchaseDeps): Patch {
  const roles = pack.approverRoles();
  const required = s.policy_result!.approver_role!;
  const from = roles.indexOf(required);
  if (from < 0) throw new Error(`approver role '${required}' is not an approval tier`);
  for (const role of roles.slice(from)) {
    const people = store.membersWithRole(role);
    if (people.length) return { approver_id: people[0].user_id, approver_role: role };
  }
  return { approver_id: null, approver_role: required };
}

export function closeRejected(): Patch {
  return { status: 'rejected', final_message: 'Rejected by the approver. Nothing was purchased.' };
}

/** The only step that moves money. Re-checks policy first: an approval can sit for hours. */
export async function execute(s: Purchase, deps: PurchaseDeps): Promise<Patch> {
  const proposal = s.proposal!;
  const recheck = check(proposal, s, deps);
  if (recheck.decision === 'blocked') {
    return {
      policy_result: recheck,
      status: 'blocked',
      final_message: `Not purchased: policy changed while this waited. ${recheck.reasons.join(' ')}`,
    };
  }
  const payment = await deps.payments.create(proposal, {
    amount: recheck.total!,
    idempotencyKey: `ck-${s.request_id}-execute`,
  });
  return { payment };
}

export function confirmAndLog(s: Purchase, { pack, store }: PurchaseDeps): Patch {
  if (!s.payment) return {}; // execute blocked; its message stands
  const p = s.proposal!;
  store.recordOrder({
    request_id: s.request_id,
    scope_key: pack.scopeKey(s.need?.machine_id),
    supplier_id: p.supplier_id,
    sku: p.sku,
    machine_id: s.need?.machine_id ?? null,
    qty: p.qty,
    total: s.payment.amount,
    source: 'cartkeeper',
  });
  return {
    status: 'executed',
    final_message: `Ordered ${p.qty} x ${p.name} from ${p.supplier_name} for $${pyFixedGrouped(s.payment.amount, 2)}.`,
  };
}
