"""Payments. Only the execute node calls this, and only after the policy gate passed.

Day 2 ships a stub so the flow is testable end to end. Day 3 adds Stripe Issuing
single-use cards behind the same create() signature.
"""

from __future__ import annotations

import threading


class StubPayments:
    """Records payments in memory. Idempotent: the same key always returns the same payment."""

    def __init__(self):
        self._lock = threading.Lock()
        self.payments: dict[str, dict] = {}

    def create(self, proposal: dict, *, amount: float, idempotency_key: str) -> dict:
        with self._lock:
            if idempotency_key not in self.payments:
                self.payments[idempotency_key] = {
                    "provider": "stub",
                    "card_id": f"stub_card_{len(self.payments) + 1}",
                    "amount": amount,
                    "status": "approved",
                    "idempotency_key": idempotency_key,
                }
            return dict(self.payments[idempotency_key])
