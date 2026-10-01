"""T2, T7, T8 against Stripe Issuing in test mode. Run with: pytest -m stripe

Needs STRIPE_SECRET_KEY (sk_test_/rk_test_) on an account with Issuing enabled and a
funded test Issuing balance. Everything shows up in the Stripe test dashboard under Issuing.
"""

import os
import uuid

import pytest

from backend.core.payments import make_payments

pytestmark = [
    pytest.mark.stripe,
    pytest.mark.skipif(not os.environ.get("STRIPE_SECRET_KEY"), reason="STRIPE_SECRET_KEY not set"),
]

PROPOSAL = {"supplier_id": "SUP-02", "supplier_name": "Precision Loom Parts Co", "sku": "HW-330-OMNI", "qty": 500}


@pytest.fixture(scope="module")
def payments():
    return make_payments(os.environ["STRIPE_SECRET_KEY"], currency="usd")


@pytest.fixture(scope="module")
def paid(payments):
    """T2: one approved purchase on a fresh single-use card."""
    prefix = f"ck-test-{uuid.uuid4().hex[:12]}"
    return prefix, payments.create(PROPOSAL, amount=95.0, idempotency_prefix=prefix,
                                   metadata={"request_id": prefix, "test": "t2"})


def test_t2_card_issued_and_charge_approved(paid):
    _, p = paid
    assert p["provider"] == "stripe_issuing"
    assert p["card_id"].startswith("ic_") and p["authorization_id"].startswith("iauth_")
    assert p["status"] == "approved", f"declined: {p['decline_reason']} (is the test Issuing balance funded?)"
    assert p["amount"] == p["spending_limit"] == 95.0


def test_t7_overcharge_declined_by_spending_controls(payments, paid):
    prefix, p = paid
    charge = payments.simulate_charge(p["card_id"], amount=120.0, merchant=PROPOSAL["supplier_name"],
                                      idempotency_key=f"{prefix}-overcharge")
    assert charge["approved"] is False
    assert charge["decline_reason"] == "spending_controls"


def test_t8_same_key_returns_the_same_card_and_charge(payments, paid):
    prefix, p = paid
    again = payments.create(PROPOSAL, amount=95.0, idempotency_prefix=prefix,
                            metadata={"request_id": prefix, "test": "t2"})
    assert again["card_id"] == p["card_id"]
    assert again["authorization_id"] == p["authorization_id"]
