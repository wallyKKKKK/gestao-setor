create extension if not exists pg_trgm;

create table if not exists public.reallocation_products (
  id uuid primary key default gen_random_uuid(),
  erp_code text not null,
  ean text not null default '',
  description text not null,
  manufacturer text not null default '',
  classification text not null default '',
  search_text text not null default '',
  source_file text,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reallocation_products_erp_ean_key unique (erp_code, ean)
);

create index if not exists reallocation_products_erp_code_idx
on public.reallocation_products (erp_code);

create index if not exists reallocation_products_ean_idx
on public.reallocation_products (ean);

alter table public.reallocation_products
add column if not exists manufacturer text not null default '';

alter table public.reallocation_products
add column if not exists classification text not null default '';

create index if not exists reallocation_products_manufacturer_idx
on public.reallocation_products (manufacturer);

create index if not exists reallocation_products_classification_idx
on public.reallocation_products (classification);

create index if not exists reallocation_products_search_trgm_idx
on public.reallocation_products using gin (search_text gin_trgm_ops);

create or replace function public.set_reallocation_products_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists reallocation_products_updated_at on public.reallocation_products;
create trigger reallocation_products_updated_at
before update on public.reallocation_products
for each row execute function public.set_reallocation_products_updated_at();

alter table public.reallocation_products enable row level security;

drop policy if exists "reallocation_products_select" on public.reallocation_products;
create policy "reallocation_products_select"
on public.reallocation_products
for select
to authenticated
using (true);

drop policy if exists "reallocation_products_admin_insert" on public.reallocation_products;
create policy "reallocation_products_admin_insert"
on public.reallocation_products
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

drop policy if exists "reallocation_products_admin_update" on public.reallocation_products;
create policy "reallocation_products_admin_update"
on public.reallocation_products
for update
to authenticated
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

drop policy if exists "reallocation_products_admin_delete" on public.reallocation_products;
create policy "reallocation_products_admin_delete"
on public.reallocation_products
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);
