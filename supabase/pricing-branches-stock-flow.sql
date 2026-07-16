alter table public.pricing_branches
add column if not exists sends_stock boolean not null default true;

alter table public.pricing_branches
add column if not exists receives_stock boolean not null default true;

update public.pricing_branches
set
  sends_stock = coalesce(sends_stock, true),
  receives_stock = coalesce(receives_stock, true);