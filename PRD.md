# Cartkeeper PRD (v3: B2B core + industry packs + positioning)

An agentic purchasing system for B2B companies. Someone on the floor needs something bought fast. Cartkeeper finds it, picks the most reliable supplier, checks it against company rules, gets the right person's approval, and pays with a single-use card. Every step is logged.

Owner: Bhavi
Status: Pre-build, ready for Day 0
Supersedes: v1 (consumer shopping) and v2 (no positioning)
First industry: Manufacturing (textile mill pack)

---

## 1. Why this exists

Every product I'd built solved a real problem, but none of them were for a business. Cartkeeper is the first one built for B2B, and its first real-world reference user is a textile manufacturing business owner.

## 2. The problem

In a plant, machines break. When a loom, spinning frame, or dyeing machine goes down, a technician needs a part or consumable fast. Companies are stuck between two bad options:

- **Go through procurement properly.** Requisition, approval, purchase order. Slow. The machine sits idle, and idle machines cost money every hour.
- **Skip the process.** Someone buys from whoever is fastest, on a personal or shared card. The part arrives, but finance finds out weeks later, the company paid too much, and nobody knows if that supplier is any good. Procurement calls this maverick spend.

Nobody gives you speed AND control. That's the gap.

## 3. Who it's for

**Target company:** small and mid-size manufacturers with no dedicated procurement team and no ERP system. The owner or plant manager approves purchases personally, and orders often happen over phone and messaging.

**Roles inside that company:**

| Role | What they want |
|---|---|
| **Requester** (technician, supervisor) | "Get me this part, today, without paperwork." |
| **Approver** (maintenance manager, plant manager, owner) | "Only bother me when it matters, and show me why." |
| **Finance / owner** | "Every rupee or dollar accounted for, and stop paying for unreliable suppliers." |

## 4. Positioning

> For small and mid-size manufacturers without a procurement team, Cartkeeper turns a machine breakdown into a paid order from the most reliable supplier in minutes, with the owner's rules enforced.

How the pieces fit together:

| Role in the strategy | What it is | Why it matters |
|---|---|---|
| **The gap (lead with this)** | Floor-first, downtime-first | Existing tools start from "an employee submits a purchase request." Cartkeeper starts from "a machine just stopped." This sets the user, the metric (breakdown-to-paid-order time), and the story. |
| **The edge** | Supplier reliability learned from the company's own history (CartLens layer) | When a line is down, the cheapest supplier is often the wrong one. That knowledge usually lives only in the owner's head. Cartkeeper learns it from order history and uses it in every decision. |
| **The audience** | No ERP needed | Built for companies the big platforms aren't designed around. Works from day one with a supplier list and past orders. Also keeps the build realistic (no SAP integration). |
| **The channel (V1)** | WhatsApp / voice intake | Fits how mill floors actually communicate, but it's a delivery method, not the core idea. V0 ships web chat. Promote to first V1 feature if discovery confirms orders happen over WhatsApp. |

## 5. Competitive landscape

The space is crowded, and that's validation: well-funded companies shipping AI purchasing agents proves the problem is real. Cartkeeper doesn't claim to be a new idea. It claims a different starting point and a different customer.

Snapshot as of Oct 2026 from public product pages and coverage. Re-check before interviews, this market moves monthly.

| | Ramp | Didero | Zip | Evolinq |
|---|---|---|---|---|
| **What it is** | Spend management platform; launched an AI procurement agent fleet (Apr 2026) and Agent Cards (single-use virtual cards for agents, early access) | Agentic AI layer over ERP for manufacturing procurement; processes supplier emails and messages | Intake-to-procure orchestration for mid-market and enterprise | AI procurement focused on MRO and tactical sourcing |
| **Starts from** | Employee purchase request / spend policy | Existing ERP data and supplier inbox | Request intake form | Procurement team workflow |
| **Built for** | Companies with a finance team, US-style corporate cards | Manufacturers and distributors already on an ERP | Companies with procurement ops | Procurement teams with high MRO volume |
| **Downtime-first?** | No | Partially (manufacturing focus) | No | Partially (MRO focus) |
| **No ERP needed?** | Yes for cards, ERP sync is a selling point | No, sits on top of ERP | Integrates with existing stack | Unclear |
| **Supplier reliability from own history?** | Not the focus (spend control is) | Tracks supplier communications | Vendor management, not delivery scoring | Unclear |
| **What they do better** | Real card issuing at scale, approval chains, ERP integrations, huge customer base | Deep ERP integration, real supplier email automation | Enterprise-grade approvals and orchestration | Mature MRO automation |

**Where Cartkeeper is honestly weaker:** it's a prototype. Test mode, synthetic order history, no ERP or accounting integrations, one industry pack. The README should say this directly.

**The interview answer:** "Ramp proved agents should buy with single-use cards and inherited approval rules, and I built the same safety pattern on Stripe Issuing. Where I'd differ is the starting point and the customer: a small manufacturer with no procurement team, where the trigger is a stopped machine and the hardest decision is which supplier will actually deliver today. That's why the supplier-reliability layer is the core of my product, not a side feature."

**Payment rail caveat:** the natural wedge market (small manufacturers, including in places like India) isn't always covered by Stripe Issuing. The demo runs in US test mode; a real rollout there would need a local payment rail.

## 6. Product shape: one core, many industry packs

**The core** is industry-agnostic: the LangGraph agent, the policy gate, supplier scoring (CartLens layer), Stripe payments, approvals, audit log.

**An industry pack** is a config folder that tells the core how this industry works: what gets bought, what "urgent" means, how budgets are split, who approves what, and how suppliers are scored. During onboarding the company picks its industry, the pack loads, and they can tweak it.

Rule: **the core never contains `if industry == ...`.** If the core needs to behave differently, the pack declares it.

V0 ships the core plus one full pack: **manufacturing / textile mill**. Restaurants is the planned second pack to prove the core generalizes.

## 7. Design principles

1. **The model proposes, the code disposes.** The LLM understands requests, compares options, and writes rationale. Plain Python decides policy, computes scores, and moves money. The LLM never has a tool that approves its own purchase.
2. **LangGraph has to earn its place.** Every LangGraph feature used must solve a specific problem listed in section 8. If a plain function would do, use a plain function.
3. **The pack is data, not code.** New industry = new config + seed data, no agent rewrites.
4. **Test mode, always.** No real money in V0.

## 8. Why LangGraph (and exactly what for)

This is the section to defend in interviews. Each feature maps to a real need, not a buzzword.

| Real need | LangGraph feature | Why a plain script fails |
|---|---|---|
| A manager's approval can take minutes or hours, and they may answer from their phone after the server restarted. | `interrupt()` + Postgres checkpointer (durable pause and resume by `thread_id`) | A script would have to hold the request in memory or you'd hand-build a state machine with a DB. |
| Check internal stock AND get quotes from several suppliers at the same time, then merge results. | Parallel fan-out with `Send`, merged by a state reducer | Sequential calls are slow (PrepPilot's 90s lesson), and hand-rolled threading loses the shared state. |
| If the best option is blocked by policy or a supplier is out of stock, try again differently. | Conditional edges with cycles (bounded retry) | Linear pipelines can't loop back with new information. |
| Different industries need extra steps (textile: does this part fit this machine model?). | Optional nodes / subgraphs registered by the pack | Without it, the core fills up with industry if-statements. |
| Show the user real progress, not fake checkmarks. | `stream_mode="updates"` streaming node events to the UI | PrepPilot challenge #6: the old progress bar was cosmetic. This fixes it properly. |
| Finance asks "why did it buy this?" a month later. | Checkpoint state history (`get_state_history`) feeds the audit "why" view | Otherwise you'd reconstruct reasoning from scattered logs. |

**LangChain's role (deliberately small):** `langchain-anthropic` for `ChatAnthropic`, `.bind_tools()` for supplier tools, `.with_structured_output()` for the proposal schema. No `AgentExecutor`, no prebuilt ReAct agent for the main flow. The graph is hand-built so routing stays in code we control.

**What LangGraph is NOT used for:** policy math, supplier scoring, payments. Those are plain, unit-tested Python functions called from nodes.

## 9. The graph

```
START
  -> intake            LLM: parse request into {item_need, machine_id?, urgency, qty}
  -> pack_hooks_pre    optional pack nodes (textile: machine_compatibility)
  -> fan_out           Send to: check_inventory + quote_supplier x N (parallel)
  -> merge_quotes      reducer combines results
  -> score             CartLens layer: attach reliability score to each supplier (code)
  -> propose           LLM (structured output): pick option + rationale
  -> policy_check      code: auto_approve | needs_approval | blocked
       auto_approve   -> execute
       needs_approval -> route_approver -> await_approval (interrupt, durable)
                           approved -> execute
                           rejected -> close
       blocked        -> replan (max 1) -> fan_out
                         retries used up -> explain_and_close
  -> execute           Stripe Issuing single-use virtual card, idempotent
  -> confirm_and_log   writes PO record + audit row + updates supplier history
END
```

If the item is in internal stock, the graph short-circuits to "reserve from storeroom" and never buys anything. That's often the best answer, and showing the agent choosing NOT to spend is part of the conscience.

### State (sketch)

```python
class PurchaseState(TypedDict):
    company_id: str
    request_id: str
    requester_id: str
    pack: dict                                # loaded industry pack config
    raw_request: str
    need: dict                                # {item_need, machine_id, urgency, qty}
    inventory_hit: dict | None
    quotes: Annotated[list[dict], operator.add]   # reducer for parallel fan-out
    scored_quotes: list[dict]
    proposal: dict | None                     # {supplier_id, sku, qty, unit_price, total, rationale}
    policy_result: dict | None                # {decision, reasons, budget_scope, remaining}
    approver_id: str | None
    approval: str | None
    replan_count: int
    payment: dict | None                      # {card_id, authorization_id, status}
    final_message: str
```

## 10. Industry pack spec

```
packs/
  manufacturing_textile/
    pack.yaml
    catalog.json        # SKUs: parts + consumables
    suppliers.json      # supplier list (reliability is NOT stored here, it's computed)
    machines.json       # machine registry for the compatibility hook
    seed_history.py     # generates synthetic PO history for the CartLens layer
```

`pack.yaml` example:

```yaml
name: Manufacturing (Textile mill)
currency: usd                    # demo runs in USD test mode
budget_scope: production_line    # budgets tracked per line
urgency_levels:
  line_down:   { label: "Machine stopped", speed_weight: 0.7, price_weight: 0.3 }
  this_week:   { label: "Needed this week", speed_weight: 0.4, price_weight: 0.6 }
  restock:     { label: "Routine restock", speed_weight: 0.1, price_weight: 0.9 }
approval_rules:
  - { max_total: 150,  approver_role: none }              # auto-approve
  - { max_total: 1500, approver_role: maintenance_manager }
  - { max_total: null, approver_role: owner }
policy:
  approved_suppliers_only: true
  min_supplier_score: 60
  blocked_categories: []
scoring_weights:                 # how CartLens computes the supplier score
  on_time_rate: 0.5
  avg_days_late: 0.2
  defect_rate: 0.3
hooks:
  pre_search: [machine_compatibility]
```

Textile catalog covers things a mill actually buys in a hurry: loom parts (heald wires, reeds, drop wires, shuttles/grippers), spinning parts (ring travellers, spindle tapes, aprons, cots), knitting needles, bearings, V-belts, motors, sensors, and dyeing chemicals.

## 11. The CartLens layer: supplier intelligence

CartLens's methods, applied to suppliers instead of customers.

| CartLens (Olist) | Cartkeeper equivalent |
|---|---|
| Delivery vs promised date, impact on reviews | **Supplier reliability:** on-time rate, avg days late, defect/return rate |
| RFM segmentation of customers | **Spend segmentation:** which suppliers and parts carry most spend, which are bought urgently |
| Cohort retention cliff | **Failure patterns:** "this part fails on Line 3 every ~6 weeks, stock it" |
| Average-of-ratios correction | Supplier scores are volume-weighted so a supplier with 2 lucky orders doesn't outrank one with 200 solid orders |

Implementation:
- `seed_history.py` generates ~12 months of synthetic purchase orders. Each supplier has a hidden "true" reliability; the data is noisy. The point: the scoring must *discover* reliability from history, never read it from a config.
- SQL views in Supabase Postgres, ported from the CartLens BigQuery views: `vw_supplier_reliability`, `vw_spend_by_supplier`, `vw_part_failure_cadence`.
- `score.py` (pure Python) combines view outputs with pack weights into a 0 to 100 score. Unit tested.
- The agent's rationale must cite the score in plain words ("B is $6 more but on time 94% vs 71%, and the line is down").
- Every executed purchase writes back to history, so scores update. CartLens goes from a static Kaggle project to a live data loop.
- Honesty note for the README: methods proven on Olist's real data, applied here on synthetic plant data.

## 12. Payments: Stripe Issuing

- Each approved purchase gets a **single-use virtual card**, created for that purchase, with `spending_controls` capping it at the approved total. Even if the supplier overcharges, the card refuses.
- This is the conscience at the rails level, not just in prompt or code logic. Same pattern spend-management companies build on.
- Demo: simulate the supplier's charge using Stripe's Issuing test helpers to create a test authorization, show it approved at the right amount, and show an over-limit attempt getting declined.
- Idempotency key on every Stripe write: `f"ck-{request_id}-{step}"`.
- Startup guard: refuse to boot unless the key starts with `sk_test_`.
- **Day 0 check:** confirm Issuing is enabled on your Stripe test account. Fallback if it isn't: test-mode PaymentIntents, with Issuing as V1. Also note for later: Issuing is only available in certain countries, so a real rollout outside them (e.g. a mill in India) would need a different payment rail. Worth one honest line in the README.

## 13. Data model (Supabase, RLS on everything)

Lesson from PrepPilot #9: run grants AND policies together, then verify with a test read and write.

```
companies      (id, name, industry_pack, created_at)
members        (company_id, user_id, role)             -- requester | maintenance_manager | owner | finance
budgets        (company_id, scope_key, period, amount)  -- scope_key = production line id for textile
suppliers      (id, company_id, name, categories[], approved bool)
purchase_orders(id, company_id, supplier_id, sku, qty, total, promised_at, delivered_at,
                defect bool, source text)               -- source: seed | cartkeeper
requests       (id, company_id, requester_id, raw_request, status, created_at)
proposals      (id, request_id, payload jsonb, policy_result jsonb, status, card_id, executed_at)
audit_log      (id, company_id, request_id, node, action, rationale, actor, stripe_ref, created_at)
```

RLS is per company (membership), not per user. A technician sees their own requests; managers and owners see the company's.

LangGraph checkpoints live in the same Postgres via `langgraph-checkpoint-postgres`.

## 14. API (FastAPI)

| Method | Route | Purpose |
|---|---|---|
| POST | `/onboarding` | Create company, pick industry pack, seed demo data |
| POST | `/requests` | Start a purchase request (streams node updates via SSE) |
| GET | `/requests/{id}` | Current state |
| POST | `/requests/{id}/decision` | Approver approves or rejects, resumes the graph |
| GET | `/approvals` | Pending approvals for the signed-in approver |
| GET | `/suppliers/scorecard` | CartLens supplier scores |
| GET | `/insights` | Spend segments + failure-cadence alerts |
| GET/PUT | `/pack` | View or tweak pack settings (limits, weights) |
| GET | `/audit` | Audit log with the "why" view |

## 15. Frontend (React + Vite + Tailwind, PrepPilot tokens)

1. **Onboarding:** pick industry (V0: Manufacturing active, others shown as "coming soon"), company name, lines/budgets.
2. **Request:** text box ("Loom L-07 heald wires snapped, need 500 today"), live node progress from streaming.
3. **Approval card:** item, supplier, total, scores of all options, rationale, policy reasons, approve/reject.
4. **Supplier scorecard:** the CartLens view. Reliability ranking, on-time trend.
5. **Insights:** spend segments, "stock this part" alerts.
6. **Audit:** timeline per request, card id, "why" view.

## 16. Metrics

North star: **downtime-to-purchase time**, minutes from request to paid order for `line_down` requests.

Supporting:
- **Policy adherence:** % of purchases within policy. Must be 100%. A miss is a P0 bug.
- **Approval precision:** % of proposals approved as-is (agent judgment matches the manager's).
- **Maverick spend captured:** % of urgent buys that went through Cartkeeper instead of around it (real-world metric, survey for now).
- **Supplier quality drift:** avg reliability score of suppliers actually used over time (should rise).

## 17. Test scenarios (also the demo script)

Seed: Line 2 budget $3,000/month, auto-approve under $150, owner approval over $1,500.

| # | Request | Expected |
|---|---|---|
| T1 Storeroom | "Need 2 x 6205 bearings for spinning frame S-04" (in stock) | Reserves from inventory, zero spend |
| T2 Fast + cheap | "Loom L-07 heald wires snapped, need 500 today" ($90) | auto_approve, picks reliable supplier, card created, paid |
| T3 Reliability beats price | Same as T2 but cheapest supplier has a bad score | Picks pricier reliable supplier, rationale cites both scores |
| T4 Manager approval | "Replace drive motor on loom L-03" ($900) | Pauses for maintenance manager, approve resumes and pays |
| T5 Durable pause | T4, restart the backend before approving | Approval still works after restart |
| T6 Blocked | Request that exceeds Line 2's remaining budget | Blocked, tries a cheaper option, explains if none fits, zero Stripe calls |
| T7 Rails enforcement | Simulate supplier charging over the card limit | Authorization declined by Issuing |
| T8 Idempotency | Double-click approve | One card, one charge |
| T9 Compatibility hook | Order a part that doesn't fit the named machine | Flagged before any search |

pytest for T1 to T9 (mock the LLM where possible, real Stripe test mode for T2, T4, T7, T8).

## 18. Repo layout

```
cartkeeper/
  PRD.md  README.md  .env.example  .gitignore     # .gitignore BEFORE first git add
  backend/
    requirements.txt                              # clean, no look-alike packages
    main.py                                       # FastAPI, auth, SSE streaming
    core/
      graph.py  state.py  nodes.py  hooks.py      # LangGraph core
      policy.py                                   # pure, unit tested
      score.py                                    # CartLens scoring, pure, unit tested
      payments.py                                 # Stripe Issuing
      packs.py                                    # pack loader + validation
      db.py
    tests/
  packs/
    manufacturing_textile/  (see section 10)
    restaurant/             (stub: pack.yaml only)
  db/
    schema.sql  views.sql                         # views.sql = CartLens layer
  frontend/
    src/pages/  Onboarding  Request  Approvals  Scorecard  Insights  Audit  Login
```

## 19. Build plan

### Before Day 0: discovery (1 to 2 hours, high value)
Interview the textile business owner. Ask: what breaks most, what did the last urgent purchase look like start to finish, who approves what amounts, how many suppliers per part, how they currently track spend, how requests reach them today (WhatsApp, calls, walk-ups), and whether they've tried any purchasing or spend software. Use the answers to fill `pack.yaml` and the catalog with real-shaped data. Put a short "what I learned" section in the README. A PM application with real user discovery beats one with invented personas.

### Day 0: core skeleton
venv, requirements (`langgraph`, `langchain-anthropic`, `langgraph-checkpoint-postgres`, `stripe`, `fastapi`, `uvicorn`, `python-dotenv`, `pyyaml`, `supabase`), pack loader with validation, textile pack files, minimal graph: `intake -> propose` on the catalog, CLI entry point. Confirm Issuing on the Stripe test account.
- [ ] `python -m backend.core.graph "loom L-07 heald wires snapped"` returns a structured need + a proposal.
- [ ] Pack loads and fails loudly on a bad config.

### Day 1: parallel sourcing + CartLens layer
`check_inventory`, `quote_supplier`, fan-out with `Send`, reducer merge, `seed_history.py`, `views.sql`, `score.py`.
- [ ] T1 short-circuits to storeroom.
- [ ] Quotes from all suppliers arrive in one parallel round (log timings).
- [ ] `score.py` unit tests pass, including volume weighting.
- [ ] T3 picks the reliable supplier and the rationale cites scores.

### Day 2: the conscience
`policy.py`, budget scopes, approver routing, durable `interrupt()` with Postgres checkpointer, bounded replan, FastAPI `/requests` and `/decision`.
- [ ] `policy.py` unit tests pass for every approval tier.
- [ ] T4, T5, T6 pass.
- [ ] No LLM-callable tool can change a policy decision (check the bound tool list).

### Day 3: payments
`payments.py` with Issuing single-use cards, spending controls, test authorizations, idempotency, audit writes, PO write-back to history.
- [ ] T2, T7, T8 pass and show up in the Stripe test dashboard.
- [ ] Executed purchases change supplier scores on the next run.

### Day 4: textile hook + streaming
`machine_compatibility` hook registered by the pack, SSE streaming of node updates.
- [ ] T9 passes.
- [ ] A request shows real node-by-node progress in the terminal/UI.

### Day 5: the surface
All frontend screens, magic-link auth, company roles.
- [ ] Full T1 to T9 flow from the browser.
- [ ] A technician account can't see other people's requests; the owner sees everything.

### Day 6: ship
Deploy (Render + Vercel), README (problem, discovery notes, positioning + competitive landscape, why LangGraph table, model-proposes-code-disposes, CartLens layer, honest limits), record the demo.
- [ ] Demo: T2, T3, T4 (approve from a second account), T7, then the scorecard, in under 3 minutes.

### After V0: second pack
Fill `packs/restaurant/` (budget per location/week, perishability hook, same-day delivery weight). Success = zero changes to `core/`.

## 20. Risks and open questions

| Risk | Mitigation |
|---|---|
| LLM invents a price or SKU | Proposal must reference real SKU ids; policy re-reads prices from the catalog |
| Issuing not enabled on test account | Day 0 check; PaymentIntent fallback |
| Synthetic data looks fake | Shape it from the discovery interview; say it's synthetic in the README |
| Over-engineering the pack system | Only add a pack field when the textile pack actually needs it |
| Render cold start | Keep-warm before demos |

Open questions:
- WhatsApp/voice intake is the planned first V1 feature (see Positioning). Confirm in the discovery interview that urgent orders really happen over WhatsApp before building it.
- Multi-currency: V0 is USD test mode. A real deployment for a mill outside the US needs local currency and a local payment rail.
- Should the "stock this part" insight trigger an automatic restock request, or only suggest it?
