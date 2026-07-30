-- ERP inventory core foundation.
-- This file creates neutral stock tables that can serve reallocation, purchases, price, pre-expiring products and future POS.
-- It does not replace current module tables yet.

create extension if not exists pg_trgm;

create table if not exists public.erp_inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  process_key text not null default gen_random_uuid()::text,
  source_module text not null default 'manual',
  source_file text,
  sector text not null default 'Geral',
  branch_scope text not null default 'multi_branch',
  status text not null default 'active',
  imported_by uuid references auth.users(id) on delete set null,
  imported_at timestamptz not null default now(),
  expires_at timestamptz,
  notes text,
  constraint erp_inventory_snapshots_status_check check (status in ('active', 'closed', 'expired', 'discarded')),
  constraint erp_inventory_snapshots_branch_scope_check check (branch_scope in ('single_branch', 'multi_branch'))
);

create table if not exists public.erp_inventory_snapshot_items (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.erp_inventory_snapshots(id) on delete cascade,
  branch_code text not null,
  branch_name text not null default '',
  ean text not null,
  erp_code text,
  product_description text not null default '',
  manufacturer text not null default '',
  classification_path text not null default '',
  line text not null default '',
  department text not null default '',
  category text not null default '',
  stock_quantity numeric(14, 3) not null default 0,
  confirmed_quantity numeric(14, 3) not null default 0,
  reserved_quantity numeric(14, 3) not null default 0,
  monthly_avg_sales numeric(14, 3) not null default 0,
  daily_avg_sales numeric(14, 3) not null default 0,
  stock_days numeric(14, 3) not null default 0,
  curve text,
  last_sale_days numeric(14, 3) not null default 0,
  last_purchase_days numeric(14, 3) not null default 0,
  last_purchase_supplier text,
  cost_price numeric(14, 4) not null default 0,
  sale_price numeric(14, 4) not null default 0,
  min_stock numeric(14, 3) not null default 0,
  max_stock numeric(14, 3) not null default 0,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.erp_inventory_current (
  id uuid primary key default gen_random_uuid(),
  branch_code text not null,
  ean text not null,
  erp_code text,
  product_description text not null default '',
  stock_quantity numeric(14, 3) not null default 0,
  reserved_quantity numeric(14, 3) not null default 0,
  available_quantity numeric(14, 3) generated always as (stock_quantity - reserved_quantity) stored,
  average_cost numeric(14, 4) not null default 0,
  sale_price numeric(14, 4) not null default 0,
  last_snapshot_id uuid references public.erp_inventory_snapshots(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint erp_inventory_current_branch_ean_key unique (branch_code, ean)
);

create table if not exists public.erp_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  movement_type text not null,
  branch_code text not null,
  ean text not null,
  erp_code text,
  quantity numeric(14, 3) not null,
  unit_cost numeric(14, 4) not null default 0,
  unit_price numeric(14, 4) not null default 0,
  source_module text not null default 'manual',
  source_process_id uuid,
  source_item_id uuid,
  related_branch_code text,
  document_number text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint erp_inventory_movements_type_check check (movement_type in ('import', 'sale', 'purchase', 'transfer_in', 'transfer_out', 'adjustment_in', 'adjustment_out', 'reservation', 'reservation_release', 'return'))
);

create index if not exists erp_inventory_snapshots_sector_imported_idx
on public.erp_inventory_snapshots (sector, imported_at desc);

create index if not exists erp_inventory_snapshots_status_idx
on public.erp_inventory_snapshots (status);

create index if not exists erp_inventory_snapshot_items_snapshot_idx
on public.erp_inventory_snapshot_items (snapshot_id);

create index if not exists erp_inventory_snapshot_items_branch_idx
on public.erp_inventory_snapshot_items (branch_code);

create index if not exists erp_inventory_snapshot_items_ean_idx
on public.erp_inventory_snapshot_items (ean);

create index if not exists erp_inventory_snapshot_items_erp_idx
on public.erp_inventory_snapshot_items (erp_code);

create index if not exists erp_inventory_snapshot_items_snapshot_branch_idx
on public.erp_inventory_snapshot_items (snapshot_id, branch_code);

create index if not exists erp_inventory_snapshot_items_snapshot_ean_idx
on public.erp_inventory_snapshot_items (snapshot_id, ean);

create index if not exists erp_inventory_snapshot_items_product_trgm_idx
on public.erp_inventory_snapshot_items using gin (product_description gin_trgm_ops);

create index if not exists erp_inventory_current_branch_idx
on public.erp_inventory_current (branch_code);

create index if not exists erp_inventory_current_ean_idx
on public.erp_inventory_current (ean);

create index if not exists erp_inventory_current_erp_idx
on public.erp_inventory_current (erp_code);

create index if not exists erp_inventory_current_product_trgm_idx
on public.erp_inventory_current using gin (product_description gin_trgm_ops);

create index if not exists erp_inventory_movements_branch_ean_created_idx
on public.erp_inventory_movements (branch_code, ean, created_at desc);

create index if not exists erp_inventory_movements_type_created_idx
on public.erp_inventory_movements (movement_type, created_at desc);

create or replace function public.set_erp_inventory_current_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists erp_inventory_current_updated_at on public.erp_inventory_current;
create trigger erp_inventory_current_updated_at
before update on public.erp_inventory_current
for each row execute function public.set_erp_inventory_current_updated_at();

alter table public.erp_inventory_snapshots enable row level security;
alter table public.erp_inventory_snapshot_items enable row level security;
alter table public.erp_inventory_current enable row level security;
alter table public.erp_inventory_movements enable row level security;

-- Approved users can read ERP inventory. Writes should go through server APIs or admin users.
drop policy if exists "Approved users can read inventory snapshots" on public.erp_inventory_snapshots;
create policy "Approved users can read inventory snapshots"
on public.erp_inventory_snapshots
for select to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
  )
);

drop policy if exists "Approved users can read inventory snapshot items" on public.erp_inventory_snapshot_items;
create policy "Approved users can read inventory snapshot items"
on public.erp_inventory_snapshot_items
for select to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
  )
);

drop policy if exists "Approved users can read current inventory" on public.erp_inventory_current;
create policy "Approved users can read current inventory"
on public.erp_inventory_current
for select to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
  )
);

drop policy if exists "Approved users can read inventory movements" on public.erp_inventory_movements;
create policy "Approved users can read inventory movements"
on public.erp_inventory_movements
for select to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
  )
);

drop policy if exists "Admins can manage inventory snapshots" on public.erp_inventory_snapshots;
create policy "Admins can manage inventory snapshots"
on public.erp_inventory_snapshots
for all to authenticated
using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'admin'))
with check (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

drop policy if exists "Admins can manage inventory snapshot items" on public.erp_inventory_snapshot_items;
create policy "Admins can manage inventory snapshot items"
on public.erp_inventory_snapshot_items
for all to authenticated
using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'admin'))
with check (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

drop policy if exists "Admins can manage current inventory" on public.erp_inventory_current;
create policy "Admins can manage current inventory"
on public.erp_inventory_current
for all to authenticated
using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'admin'))
with check (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

drop policy if exists "Admins can manage inventory movements" on public.erp_inventory_movements;
create policy "Admins can manage inventory movements"
on public.erp_inventory_movements
for all to authenticated
using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'admin'))
with check (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
