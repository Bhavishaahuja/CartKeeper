-- Cartkeeper schema. Day 1 adds purchase_orders only (the CartLens views read it).
-- Day 3 adds the remaining tables, RLS policies and grants.

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

create index if not exists purchase_orders_company_supplier on purchase_orders (company_id, supplier_id);
create index if not exists purchase_orders_company_sku on purchase_orders (company_id, sku, machine_id, ordered_at);
