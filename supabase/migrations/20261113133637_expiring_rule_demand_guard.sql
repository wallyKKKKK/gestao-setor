alter table public.expiring_discount_rules
  add column if not exists skip_if_demand_covers_balance boolean not null default false;
