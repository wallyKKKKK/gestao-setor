create extension if not exists pg_trgm;

create table if not exists public.reallocation_stock_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_file text,
  sector text not null default 'Geral',
  imported_by uuid references auth.users(id),
  imported_at timestamptz not null default now(),
  notes text
);

create table if not exists public.reallocation_stock_items (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.reallocation_stock_snapshots(id) on delete cascade,
  store_code text not null,
  store_name text not null,
  ean text not null,
  erp_code text,
  product_description text not null,
  stock numeric not null default 0,
  confirmed_stock numeric not null default 0,
  monthly_avg_sales numeric not null default 0,
  stock_days numeric not null default 0,
  curve text,
  confirmed_purchase numeric not null default 0,
  confirmed_transfer numeric not null default 0,
  last_sale_days numeric not null default 0,
  last_purchase_days numeric not null default 0,
  last_purchase_supplier text,
  need_type text,
  rupture_sales numeric not null default 0,
  supplied_percent numeric not null default 0,
  min_stock numeric not null default 0,
  max_stock numeric not null default 0,
  need_cost numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table public.reallocation_stock_items
add column if not exists last_sale_days numeric not null default 0;

alter table public.reallocation_stock_items
add column if not exists last_purchase_days numeric not null default 0;

alter table public.reallocation_stock_items
add column if not exists last_purchase_supplier text;

alter table public.reallocation_stock_items
add column if not exists need_type text;

alter table public.reallocation_stock_items
add column if not exists rupture_sales numeric not null default 0;

alter table public.reallocation_stock_items
add column if not exists supplied_percent numeric not null default 0;

alter table public.reallocation_stock_items
add column if not exists min_stock numeric not null default 0;

alter table public.reallocation_stock_items
add column if not exists max_stock numeric not null default 0;

alter table public.reallocation_stock_items
add column if not exists need_cost numeric not null default 0;

alter table public.reallocation_stock_snapshots
add column if not exists sector text not null default 'Geral';

update public.reallocation_stock_snapshots
set sector = 'Geral'
where sector is null or btrim(sector) = '';

create index if not exists reallocation_stock_snapshots_sector_imported_idx
on public.reallocation_stock_snapshots (sector, imported_at desc);

create index if not exists reallocation_stock_items_snapshot_idx
on public.reallocation_stock_items (snapshot_id);

create index if not exists reallocation_stock_items_store_idx
on public.reallocation_stock_items (store_code);

create index if not exists reallocation_stock_items_ean_idx
on public.reallocation_stock_items (ean);

create index if not exists reallocation_stock_items_erp_idx
on public.reallocation_stock_items (erp_code);

create index if not exists reallocation_stock_items_last_sale_days_idx
on public.reallocation_stock_items (last_sale_days);

create index if not exists reallocation_stock_items_last_purchase_days_idx
on public.reallocation_stock_items (last_purchase_days);

create index if not exists reallocation_stock_items_need_type_idx
on public.reallocation_stock_items (need_type);

create index if not exists reallocation_stock_items_last_purchase_supplier_idx
on public.reallocation_stock_items (last_purchase_supplier);

create index if not exists reallocation_stock_items_rupture_sales_idx
on public.reallocation_stock_items (rupture_sales);

create index if not exists reallocation_stock_items_supplied_percent_idx
on public.reallocation_stock_items (supplied_percent);

create index if not exists reallocation_stock_items_snapshot_store_idx
on public.reallocation_stock_items (snapshot_id, store_code);

create index if not exists reallocation_stock_items_snapshot_ean_idx
on public.reallocation_stock_items (snapshot_id, ean);

create index if not exists reallocation_stock_items_snapshot_erp_idx
on public.reallocation_stock_items (snapshot_id, erp_code);

create index if not exists reallocation_stock_items_snapshot_need_type_idx
on public.reallocation_stock_items (snapshot_id, need_type);

create index if not exists reallocation_stock_items_store_code_trgm_idx
on public.reallocation_stock_items using gin (store_code gin_trgm_ops);

create index if not exists reallocation_stock_items_store_name_trgm_idx
on public.reallocation_stock_items using gin (store_name gin_trgm_ops);

create index if not exists reallocation_stock_items_ean_trgm_idx
on public.reallocation_stock_items using gin (ean gin_trgm_ops);

create index if not exists reallocation_stock_items_erp_code_trgm_idx
on public.reallocation_stock_items using gin (erp_code gin_trgm_ops);

create index if not exists reallocation_stock_items_product_description_trgm_idx
on public.reallocation_stock_items using gin (product_description gin_trgm_ops);

create index if not exists reallocation_stock_items_curve_trgm_idx
on public.reallocation_stock_items using gin (curve gin_trgm_ops);

alter table public.reallocation_stock_snapshots enable row level security;
alter table public.reallocation_stock_items enable row level security;

drop policy if exists "reallocation_stock_snapshots_select" on public.reallocation_stock_snapshots;
create policy "reallocation_stock_snapshots_select"
on public.reallocation_stock_snapshots
for select to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (
        profiles.role = 'admin'
        or reallocation_stock_snapshots.sector = profiles.sector
        or reallocation_stock_snapshots.sector = 'Geral'
      )
  )
);

drop policy if exists "reallocation_stock_items_select" on public.reallocation_stock_items;
create policy "reallocation_stock_items_select"
on public.reallocation_stock_items
for select to authenticated
using (
  exists (
    select 1
    from public.reallocation_stock_snapshots snapshots
    join public.profiles profiles on profiles.id = auth.uid()
    where snapshots.id = reallocation_stock_items.snapshot_id
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (
        profiles.role = 'admin'
        or snapshots.sector = profiles.sector
        or snapshots.sector = 'Geral'
      )
  )
);

drop policy if exists "reallocation_stock_snapshots_admin_all" on public.reallocation_stock_snapshots;
create policy "reallocation_stock_snapshots_admin_all"
on public.reallocation_stock_snapshots
for all to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

drop policy if exists "reallocation_stock_items_admin_all" on public.reallocation_stock_items;
create policy "reallocation_stock_items_admin_all"
on public.reallocation_stock_items
for all to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);
