"""Payments. Only the execute node calls this, and only after the policy gate passed.

Every purchase gets its own virtual card whose all-time spending limit is the
approved total, so the card itself refuses an overcharge (and, once used, any
further charge). The supplier's charge is simulated with Stripe's Issuing test
helpers: an authorization for the order total, then a capture.

Two implementations share one interface:
- StripeIssuingPayments: real Stripe Issuing calls, test mode only.
- StubPayments: same behaviour in memory, for offline tests and keyless local runs.

Interface:
    create(proposal, *, amount, idempotency_prefix, metadata=None) -> payment dict
    simulate_charge(card_id, *, amount, merchant, idempotency_key) -> charge dict

Idempotency: every Stripe write uses f"{idempotency_prefix}-{step}", where the
prefix is f"ck-{request_id}", so a retried or double-submitted execute returns
the same card and the same charge instead of creating new ones.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from decimal import ROUND_HALF_UP, Decimal

log = logging.getLogger("cartkeeper")

TEST_KEY_PREFIXES = ("sk_test_", "rk_test_")
CARDHOLDER_EMAIL = "purchasing@cartkeeper.example"
CARDHOLDER_PHONE = "+15555550100"   # cards need a phone on file (3-D Secure); a reserved test number
CARDHOLDER_NAME = "Cartkeeper Purchasing"   # an individual: first + last name
MERCHANT_NAME_MAX = 22
FINANCIAL_ACCOUNTS_VERSION = "2026-06-24.preview"   # v2 financial accounts are a preview API
_UNSET = object()


class PaymentError(RuntimeError):
    """The payment provider failed (network, configuration). Nothing was charged."""


def require_test_key(key: str) -> None:
    """Startup guard: Cartkeeper V0 never touches live money."""
    if not key.startswith(TEST_KEY_PREFIXES):
        raise SystemExit(
            "STRIPE_SECRET_KEY is not a test-mode key. Cartkeeper only runs in Stripe test mode: "
            "use a key starting with sk_test_ (or a restricted rk_test_ key)."
        )


def to_cents(amount: float) -> int:
    return int((Decimal(str(amount)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def make_payments(stripe_key: str | None, *, currency: str):
    if not stripe_key:
        log.warning("STRIPE_SECRET_KEY not set: payments are simulated in memory (no Stripe calls)")
        return StubPayments(currency=currency)
    require_test_key(stripe_key)
    import stripe

    return StripeIssuingPayments(stripe.StripeClient(stripe_key), currency=currency,
                                 cardholder_id=os.environ.get("STRIPE_CARDHOLDER_ID") or None,
                                 financial_account_id=os.environ.get("STRIPE_FINANCIAL_ACCOUNT_ID") or _UNSET)


def _metadata(proposal: dict, extra: dict | None) -> dict[str, str]:
    base = {"supplier_id": proposal["supplier_id"], "sku": proposal["sku"], "qty": proposal["qty"]}
    return {k: str(v) for k, v in {**base, **(extra or {})}.items() if v is not None}


def _payment(*, provider, card, amount, charge, prefix, currency) -> dict:
    return {
        "provider": provider,
        "card_id": card["id"],
        "last4": card["last4"],
        "spending_limit": amount,
        "amount": amount,
        "currency": currency,
        "authorization_id": charge["authorization_id"],
        "transaction_id": charge.get("transaction_id"),
        "status": "approved" if charge["approved"] else "declined",
        "decline_reason": charge.get("decline_reason"),
        "idempotency_key": prefix,
    }


# --- in memory ------------------------------------------------------------------

class StubPayments:
    """Single-use cards with spending limits, simulated. Idempotent per key, like Stripe."""

    provider = "stub"

    def __init__(self, currency: str = "usd"):
        self.currency = currency
        self._lock = threading.Lock()
        self.payments: dict[str, dict] = {}       # idempotency prefix -> payment
        self.cards: dict[str, dict] = {}          # card id -> {limit_cents, spent_cents, metadata}
        self.charges: dict[str, dict] = {}        # idempotency key -> charge

    def create(self, proposal: dict, *, amount: float, idempotency_prefix: str, metadata: dict | None = None) -> dict:
        with self._lock:
            if idempotency_prefix in self.payments:
                return dict(self.payments[idempotency_prefix])
            card_id = f"ic_stub_{len(self.cards) + 1:04d}"
            self.cards[card_id] = {"limit_cents": to_cents(amount), "spent_cents": 0,
                                   "metadata": _metadata(proposal, metadata)}
        charge = self.simulate_charge(card_id, amount=amount, merchant=proposal.get("supplier_name", ""),
                                      idempotency_key=f"{idempotency_prefix}-charge")
        payment = _payment(provider=self.provider, card={"id": card_id, "last4": card_id[-4:]},
                           amount=amount, charge=charge, prefix=idempotency_prefix, currency=self.currency)
        with self._lock:
            return dict(self.payments.setdefault(idempotency_prefix, payment))

    def simulate_charge(self, card_id: str, *, amount: float, merchant: str, idempotency_key: str) -> dict:
        with self._lock:
            if idempotency_key in self.charges:
                return dict(self.charges[idempotency_key])
            card = self.cards.get(card_id)
            if card is None:
                raise PaymentError(f"unknown card {card_id}")
            cents = to_cents(amount)
            approved = card["spent_cents"] + cents <= card["limit_cents"]
            if approved:
                card["spent_cents"] += cents
            n = len(self.charges) + 1
            charge = {
                "authorization_id": f"iauth_stub_{n:04d}",
                "transaction_id": f"ipi_stub_{n:04d}" if approved else None,
                "card_id": card_id,
                "amount": amount,
                "merchant": merchant,
                "approved": approved,
                "decline_reason": None if approved else "spending_controls",
            }
            self.charges[idempotency_key] = charge
            return dict(charge)


# --- Stripe Issuing (test mode) -------------------------------------------------

class StripeIssuingPayments:
    provider = "stripe_issuing"

    def __init__(self, client, *, currency: str, cardholder_id: str | None = None, financial_account_id=None):
        """financial_account_id: an fa_... id, None for the classic Issuing balance, or _UNSET to look it up."""
        self.client = client
        self.currency = currency
        self._cardholder_id = cardholder_id
        self._financial_account = financial_account_id
        self._lock = threading.Lock()

    def _call(self, fn, *args, **kwargs):
        import stripe

        try:
            return fn(*args, **kwargs)
        except stripe.StripeError as e:
            raise PaymentError(f"Stripe: {e.user_message or e.__class__.__name__}") from e

    def cardholder_id(self) -> str:
        """The company's purchasing cardholder: found by email, created on first use."""
        with self._lock:
            if self._cardholder_id:
                return self._cardholder_id
            issuing = self.client.v1.issuing
            found = self._call(issuing.cardholders.list,
                               params={"email": CARDHOLDER_EMAIL, "status": "active", "limit": 1})
            if found.data:
                holder = found.data[0]
                if not getattr(holder, "phone_number", None):
                    self._call(issuing.cardholders.update, holder.id, params={"phone_number": CARDHOLDER_PHONE})
                self._cardholder_id = holder.id
            else:
                # Test-mode accounts often only allow individual cardholders, so the
                # purchasing cardholder is a named person who has accepted the card terms.
                created = self._call(issuing.cardholders.create, params={
                    "type": "individual",
                    "name": CARDHOLDER_NAME,
                    "email": CARDHOLDER_EMAIL,
                    "phone_number": CARDHOLDER_PHONE,
                    "individual": {
                        "first_name": CARDHOLDER_NAME.split()[0],
                        "last_name": CARDHOLDER_NAME.split()[-1],
                        "card_issuing": {"user_terms_acceptance": {"date": int(time.time()), "ip": "127.0.0.1"}},
                    },
                    "billing": {"address": {"line1": "1 Mill Road", "city": "San Francisco",
                                            "state": "CA", "postal_code": "94103", "country": "US"}},
                }, options={"idempotency_key": f"ck-cardholder-{CARDHOLDER_EMAIL}"})
                self._cardholder_id = created.id
                log.info("created Issuing cardholder %s", created.id)
            return self._cardholder_id

    def financial_account_id(self) -> str | None:
        """Newer Stripe accounts fund Issuing from a v2 financial account, and cards must name it.
        Accounts on the classic Issuing balance have none, and cards are created without one."""
        with self._lock:
            if self._financial_account is _UNSET:
                self._financial_account = None
                try:
                    resp = self.client.raw_request("get", "/v2/money_management/financial_accounts",
                                                   stripe_version=FINANCIAL_ACCOUNTS_VERSION)
                    accounts = json.loads(resp.body).get("data", [])
                except Exception as e:  # no preview access: the account uses the classic balance
                    log.info("no v2 financial accounts (%s); using the Issuing balance", e.__class__.__name__)
                    accounts = []
                usable = sorted((a for a in accounts if a.get("status") != "closed"
                                 and self.currency in ((a.get("storage") or {}).get("holds_currencies") or [])),
                                key=lambda a: a.get("status") != "open")   # open ones first
                if usable:
                    self._financial_account = usable[0]["id"]
                    log.info("issuing cards from financial account %s", self._financial_account)
            return self._financial_account

    def create(self, proposal: dict, *, amount: float, idempotency_prefix: str, metadata: dict | None = None) -> dict:
        extra = {"financial_account_v2": fa} if (fa := self.financial_account_id()) else {}
        card = self._call(self.client.v1.issuing.cards.create, params={
            **extra,
            "cardholder": self.cardholder_id(),
            "currency": self.currency,
            "type": "virtual",
            "status": "active",
            # The rails-level conscience: the card can never spend more than the approved total.
            "spending_controls": {"spending_limits": [{"amount": to_cents(amount), "interval": "all_time"}]},
            "metadata": _metadata(proposal, metadata),
        }, options={"idempotency_key": f"{idempotency_prefix}-card"})
        log.info("issued single-use card %s capped at %s %.2f", card.id, self.currency.upper(), amount)
        charge = self.simulate_charge(card.id, amount=amount, merchant=proposal.get("supplier_name", ""),
                                      idempotency_key=f"{idempotency_prefix}-charge")
        return _payment(provider=self.provider, card={"id": card.id, "last4": card.last4},
                        amount=amount, charge=charge, prefix=idempotency_prefix, currency=self.currency)

    def simulate_charge(self, card_id: str, *, amount: float, merchant: str, idempotency_key: str) -> dict:
        """The supplier charges the card: a test authorization, captured if Issuing approves it."""
        helpers = self.client.v1.test_helpers.issuing.authorizations
        auth = self._call(helpers.create, params={
            "card": card_id,
            "amount": to_cents(amount),
            "currency": self.currency,
            "merchant_data": {"name": (merchant or "Supplier")[:MERCHANT_NAME_MAX]},
        }, options={"idempotency_key": idempotency_key})
        transaction_id = None
        if auth.approved:
            captured = self._call(helpers.capture, auth.id, options={"idempotency_key": f"{idempotency_key}-capture"})
            txns = getattr(captured, "transactions", None) or []
            transaction_id = txns[0].id if txns else None
        reason = None
        if not auth.approved:
            history = getattr(auth, "request_history", None) or []
            reason = history[-1].reason if history else "declined"
        log.info("supplier charge %.2f on %s: %s", amount, card_id, "approved" if auth.approved else f"declined ({reason})")
        return {
            "authorization_id": auth.id,
            "transaction_id": transaction_id,
            "card_id": card_id,
            "amount": amount,
            "merchant": merchant,
            "approved": bool(auth.approved),
            "decline_reason": reason,
        }
