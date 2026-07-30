create table if not exists public.expiring_inventory_items (
  id uuid primary key default gen_random_uuid(),
  row_key text not null unique,
  branch_code text not null default '',
  branch_name text not null default '',
  item_status text not null default '',
  description text not null default '',
  ean text not null default '',
  lot text not null default '',
  initial_quantity numeric(14, 3) not null default 0,
  moved_quantity numeric(14, 3) not null default 0,
  balance_quantity numeric(14, 3) not null default 0,
  current_stock numeric(14, 3) not null default 0,
  days_to_expire integer not null default 0,
  manufacture_date date,
  expiration_date date,
  manufacturer text not null default '',
  classification_path text not null default '',
  line text not null default '',
  department text not null default '',
  category text not null default '',
  abc_quantity text not null default '',
  abc_value text not null default '',
  imported_user text not null default '',
  included_at timestamptz,
  monthly_average numeric(14, 3) not null default 0,
  purchase_demand_30d numeric(14, 3) not null default 0,
  source_file text,
  imported_by uuid references auth.users(id) on delete set null,
  imported_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expiring_discount_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  scope_type text not null default 'category',
  scope_value text not null default '',
  discount_type text not null default 'percent',
  discount_value numeric(12, 2) not null default 0,
  min_days_to_expire integer not null default 0,
  max_days_to_expire integer not null default 99999,
  priority integer not null default 100,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expiring_discount_rules_scope_type_check check (scope_type in ('product', 'manufacturer', 'line', 'department', 'category', 'classification', 'validity')),
  constraint expiring_discount_rules_discount_type_check check (discount_type in ('percent', 'fixed_price'))
);

create index if not exists expiring_inventory_items_branch_idx on public.expiring_inventory_items(branch_code);
create index if not exists expiring_inventory_items_ean_idx on public.expiring_inventory_items(ean);
create index if not exists expiring_inventory_items_manufacturer_idx on public.expiring_inventory_items(manufacturer);
create index if not exists expiring_inventory_items_classification_idx on public.expiring_inventory_items(classification_path);
create index if not exists expiring_inventory_items_days_idx on public.expiring_inventory_items(days_to_expire);
create index if not exists expiring_inventory_items_active_idx on public.expiring_inventory_items(is_active);
create index if not exists expiring_discount_rules_scope_idx on public.expiring_discount_rules(scope_type, scope_value);
create index if not exists expiring_discount_rules_active_idx on public.expiring_discount_rules(is_active);

create or replace function public.set_expiring_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists expiring_inventory_items_updated_at on public.expiring_inventory_items;
create trigger expiring_inventory_items_updated_at
before update on public.expiring_inventory_items
for each row execute function public.set_expiring_updated_at();

drop trigger if exists expiring_discount_rules_updated_at on public.expiring_discount_rules;
create trigger expiring_discount_rules_updated_at
before update on public.expiring_discount_rules
for each row execute function public.set_expiring_updated_at();

alter table public.expiring_inventory_items enable row level security;
alter table public.expiring_discount_rules enable row level security;

drop policy if exists "Pricing team can read expiring inventory" on public.expiring_inventory_items;
create policy "Pricing team can read expiring inventory"
on public.expiring_inventory_items
for select
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (profiles.role = 'admin' or lower(profiles.sector) in ('precificação', 'precificacao', 'price'))
  )
);

drop policy if exists "Pricing team can manage expiring inventory" on public.expiring_inventory_items;
create policy "Pricing team can manage expiring inventory"
on public.expiring_inventory_items
for all
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (profiles.role = 'admin' or lower(profiles.sector) in ('precificação', 'precificacao', 'price'))
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (profiles.role = 'admin' or lower(profiles.sector) in ('precificação', 'precificacao', 'price'))
  )
);

drop policy if exists "Pricing team can read expiring rules" on public.expiring_discount_rules;
create policy "Pricing team can read expiring rules"
on public.expiring_discount_rules
for select
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (profiles.role = 'admin' or lower(profiles.sector) in ('precificação', 'precificacao', 'price'))
  )
);

drop policy if exists "Pricing team can manage expiring rules" on public.expiring_discount_rules;
create policy "Pricing team can manage expiring rules"
on public.expiring_discount_rules
for all
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (profiles.role = 'admin' or lower(profiles.sector) in ('precificação', 'precificacao', 'price'))
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (profiles.role = 'admin' or lower(profiles.sector) in ('precificação', 'precificacao', 'price'))
  )
);