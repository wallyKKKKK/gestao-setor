create table if not exists public.reallocation_stock_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_file text,
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
  created_at timestamptz not null default now()
);

create index if not exists reallocation_stock_items_snapshot_idx
on public.reallocation_stock_items (snapshot_id);

create index if not exists reallocation_stock_items_store_idx
on public.reallocation_stock_items (store_code);

create index if not exists reallocation_stock_items_ean_idx
on public.reallocation_stock_items (ean);

create index if not exists reallocation_stock_items_erp_idx
on public.reallocation_stock_items (erp_code);

alter table public.reallocation_stock_snapshots enable row level security;
alter table public.reallocation_stock_items enable row level security;

drop policy if exists "reallocation_stock_snapshots_select" on public.reallocation_stock_snapshots;
create policy "reallocation_stock_snapshots_select"
on public.reallocation_stock_snapshots
for select to authenticated
using (true);

drop policy if exists "reallocation_stock_items_select" on public.reallocation_stock_items;
create policy "reallocation_stock_items_select"
on public.reallocation_stock_items
for select to authenticated
using (true);

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
