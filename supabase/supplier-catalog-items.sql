create extension if not exists pg_trgm;

create table if not exists public.supplier_catalog_items (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null,
  source_system text not null default '',
  source_file text not null default '',
  row_key text not null,
  ean text not null default '',
  supplier_sku text not null default '',
  description text not null,
  manufacturer text not null default '',
  category text not null default '',
  delivery_type text not null default '',
  available_stock numeric(14, 3) not null default 0,
  price_nf numeric(14, 4) not null default 0,
  list_price numeric(14, 4) not null default 0,
  discount_percent numeric(8, 3) not null default 0,
  st_value numeric(14, 4) not null default 0,
  minimum_quantity numeric(14, 3) not null default 0,
  offer_type text not null default '',
  offer_valid_until date,
  is_active boolean not null default true,
  imported_by uuid references public.profiles(id),
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_catalog_items_supplier_row_key unique (supplier_name, row_key)
);

create index if not exists supplier_catalog_items_supplier_idx
on public.supplier_catalog_items (supplier_name);

create index if not exists supplier_catalog_items_ean_idx
on public.supplier_catalog_items (ean);

create index if not exists supplier_catalog_items_sku_idx
on public.supplier_catalog_items (supplier_sku);

create index if not exists supplier_catalog_items_active_idx
on public.supplier_catalog_items (is_active);

create index if not exists supplier_catalog_items_imported_at_idx
on public.supplier_catalog_items (imported_at desc);

create index if not exists supplier_catalog_items_description_trgm_idx
on public.supplier_catalog_items using gin (description gin_trgm_ops);

create index if not exists supplier_catalog_items_supplier_name_trgm_idx
on public.supplier_catalog_items using gin (supplier_name gin_trgm_ops);

create index if not exists supplier_catalog_items_ean_trgm_idx
on public.supplier_catalog_items using gin (ean gin_trgm_ops);

create index if not exists supplier_catalog_items_sku_trgm_idx
on public.supplier_catalog_items using gin (supplier_sku gin_trgm_ops);

create index if not exists supplier_catalog_items_manufacturer_trgm_idx
on public.supplier_catalog_items using gin (manufacturer gin_trgm_ops);

create index if not exists supplier_catalog_items_category_trgm_idx
on public.supplier_catalog_items using gin (category gin_trgm_ops);

create or replace function public.set_supplier_catalog_items_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists supplier_catalog_items_updated_at on public.supplier_catalog_items;
create trigger supplier_catalog_items_updated_at
before update on public.supplier_catalog_items
for each row execute function public.set_supplier_catalog_items_updated_at();

alter table public.supplier_catalog_items enable row level security;

drop policy if exists "Purchasing team can read supplier catalog" on public.supplier_catalog_items;
create policy "Purchasing team can read supplier catalog"
on public.supplier_catalog_items
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (
        profiles.role = 'admin'
        or lower(profiles.sector) like 'compras%'
      )
  )
);

drop policy if exists "Purchasing team can insert supplier catalog" on public.supplier_catalog_items;
create policy "Purchasing team can insert supplier catalog"
on public.supplier_catalog_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (
        profiles.role = 'admin'
        or lower(profiles.sector) like 'compras%'
      )
  )
);

drop policy if exists "Purchasing team can update supplier catalog" on public.supplier_catalog_items;
create policy "Purchasing team can update supplier catalog"
on public.supplier_catalog_items
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (
        profiles.role = 'admin'
        or lower(profiles.sector) like 'compras%'
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (
        profiles.role = 'admin'
        or lower(profiles.sector) like 'compras%'
      )
  )
);

drop policy if exists "Purchasing team can delete supplier catalog" on public.supplier_catalog_items;
create policy "Purchasing team can delete supplier catalog"
on public.supplier_catalog_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_active = true
      and profiles.account_status = 'approved'
      and (
        profiles.role = 'admin'
        or lower(profiles.sector) like 'compras%'
      )
  )
);
