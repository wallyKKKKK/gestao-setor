alter table public.pricing_branches
add column if not exists logistics_group text not null default '';

create index if not exists pricing_branches_logistics_group_idx
on public.pricing_branches (logistics_group);
