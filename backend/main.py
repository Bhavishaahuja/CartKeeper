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
from typing import Literal

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

from .core.checkpoint import make_checkpointer
from .core.graph import DEFAULT_PACK, build_graph, decide, snapshot, start
from .core.packs import load_pack
from .core.store import InMemoryStore

log = logging.getLogger("cartkeeper")

# Roles that can see every request in the company; requesters see their own.
COMPANY_WIDE_ROLES = {"maintenance_manager", "owner", "finance"}


class NewRequest(BaseModel):
    raw_request: str = Field(min_length=3, max_length=2000)


class Decision(BaseModel):
    approval: Literal["approved", "rejected"]


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
        nonlocal llm, checkpointer
        close = lambda: None  # noqa: E731
        if llm is None:
            from .core.llm import make_llm
            llm = make_llm()
        if checkpointer is None:
            checkpointer, close = make_checkpointer(os.environ.get("DATABASE_URL"))
        p = pack or load_pack(os.environ.get("CARTKEEPER_PACK", DEFAULT_PACK))
        app.state.pack = p
        app.state.store = store if store is not None else InMemoryStore.from_demo(p)
        kwargs = {"supplier_scores": supplier_scores}
        if quote_latency is not None:
            kwargs["quote_latency"] = quote_latency
        app.state.graph = build_graph(p, llm, store=app.state.store, payments=payments,
                                      checkpointer=checkpointer, **kwargs)
        app.state.locks = defaultdict(threading.Lock)
        yield
        close()

    app = FastAPI(title="Cartkeeper", lifespan=lifespan)

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

    @app.get("/approvals")
    def pending_approvals(request: Request, user: dict = Depends(current_user)):
        return request.app.state.store.list_requests(status="awaiting_approval", approver_id=user["user_id"])

    return app


load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(message)s")
app = create_app()  # the model client and database pool are only created when the server starts
