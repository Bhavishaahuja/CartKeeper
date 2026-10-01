-- CartLens layer: supplier intelligence views over purchase_orders.
-- Views return raw counts; backend/core/score.py turns them into 0-100 scores
-- (pooled-rate shrinkage + pack weights), so the math lives in one tested place.
-- security_invoker makes the views respect the caller's RLS on purchase_orders.

-- Per-supplier delivery record. Mirrors backend.core.history.aggregate().
create or replace view vw_supplier_reliability with (security_invoker = true) as
select
  company_id,
  supplier_id,
  count(*)                                                        as orders,
  count(*) filter (where delivered_at::date <= promised_at::date) as on_time_orders,
  coalesce(sum(greatest(delivered_at::date - promised_at::date, 0)), 0)::numeric as late_days_sum,
  count(*) filter (where defect)                                  as defect_orders
from purchase_orders
where delivered_at is not null
group by company_id, supplier_id;

-- Where the money goes, and how much of it was bought in a hurry (lead time <= 1 day).
create or replace view vw_spend_by_supplier with (security_invoker = true) as
select
  company_id,
  supplier_id,
  count(*)                                                     as orders,
  sum(total)                                                   as spend,
  round(sum(total) / nullif(sum(sum(total)) over (partition by company_id), 0), 4) as spend_share,
  sum(total) filter (where promised_at::date - ordered_at::date <= 1) as urgent_spend
from purchase_orders
group by company_id, supplier_id;

-- Parts that keep failing on the same machine at a steady interval ("stock this part").
create or replace view vw_part_failure_cadence with (security_invoker = true) as
with ordered as (
  select
    company_id, sku, machine_id, ordered_at,
    ordered_at::date - lag(ordered_at::date) over (
      partition by company_id, sku, machine_id order by ordered_at
    ) as gap_days
  from purchase_orders
  where machine_id is not null
)
select
  company_id,
  sku,
  machine_id,
  count(*) + 1                          as orders,
  round(avg(gap_days), 1)               as avg_gap_days,
  round(stddev_samp(gap_days), 1)       as gap_stddev_days,
  max(ordered_at)                       as last_ordered_at,
  (max(ordered_at)::date + round(avg(gap_days))::int) as next_expected_on
from ordered
where gap_days is not null
group by company_id, sku, machine_id
having count(*) >= 3                                   -- at least 4 orders
   and stddev_samp(gap_days) <= 0.25 * avg(gap_days);  -- steady, not random
