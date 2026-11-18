/**
 * Company data the workflow reads and writes: budgets, members, executed orders.
 * Port of backend/core/store.py. In memory for now; a Supabase-backed store with
 * the same methods comes later.
 */

import type { Pack } from './packs';
import { pyRound } from './pyfmt';

export interface Member {
  user_id: string;
  name: string;
  role: string;
}

export interface OrderRecord {
  request_id: string;
  scope_key: string;
  total: number;
  ordered_at?: Date;
  [field: string]: unknown;
}

export interface Ledger {
  budget(scopeKey: string): number | null;
  spent(scopeKey: string, now?: Date): number;
  membersWithRole(role: string): Member[];
  member(userId: string): Member | undefined;
  /** Record an executed purchase once per request. Returns false if already recorded. */
  recordOrder(order: OrderRecord): boolean;
}

export class InMemoryStore implements Ledger {
  budgets: Record<string, number>;
  members: Member[];
  orders: (OrderRecord & { ordered_at: Date })[] = [];

  constructor({ budgets, members }: { budgets: Record<string, number>; members: Member[] }) {
    this.budgets = { ...budgets };
    this.members = members.map((m) => ({ ...m }));
  }

  static fromDemo(pack: Pack): InMemoryStore {
    const demo = pack.demo_company;
    if (!demo) throw new Error(`pack '${pack.key}' has no demo_company.json`);
    return new InMemoryStore({ budgets: demo.budgets, members: [...demo.members] });
  }

  budget(scopeKey: string): number | null {
    return this.budgets[scopeKey] ?? null;
  }

  /** Spent this calendar month (UTC) in a budget scope. */
  spent(scopeKey: string, now: Date = new Date()): number {
    const total = this.orders
      .filter(
        (o) =>
          o.scope_key === scopeKey &&
          o.ordered_at.getUTCFullYear() === now.getUTCFullYear() &&
          o.ordered_at.getUTCMonth() === now.getUTCMonth(),
      )
      .reduce((sum, o) => sum + o.total, 0);
    return pyRound(total, 2);
  }

  membersWithRole(role: string): Member[] {
    return this.members.filter((m) => m.role === role);
  }

  member(userId: string): Member | undefined {
    return this.members.find((m) => m.user_id === userId);
  }

  recordOrder(order: OrderRecord): boolean {
    if (this.orders.some((o) => o.request_id === order.request_id)) return false;
    this.orders.push({ ordered_at: new Date(), ...order });
    return true;
  }
}
