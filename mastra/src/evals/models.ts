/**
 * Scripted models for checking the eval pipeline without API calls.
 *
 *   oracle   reads every need exactly as labeled and picks like a careful buyer:
 *            most reliable when a machine is down, cheapest otherwise
 *   cheapest reads correctly but always picks the cheapest option
 *   sloppy   picks well but misreads urgency (always restock) and quantity (always 1)
 *
 * The oracle must score 1.0 on every code scorer; that is what validates the labels.
 */

import type { PurchaseModel } from '../purchase/model';
import type { ScoredQuote } from '../purchase/schema';
import type { EvalItem } from './dataset';

type Picker = (options: ScoredQuote[], urgency: string) => ScoredQuote;

const byScore: Picker = (o) => o.reduce((b, x) => (x.reliability.score > b.reliability.score || (x.reliability.score === b.reliability.score && x.unit_price < b.unit_price) ? x : b));
const byPrice: Picker = (o) => o.reduce((b, x) => (x.unit_price < b.unit_price ? x : b));
const careful: Picker = (o, urgency) => (urgency === 'line_down' ? byScore(o, urgency) : byPrice(o, urgency));

function labeledNeed(item: EvalItem) {
  const n = item.label.need;
  return {
    item_need: n.skus.length ? n.skus.join(' or ') : item.input.raw_request,
    // A SKU is its own best search term; nothing in the catalog matches the impossible item.
    search_terms: n.skus.length ? n.skus : ['espresso'],
    machine_id: n.machine_id[0],
    urgency: n.urgency[0],
    qty: n.qty,
  };
}

function scripted(items: EvalItem[], pick: Picker, mangle: (need: ReturnType<typeof labeledNeed>) => ReturnType<typeof labeledNeed> = (n) => n): PurchaseModel {
  const byRequest = new Map(items.map((i) => [i.input.raw_request, i]));
  return {
    async extractNeed(call) {
      const item = byRequest.get(call.user);
      if (!item) throw new Error(`scripted model has no label for: ${call.user}`);
      return mangle(labeledNeed(item));
    },
    async chooseOption(call) {
      const ctx = JSON.parse(call.user);
      const chosen = pick(ctx.options, ctx.need.urgency);
      return { option_id: chosen.option_id, qty: ctx.need.qty, rationale: `Chose ${chosen.supplier_name}.` };
    },
  };
}

export const oracleModel = (items: EvalItem[]) => scripted(items, careful);
export const cheapestModel = (items: EvalItem[]) => scripted(items, byPrice);
export const sloppyModel = (items: EvalItem[]) => scripted(items, careful, (n) => ({ ...n, urgency: 'restock', qty: 1 }));
