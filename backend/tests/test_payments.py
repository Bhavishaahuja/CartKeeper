"""Day 3: payments. Offline: the stub, and the Stripe adapter against a recording fake client."""

import json
from types import SimpleNamespace as NS

import pytest
import stripe

from backend.core.payments import (
    PaymentError,
    StripeIssuingPayments,
    StubPayments,
    _UNSET,
    make_payments,
    require_test_key,
    to_cents,
)

PROPOSAL = {"supplier_id": "SUP-02", "supplier_name": "Precision Loom Parts Co", "sku": "HW-330-OMNI", "qty": 500}


def test_startup_guard_refuses_live_keys():
    for bad in ("sk_live_abc", "rk_live_abc", "pk_test_abc", "abc"):
        with pytest.raises(SystemExit) as e:
            require_test_key(bad)
        assert bad not in str(e.value)                    # never echo the key
    require_test_key("sk_test_abc")
    require_test_key("rk_test_abc")
    with pytest.raises(SystemExit):
        make_payments("sk_live_abc", currency="usd")


def test_no_key_means_simulated_payments():
    assert isinstance(make_payments(None, currency="usd"), StubPayments)
    assert isinstance(make_payments("", currency="usd"), StubPayments)


def test_to_cents_rounds_money_not_floats():
    assert to_cents(95.0) == 9500
    assert to_cents(0.1 + 0.2) == 30
    assert to_cents(890) == 89000
    assert to_cents(19.995) == 2000


# --- stub ------------------------------------------------------------------------

def test_stub_issues_capped_card_and_charges_it():
    pay = StubPayments()
    p = pay.create(PROPOSAL, amount=95.0, idempotency_prefix="ck-r1")
    assert p["status"] == "approved"
    assert p["amount"] == p["spending_limit"] == 95.0
    assert p["card_id"].startswith("ic_") and p["authorization_id"]
    assert pay.cards[p["card_id"]]["limit_cents"] == 9500


def test_t8_stub_same_key_means_one_card_one_charge():
    pay = StubPayments()
    a = pay.create(PROPOSAL, amount=95.0, idempotency_prefix="ck-r1")
    b = pay.create(PROPOSAL, amount=95.0, idempotency_prefix="ck-r1")
    assert a == b
    assert len(pay.cards) == 1 and len(pay.charges) == 1


def test_t7_stub_card_refuses_overcharge_and_reuse():
    pay = StubPayments()
    card = pay.create(PROPOSAL, amount=95.0, idempotency_prefix="ck-r1")["card_id"]
    again = pay.simulate_charge(card, amount=10, merchant="x", idempotency_key="k2")
    assert not again["approved"] and again["decline_reason"] == "spending_controls"

    fresh = StubPayments()
    fresh.cards["ic_x"] = {"limit_cents": 9500, "spent_cents": 0, "metadata": {}}
    over = fresh.simulate_charge("ic_x", amount=120, merchant="x", idempotency_key="k3")
    assert not over["approved"]
    assert fresh.cards["ic_x"]["spent_cents"] == 0       # a declined charge spends nothing


# --- Stripe adapter against a fake client ----------------------------------------

class FakeStripe:
    """Mimics the parts of stripe.StripeClient that payments.py uses, and records each call."""

    def __init__(self, *, existing_cardholder=None, approve=True, fail_on=None, financial_account=False):
        self.financial_account = financial_account
        self.calls = []
        self.existing_cardholder = existing_cardholder
        self.approve = approve
        self.fail_on = fail_on
        rec = self._rec
        self.raw_request = rec("raw_request")
        self.v1 = NS(
            issuing=NS(
                cardholders=NS(list=rec("cardholders.list"), create=rec("cardholders.create"),
                               update=rec("cardholders.update")),
                cards=NS(create=rec("cards.create")),
            ),
            test_helpers=NS(issuing=NS(authorizations=NS(
                create=rec("authorizations.create"), capture=rec("authorizations.capture"),
            ))),
        )

    def _rec(self, name):
        def call(*args, params=None, options=None, **kw):
            self.calls.append((name, args, params or kw or None, options))
            if name == self.fail_on:
                raise stripe.APIConnectionError("network down")
            return self._respond(name, args, params)
        return call

    def _respond(self, name, args, params):
        if name == "raw_request":
            fas = [{"id": "fa_test_1", "status": "pending", "storage": {"holds_currencies": ["usd"]}}]
            return NS(body=json.dumps({"data": fas if self.financial_account else []}))
        if name == "cardholders.list":
            return NS(data=[NS(id=self.existing_cardholder, phone_number=None)] if self.existing_cardholder else [])
        if name == "cardholders.update":
            return NS(id=args[0])
        if name == "cardholders.create":
            return NS(id="ich_new")
        if name == "cards.create":
            return NS(id="ic_123", last4="4242")
        if name == "authorizations.create":
            if self.approve:
                return NS(id="iauth_1", approved=True, request_history=[NS(reason="webhook_approved")])
            return NS(id="iauth_1", approved=False, request_history=[NS(reason="spending_controls")])
        if name == "authorizations.capture":
            return NS(id=args[0], transactions=[NS(id="ipi_1")])
        raise AssertionError(name)

    def by_name(self, name):
        return [c for c in self.calls if c[0] == name]


def test_stripe_card_is_capped_at_the_approved_total():
    fake = FakeStripe()
    pay = StripeIssuingPayments(fake, currency="usd")
    p = pay.create(PROPOSAL, amount=95.0, idempotency_prefix="ck-r1", metadata={"request_id": "r1"})

    (_, _, params, options), = fake.by_name("cards.create")
    assert params["type"] == "virtual" and params["status"] == "active" and params["currency"] == "usd"
    assert params["cardholder"] == "ich_new"
    assert params["spending_controls"] == {"spending_limits": [{"amount": 9500, "interval": "all_time"}]}
    assert params["metadata"]["request_id"] == "r1" and params["metadata"]["qty"] == "500"
    assert options == {"idempotency_key": "ck-r1-card"}

    (_, _, params, options), = fake.by_name("authorizations.create")
    assert params["card"] == "ic_123" and params["amount"] == 9500
    assert params["merchant_data"]["name"] == "Precision Loom Parts C"   # Stripe's 22-char limit
    assert options == {"idempotency_key": "ck-r1-charge"}
    (_, args, _, options), = fake.by_name("authorizations.capture")
    assert args == ("iauth_1",) and options == {"idempotency_key": "ck-r1-charge-capture"}

    assert p == {
        "provider": "stripe_issuing", "card_id": "ic_123", "last4": "4242", "spending_limit": 95.0,
        "amount": 95.0, "currency": "usd", "authorization_id": "iauth_1", "transaction_id": "ipi_1",
        "status": "approved", "decline_reason": None, "idempotency_key": "ck-r1",
    }


def test_stripe_reuses_an_existing_cardholder_once():
    fake = FakeStripe(existing_cardholder="ich_old")
    pay = StripeIssuingPayments(fake, currency="usd")
    pay.create(PROPOSAL, amount=1, idempotency_prefix="ck-a")
    pay.create(PROPOSAL, amount=1, idempotency_prefix="ck-b")
    assert len(fake.by_name("cardholders.list")) == 1
    assert fake.by_name("cardholders.create") == []
    assert {c[2]["cardholder"] for c in fake.by_name("cards.create")} == {"ich_old"}
    (_, args, params, _), = fake.by_name("cardholders.update")      # phone backfilled for 3-D Secure
    assert args == ("ich_old",) and params["phone_number"]


def test_new_cardholder_is_an_individual_with_a_phone():
    fake = FakeStripe()
    StripeIssuingPayments(fake, currency="usd").create(PROPOSAL, amount=1, idempotency_prefix="ck-a")
    (_, _, params, _), = fake.by_name("cardholders.create")
    assert params["type"] == "individual" and params["phone_number"]
    assert params["individual"]["card_issuing"]["user_terms_acceptance"]["ip"]


def test_cards_draw_on_a_v2_financial_account_when_the_account_has_one():
    fake = FakeStripe(financial_account=True)
    pay = StripeIssuingPayments(fake, currency="usd", cardholder_id="ich_x", financial_account_id=_UNSET)
    pay.create(PROPOSAL, amount=1, idempotency_prefix="ck-a")
    pay.create(PROPOSAL, amount=1, idempotency_prefix="ck-b")
    assert len(fake.by_name("raw_request")) == 1                       # looked up once
    assert {c[2]["financial_account_v2"] for c in fake.by_name("cards.create")} == {"fa_test_1"}

    classic = FakeStripe(financial_account=False)
    StripeIssuingPayments(classic, currency="usd", cardholder_id="ich_x", financial_account_id=_UNSET).create(
        PROPOSAL, amount=1, idempotency_prefix="ck-a")
    assert "financial_account_v2" not in classic.by_name("cards.create")[0][2]


def test_stripe_decline_is_reported_and_not_captured():
    fake = FakeStripe(approve=False)
    p = StripeIssuingPayments(fake, currency="usd", cardholder_id="ich_x").create(
        PROPOSAL, amount=95.0, idempotency_prefix="ck-r1")
    assert p["status"] == "declined" and p["decline_reason"] == "spending_controls"
    assert fake.by_name("authorizations.capture") == []


def test_stripe_errors_become_payment_errors():
    fake = FakeStripe(fail_on="cards.create")
    with pytest.raises(PaymentError, match="Stripe"):
        StripeIssuingPayments(fake, currency="usd", cardholder_id="ich_x").create(
            PROPOSAL, amount=95.0, idempotency_prefix="ck-r1")
