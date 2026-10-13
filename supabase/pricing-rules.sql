create table if not exists public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  scope text not null default 'all',
  scope_value text not null default '',
  target_markup numeric(8, 2) not null default 0,
  min_markup numeric(8, 2) not null default 0,
  competitor_buffer numeric(8, 2) not null default 0,
  basis text not null default 'cost',
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pricing_rules_scope_check check (scope in ('all', 'brand', 'line', 'department', 'category', 'quote_group')),
  constraint pricing_rules_basis_check check (basis in ('cost', 'lowest_competitor', 'average_competitor'))
);

create index if not exists pricing_rules_scope_idx on public.pricing_rules(scope, scope_value);
create index if not exists pricing_rules_active_idx on public.pricing_rules(is_active);
create index if not exists pricing_rules_created_at_idx on public.pricing_rules(created_at desc);

create or replace function public.set_pricing_rules_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pricing_rules_updated_at on public.pricing_rules;
create trigger pricing_rules_updated_at
before update on public.pricing_rules
for each row execute function public.set_pricing_rules_updated_at();

alter table public.pricing_rules enable row level security;

drop policy if exists "Pricing team can read pricing rules" on public.pricing_rules;
create policy "Pricing team can read pricing rules"
on public.pricing_rules
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
        or lower(profiles.sector) = 'price'
        or lower(profiles.sector) like '%precifica%'
      )
  )
);

drop policy if exists "Pricing team can manage pricing rules" on public.pricing_rules;
create policy "Pricing team can manage pricing rules"
on public.pricing_rules
for all
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
        or lower(profiles.sector) like '%precifica%'
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
        or lower(profiles.sector) like '%precifica%'
      )
  )
);
