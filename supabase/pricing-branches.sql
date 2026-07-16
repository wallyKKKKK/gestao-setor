create table if not exists public.pricing_branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  city text not null default '',
  legal_name text not null default '',
  uf text not null default '',
  cnpj text not null default '',
  logistics_group text not null default '',
  sends_stock boolean not null default true,
  receives_stock boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pricing_branches
add column if not exists legal_name text not null default '';

alter table public.pricing_branches
add column if not exists uf text not null default '';

alter table public.pricing_branches
add column if not exists cnpj text not null default '';

alter table public.pricing_branches
add column if not exists logistics_group text not null default '';

alter table public.pricing_branches
add column if not exists sends_stock boolean not null default true;

alter table public.pricing_branches
add column if not exists receives_stock boolean not null default true;

create index if not exists pricing_branches_name_idx
on public.pricing_branches (name);

create index if not exists pricing_branches_logistics_group_idx
on public.pricing_branches (logistics_group);

create or replace function public.set_pricing_branches_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pricing_branches_updated_at on public.pricing_branches;
create trigger pricing_branches_updated_at
before update on public.pricing_branches
for each row execute function public.set_pricing_branches_updated_at();

alter table public.pricing_branches enable row level security;

drop policy if exists "Pricing team can read branches" on public.pricing_branches;
drop policy if exists "Approved users can read branches" on public.pricing_branches;
drop policy if exists "Authenticated users can read branches" on public.pricing_branches;
create policy "Authenticated users can read branches"
on public.pricing_branches
for select
to authenticated
using (true);

drop policy if exists "Pricing team can insert branches" on public.pricing_branches;
create policy "Pricing team can insert branches"
on public.pricing_branches
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
        or lower(profiles.sector) = 'price'
        or lower(profiles.sector) like 'precifica%'
      )
  )
);

drop policy if exists "Pricing team can update branches" on public.pricing_branches;
create policy "Pricing team can update branches"
on public.pricing_branches
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
        or lower(profiles.sector) = 'price'
        or lower(profiles.sector) like 'precifica%'
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
        or lower(profiles.sector) = 'price'
        or lower(profiles.sector) like 'precifica%'
      )
  )
);

drop policy if exists "Pricing team can delete branches" on public.pricing_branches;
create policy "Pricing team can delete branches"
on public.pricing_branches
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
        or lower(profiles.sector) = 'price'
        or lower(profiles.sector) like 'precifica%'
      )
  )
);
