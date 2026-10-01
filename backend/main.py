"""Cartkeeper API.

Run:  uvicorn backend.main:app --reload

Auth is a development stand-in until Day 5: callers send X-User-Id with a demo
company member's id. Day 5 replaces current_user with Supabase token checks.
"""

from __future__ import annotations

import logging
import os
import threading
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

from .core.checkpoint import make_checkpointer, postgres_checkpointer
from .core.graph import DEFAULT_PACK, build_graph, decide, live_scores, snapshot, start
from .core.packs import load_pack
from .core.payments import PaymentError, make_payments
from .core.store import InMemoryStore, PostgresStore

log = logging.getLogger("cartkeeper")

# Roles that can see every request in the company; requesters see their own.
COMPANY_WIDE_ROLES = {"maintenance_manager", "owner", "finance"}


class NewRequest(BaseModel):
    raw_request: str = Field(min_length=3, max_length=2000)


class Decision(BaseModel):
    approval: Literal["approved", "rejected"]


class Receipt(BaseModel):
    delivered_at: datetime | None = None          # default: now
    defect: bool = False


class SupplierCharge(BaseModel):
    amount: float = Field(gt=0, le=1_000_000)


def _public(view: dict) -> dict:
    s = view["state"]
    return {
        "request_id": view["request_id"],
        "status": view["status"],
        "requester_id": s.get("requester_id"),
        "raw_request": s.get("raw_request"),
        "need": s.get("need"),
        "inventory_hit": s.get("inventory_hit"),
        "sourcing": {k: v for k, v in (s.get("sourcing") or {}).items() if k != "started"} or None,
        "options": s.get("scored_quotes") or [],
        "proposal": s.get("proposal"),
        "policy_result": s.get("policy_result"),
        "previous_attempt": s.get("previous_attempt"),
        "approver_id": s.get("approver_id"),
        "approver_role": s.get("approver_role"),
        "decided_by": s.get("decided_by"),
        "payment": s.get("payment"),
        "message": s.get("final_message"),
    }


def create_app(*, pack=None, llm=None, store=None, payments=None, checkpointer=None,
               supplier_scores=None, quote_latency=None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        nonlocal llm, checkpointer, store, payments
        closers = []
        p = pack or load_pack(os.environ.get("CARTKEEPER_PACK", DEFAULT_PACK))
        if payments is None:
            # Refuses to boot on anything but a Stripe test-mode key.
            payments = make_payments(os.environ.get("STRIPE_SECRET_KEY"), currency=p.config.currency)
        if llm is None:
            from .core.llm import make_llm
            llm = make_llm()
        database_url = os.environ.get("DATABASE_URL")
        if database_url and (store is None or checkpointer is None):
            from .core.db import make_pool, setup
            pool = make_pool(database_url)
            closers.append(pool.close)
            if checkpointer is None:
                checkpointer = postgres_checkpointer(pool)
            if store is None:
                store = PostgresStore(pool, setup(pool, p))
        if checkpointer is None:
            checkpointer, close = make_checkpointer(None)
            closers.append(close)
        app.state.pack = p
        app.state.store = store if store is not None else InMemoryStore.from_demo(p)
        app.state.payments = payments
        app.state.scores = (lambda: supplier_scores) if supplier_scores is not None \
            else live_scores(p, app.state.store)
        kwargs = {"supplier_scores": supplier_scores}
        if quote_latency is not None:
            kwargs["quote_latency"] = quote_latency
        app.state.graph = build_graph(p, llm, store=app.state.store, payments=payments,
                                      checkpointer=checkpointer, **kwargs)
        app.state.locks = defaultdict(threading.Lock)
        yield
        for close in closers:
            close()

    app = FastAPI(title="Cartkeeper", lifespan=lifespan)

    def require_role(user: dict, roles: set[str]) -> None:
        if user["role"] not in roles:
            raise HTTPException(403, "Your role can't do that.")

    def current_user(request: Request, x_user_id: str = Header(default="")) -> dict:
        member = request.app.state.store.member(x_user_id) if x_user_id else None
        if member is None:
            raise HTTPException(401, "Unknown user. Send X-User-Id with a company member's id.")
        return member

    def load(request: Request, request_id: str, user: dict) -> dict:
        view = snapshot(request.app.state.graph, request_id)
        if view is None:
            raise HTTPException(404, "Request not found.")
        view = {"request_id": request_id, **view}
        s = view["state"]
        visible = (
            user["role"] in COMPANY_WIDE_ROLES
            or s.get("requester_id") == user["user_id"]
            or s.get("approver_id") == user["user_id"]
        )
        if not visible:
            raise HTTPException(404, "Request not found.")
        return view

    def index(request: Request, view: dict) -> None:
        s = view["state"]
        request.app.state.store.upsert_request(
            view["request_id"], status=view["status"], requester_id=s.get("requester_id"),
            approver_id=s.get("approver_id") if view["status"] == "awaiting_approval" else None,
            raw_request=s.get("raw_request"), total=(s.get("proposal") or {}).get("total"),
            urgency=(s.get("need") or {}).get("urgency"),
            machine_id=(s.get("need") or {}).get("machine_id"),
        )

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.post("/requests", status_code=201)
    def create_request(body: NewRequest, request: Request, user: dict = Depends(current_user)):
        view = start(request.app.state.graph, body.raw_request, requester_id=user["user_id"])
        index(request, view)
        return _public(view)

    @app.get("/requests/{request_id}")
    def get_request(request_id: str, request: Request, user: dict = Depends(current_user)):
        return _public(load(request, request_id, user))

    @app.post("/requests/{request_id}/decision")
    def decide_request(request_id: str, body: Decision, request: Request, user: dict = Depends(current_user)):
        with request.app.state.locks[request_id]:     # a double click resumes the graph once
            view = load(request, request_id, user)
            if view["status"] != "awaiting_approval":
                raise HTTPException(409, f"Request is {view['status']}, not awaiting approval.")
            s = view["state"]
            if s.get("requester_id") == user["user_id"]:
                raise HTTPException(403, "You can't approve your own request.")
            roles = request.app.state.pack.approver_roles()
            required = s["approver_role"]
            if s["approver_id"] != user["user_id"] and (
                user["role"] not in roles or roles.index(user["role"]) < roles.index(required)
            ):
                raise HTTPException(403, f"This request needs {required.replace('_', ' ')} approval.")
            view = decide(request.app.state.graph, request_id, approval=body.approval,
                          decided_by=user["user_id"])
            index(request, view)
            return _public(view)

    @app.post("/requests/{request_id}/receipt")
    def receive_order(request_id: str, body: Receipt, request: Request, user: dict = Depends(current_user)):
        """Goods arrived (or didn't arrive right). Feeds the supplier's reliability score."""
        load(request, request_id, user)
        store = request.app.state.store
        order = store.order(request_id)
        if order is None:
            raise HTTPException(409, "Nothing was purchased for this request.")
        if order.get("delivered_at"):
            raise HTTPException(409, "Delivery was already recorded.")
        delivered_at = body.delivered_at or datetime.now(timezone.utc)
        if delivered_at.tzinfo is None:
            delivered_at = delivered_at.replace(tzinfo=timezone.utc)
        order = store.record_delivery(request_id, delivered_at=delivered_at, defect=body.defect)
        late = (delivered_at.date() - order["promised_at"].date()).days
        store.audit(request_id, "receipt", "delivered", actor=user["user_id"],
                    rationale=("on time" if late <= 0 else f"{late} day(s) late") + (", defective" if body.defect else ""),
                    detail={"supplier_id": order["supplier_id"], "days_late": max(late, 0), "defect": body.defect})
        return {"request_id": request_id, "supplier_id": order["supplier_id"], "days_late": max(late, 0),
                "defect": body.defect, "supplier_score": request.app.state.scores()[order["supplier_id"]]}

    @app.post("/requests/{request_id}/supplier-charge")
    def simulate_supplier_charge(request_id: str, body: SupplierCharge, request: Request,
                                 user: dict = Depends(current_user)):
        """Test mode only (T7): the supplier tries another charge on this request's card."""
        require_role(user, {"owner", "finance"})
        view = load(request, request_id, user)
        payment = view["state"].get("payment")
        if not payment:
            raise HTTPException(409, "This request has no card.")
        n = sum(1 for r in request.app.state.store.audit_rows(request_id) if r["action"].startswith("test_charge"))
        try:
            charge = request.app.state.payments.simulate_charge(
                payment["card_id"], amount=body.amount, merchant=view["state"]["proposal"]["supplier_name"],
                idempotency_key=f"ck-{request_id}-testcharge-{n + 1}")
        except PaymentError as e:
            raise HTTPException(502, str(e)) from e
        request.app.state.store.audit(
            request_id, "supplier_charge", "test_charge_approved" if charge["approved"] else "test_charge_declined",
            actor=user["user_id"], stripe_ref=charge["authorization_id"], rationale=charge.get("decline_reason"),
            detail={"amount": body.amount, "card_limit": payment["spending_limit"]})
        return charge

    @app.get("/requests/{request_id}/audit")
    def request_audit(request_id: str, request: Request, user: dict = Depends(current_user)):
        load(request, request_id, user)
        return request.app.state.store.audit_rows(request_id)

    @app.get("/audit")
    def company_audit(request: Request, user: dict = Depends(current_user)):
        require_role(user, COMPANY_WIDE_ROLES)
        return request.app.state.store.audit_rows()

    @app.get("/suppliers/scorecard")
    def scorecard(request: Request, user: dict = Depends(current_user)):
        p = request.app.state.pack
        scores = request.app.state.scores()
        rows = [{"supplier_id": s.supplier_id, "name": s.name, "approved": s.approved, **scores[s.supplier_id]}
                for s in p.suppliers if s.supplier_id in scores]
        return sorted(rows, key=lambda r: r["score"], reverse=True)

    @app.get("/approvals")
    def pending_approvals(request: Request, user: dict = Depends(current_user)):
        return request.app.state.store.list_requests(status="awaiting_approval", approver_id=user["user_id"])

    return app


load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(message)s")
app = create_app()  # the model client and database pool are only created when the server starts
