-- Cartkeeper schema. Safe to re-run: every statement is idempotent.
-- Applied by `python -m backend.core.db setup` (and on API startup when DATABASE_URL is set).
--
-- RLS is on for every table. The backend connects as the database owner, which
-- bypasses RLS; Supabase's anon/authenticated roles get nothing until Day 5 adds
-- the per-company membership policies that go with login.

create table if not exists companies (
  id            uuid primary key,
  name          text not null,
  industry_pack text not null,
  created_at    timestamptz not null default now()
);

create table if not exists members (
  company_id uuid not null references companies (id) on delete cascade,
  user_id    text not null,
  name       text not null,
  role       text not null check (role in ('requester', 'maintenance_manager', 'owner', 'finance')),
  primary key (company_id, user_id)
);

create table if not exists budgets (
  company_id uuid not null references companies (id) on delete cascade,
  scope_key  text not null,              -- production line id for textile
  period     text not null default 'month',
  amount     numeric(12, 2) not null check (amount >= 0),
  primary key (company_id, scope_key, period)
);

create table if not exists suppliers (
  company_id  uuid not null references companies (id) on delete cascade,
  supplier_id text not null,
  name        text not null,
  categories  text[] not null default '{}',
  approved    boolean not null default false,
  primary key (company_id, supplier_id)
);

create table if not exists purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  supplier_id  text not null,
  sku          text not null,
  machine_id   text,                    -- which machine the part went to (failure cadence)
  qty          integer not null check (qty > 0),
  total        numeric(12, 2) not null,
  ordered_at   timestamptz not null,
  promised_at  timestamptz not null,
  delivered_at timestamptz,             -- null until delivered
  defect       boolean not null default false,
  source       text not null check (source in ('seed', 'cartkeeper'))
);

-- Day 3: executed orders link back to their request and card, and carry their budget scope.
alter table purchase_orders add column if not exists request_id text unique;
alter table purchase_orders add column if not exists scope_key  text;
alter table purchase_orders add column if not exists card_id    text;

create index if not exists purchase_orders_company_supplier on purchase_orders (company_id, supplier_id);
create index if not exists purchase_orders_company_sku on purchase_orders (company_id, sku, machine_id, ordered_at);
create index if not exists purchase_orders_company_scope on purchase_orders (company_id, scope_key, ordered_at)
  where source = 'cartkeeper';

-- Index of requests for listing. The LangGraph checkpoint holds the full state.
create table if not exists requests (
  id           text primary key,         -- = LangGraph thread_id
  company_id   uuid not null references companies (id) on delete cascade,
  requester_id text,
  raw_request  text,
  status       text,
  approver_id  text,
  total        numeric(12, 2),
  urgency      text,
  machine_id   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists requests_company_status on requests (company_id, status, approver_id);

create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references companies (id) on delete cascade,
  request_id  text,
  node        text not null,
  action      text not null,
  rationale   text,
  actor       text,                      -- agent | policy | stripe | a member's user_id
  stripe_ref  text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_company_request on audit_log (company_id, request_id, id);

alter table companies       enable row level security;
alter table members         enable row level security;
alter table budgets         enable row level security;
alter table suppliers       enable row level security;
alter table purchase_orders enable row level security;
alter table requests        enable row level security;
alter table audit_log       enable row level security;

-- On Supabase, make sure the API roles can't reach these tables before Day 5's policies exist.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on companies, members, budgets, suppliers, purchase_orders, requests, audit_log from anon, authenticated';
  end if;
end $$;
