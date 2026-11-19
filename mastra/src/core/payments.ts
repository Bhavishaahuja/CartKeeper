/**
 * Payments. Port of backend/core/payments.py. Only the execute step calls this,
 * and only after the policy gate passed again. Stripe Issuing comes later behind
 * the same create() signature.
 */

export interface Payment {
  provider: string;
  card_id: string;
  amount: number;
  status: string;
  idempotency_key: string;
}

export interface Payments {
  create(proposal: Record<string, unknown>, opts: { amount: number; idempotencyKey: string }): Promise<Payment>;
}

/** Records payments in memory. Idempotent: the same key always returns the same payment. */
export class StubPayments implements Payments {
  readonly payments = new Map<string, Payment>();
  /** Every create() call, including repeats that the idempotency key absorbed. */
  calls = 0;

  async create(_proposal: Record<string, unknown>, { amount, idempotencyKey }: { amount: number; idempotencyKey: string }) {
    this.calls += 1;
    let payment = this.payments.get(idempotencyKey);
    if (!payment) {
      payment = {
        provider: 'stub',
        card_id: `stub_card_${this.payments.size + 1}`,
        amount,
        status: 'approved',
        idempotency_key: idempotencyKey,
      };
      this.payments.set(idempotencyKey, payment);
    }
    return { ...payment };
  }
}
