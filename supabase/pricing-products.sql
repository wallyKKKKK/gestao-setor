create extension if not exists pg_trgm;

create table if not exists public.pricing_products (
  id uuid primary key default gen_random_uuid(),
  ean text not null unique,
  description text not null,
  brand text not null default '',
  purchase_price numeric(12, 2) not null default 0,
  sell_in_value numeric(12, 2) not null default 0,
  sell_in_mode text not null default 'currency',
  sell_out_value numeric(12, 2) not null default 0,
  sell_out_mode text not null default 'currency',
  trade_value numeric(12, 2) not null default 0,
  trade_mode text not null default 'percent',
  sale_price numeric(12, 2) not null default 0,
  baby_wednesday_price numeric(12, 2) not null default 0,
  month_end_price numeric(12, 2) not null default 0,
  competitor_prices jsonb not null default '{}'::jsonb,
  store_prices jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pricing_products_sell_in_mode_check check (sell_in_mode in ('currency', 'percent')),
  constraint pricing_products_sell_out_mode_check check (sell_out_mode in ('currency', 'percent')),
  constraint pricing_products_trade_mode_check check (trade_mode in ('currency', 'percent'))
);

alter table public.pricing_products
add column if not exists is_active boolean not null default true;

create index if not exists pricing_products_description_idx
on public.pricing_products (description);

create index if not exists pricing_products_brand_idx
on public.pricing_products (brand);

create index if not exists pricing_products_is_active_idx
on public.pricing_products (is_active);

create index if not exists pricing_products_description_trgm_idx
on public.pricing_products using gin (description gin_trgm_ops);

create index if not exists pricing_products_brand_trgm_idx
on public.pricing_products using gin (brand gin_trgm_ops);

create index if not exists pricing_products_ean_trgm_idx
on public.pricing_products using gin (ean gin_trgm_ops);

create or replace function public.set_pricing_products_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pricing_products_updated_at on public.pricing_products;
create trigger pricing_products_updated_at
before update on public.pricing_products
for each row execute function public.set_pricing_products_updated_at();

alter table public.pricing_products enable row level security;

drop policy if exists "Pricing team can read products" on public.pricing_products;
create policy "Pricing team can read products"
on public.pricing_products
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
        or lower(profiles.sector) in ('precificação', 'price')
      )
  )
);

drop policy if exists "Pricing team can insert products" on public.pricing_products;
create policy "Pricing team can insert products"
on public.pricing_products
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
        or lower(profiles.sector) in ('precificação', 'price')
      )
  )
);

drop policy if exists "Pricing team can update products" on public.pricing_products;
create policy "Pricing team can update products"
on public.pricing_products
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
        or lower(profiles.sector) in ('precificação', 'price')
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
        or lower(profiles.sector) in ('precificação', 'price')
      )
  )
);

drop policy if exists "Pricing team can delete products" on public.pricing_products;
create policy "Pricing team can delete products"
on public.pricing_products
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
        or lower(profiles.sector) in ('precificação', 'price')
      )
  )
);
