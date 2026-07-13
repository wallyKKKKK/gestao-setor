create table if not exists public.pricing_margin_rules (
  id uuid primary key default gen_random_uuid(),
  line text not null default '',
  department text not null default '',
  category text not null default '',
  classification_path text not null default '',
  desired_margin_percent numeric(8, 2) not null default 0,
  desired_markup_percent numeric(8, 2) not null default 0,
  source_file text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pricing_margin_rules_classification_path_key unique (classification_path)
);

create index if not exists pricing_margin_rules_line_idx
on public.pricing_margin_rules (line);

create index if not exists pricing_margin_rules_department_idx
on public.pricing_margin_rules (department);

create index if not exists pricing_margin_rules_category_idx
on public.pricing_margin_rules (category);

create or replace function public.set_pricing_margin_rules_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists pricing_margin_rules_updated_at on public.pricing_margin_rules;
create trigger pricing_margin_rules_updated_at
before update on public.pricing_margin_rules
for each row execute function public.set_pricing_margin_rules_updated_at();

alter table public.pricing_margin_rules enable row level security;

drop policy if exists "Pricing margin rules can be read by approved users" on public.pricing_margin_rules;
create policy "Pricing margin rules can be read by approved users"
on public.pricing_margin_rules
for select
to authenticated
using (true);

drop policy if exists "Pricing team can insert margin rules" on public.pricing_margin_rules;
create policy "Pricing team can insert margin rules"
on public.pricing_margin_rules
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and (
        profiles.role = 'admin'
        or lower(profiles.sector) = 'price'
        or lower(profiles.sector) like 'precifica%'
      )
  )
);

drop policy if exists "Pricing team can update margin rules" on public.pricing_margin_rules;
create policy "Pricing team can update margin rules"
on public.pricing_margin_rules
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
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
      and (
        profiles.role = 'admin'
        or lower(profiles.sector) = 'price'
        or lower(profiles.sector) like 'precifica%'
      )
  )
);

drop policy if exists "Pricing team can delete margin rules" on public.pricing_margin_rules;
create policy "Pricing team can delete margin rules"
on public.pricing_margin_rules
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and (
        profiles.role = 'admin'
        or lower(profiles.sector) = 'price'
        or lower(profiles.sector) like 'precifica%'
      )
  )
);
