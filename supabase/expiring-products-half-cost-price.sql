alter table public.expiring_inventory_items
  add column if not exists cost_price numeric(12, 2) not null default 0,
  add column if not exists sale_price numeric(12, 2) not null default 0;

alter table public.expiring_discount_rules
  drop constraint if exists expiring_discount_rules_discount_type_check;

alter table public.expiring_discount_rules
  add constraint expiring_discount_rules_discount_type_check
  check (discount_type in ('percent', 'fixed_price', 'half_cost_price'));
