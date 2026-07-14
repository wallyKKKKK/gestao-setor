alter table public.pricing_branches enable row level security;

drop policy if exists "Pricing team can read branches" on public.pricing_branches;
drop policy if exists "Approved users can read branches" on public.pricing_branches;
drop policy if exists "Authenticated users can read branches" on public.pricing_branches;

create policy "Authenticated users can read branches"
on public.pricing_branches
for select
to authenticated
using (true);
