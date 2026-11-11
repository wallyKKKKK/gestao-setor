begin;

alter table public.purchase_quotation_rounds
  add column draft jsonb,
  add column draft_version integer not null default 0,
  add column published_at timestamptz,
  add column deleted_at timestamptz,
  add constraint quotation_workspace_draft_size check (octet_length(draft::text) <= 20000000);

update public.purchase_quotation_rounds set published_at = created_at;

insert into public.purchase_quotation_rounds
  (user_id, draft_revision, title, buyer_items, supplier_items, draft)
select user_id, revision, left(coalesce(draft #>> '{request,name}', draft #>> '{costs,name}', 'Nova cotação'), 200),
  '[]', '[]', draft
from public.purchase_quotation_drafts
where draft ?| array['request', 'costs']
on conflict (user_id, draft_revision) do nothing;

-- Keep legacy deployments that insert a fully prepared round compatible.
alter table public.purchase_quotation_rounds alter column published_at set default now();

create index purchase_quotation_rounds_visible_owner_idx
  on public.purchase_quotation_rounds (user_id, draft_revision desc)
  where deleted_at is null;

create function public.limit_purchase_quotation_workspaces() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 75023));
  if (select count(*) from public.purchase_quotation_rounds r
      where r.user_id = new.user_id and r.deleted_at is null and not exists (
        select 1 from public.purchase_quotation_settlements s
        where s.round_id = r.id and s.closed_at is not null
      )) >= 5 then
    raise exception 'Quotation workspace limit reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger limit_purchase_quotation_workspaces before insert
  on public.purchase_quotation_rounds for each row execute function public.limit_purchase_quotation_workspaces();

create function public.create_purchase_quotation_workspace(p_user_id uuid) returns uuid
language plpgsql set search_path = '' as $$
declare workspace_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 75023));
  insert into public.purchase_quotation_rounds
    (user_id, draft_revision, title, buyer_items, supplier_items, draft, published_at)
  select p_user_id, coalesce(max(draft_revision), 0) + 1, 'Nova cotação', '[]', '[]',
    '{"links":{},"chosenCosts":{}}', null
  from public.purchase_quotation_rounds where user_id = p_user_id
  returning id into workspace_id;
  return workspace_id;
end;
$$;

create function public.publish_purchase_quotation_workspace(
  p_id uuid, p_owner uuid, p_version integer, p_buyer_items jsonb, p_supplier_items jsonb,
  p_invite jsonb
) returns boolean
language plpgsql set search_path = '' as $$
begin
  update public.purchase_quotation_rounds
    set published_at = now(), buyer_items = p_buyer_items, supplier_items = p_supplier_items, draft = null
    where id = p_id and user_id = p_owner and draft_version = p_version
      and deleted_at is null and published_at is null;
  if not found then return false; end if;

  insert into public.purchase_quotation_invites
    (round_id, user_id, supplier_id, supplier_name, minimum_order, default_payment_days, token_hash, expires_at)
  select p_id, p_owner, i.supplier_id, i.supplier_name, i.minimum_order, i.default_payment_days, i.token_hash, i.expires_at
  from pg_catalog.jsonb_to_record(p_invite) as i(
    supplier_id uuid, supplier_name text, minimum_order numeric, default_payment_days integer,
    token_hash text, expires_at timestamptz
  );
  return true;
end;
$$;

create function public.guard_active_purchase_quotation() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform 1 from public.purchase_quotation_rounds
    where id = new.round_id and user_id = new.user_id
      and deleted_at is null and published_at is not null for update;
  if not found then
    raise exception 'Quotation unavailable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger guard_active_purchase_quotation before insert or update
  on public.purchase_quotation_invites for each row execute function public.guard_active_purchase_quotation();
create trigger guard_active_purchase_quotation before insert or update
  on public.purchase_quotation_settlements for each row execute function public.guard_active_purchase_quotation();

-- Drafts can be large, so keep their transfer on the Data API rather than the web host.
create function public.read_purchase_quotation_workspace(p_id uuid)
returns table(draft jsonb, draft_version integer)
language sql stable security definer set search_path = '' as $$
  select r.draft, r.draft_version from public.purchase_quotation_rounds r
  join public.profiles p on p.id = r.user_id
  where r.id = p_id and r.user_id = (select auth.uid()) and r.deleted_at is null
    and r.published_at is null and p.is_active = true and p.account_status = 'approved'
    and (p.role = 'admin' or lower(trim(p.sector)) like 'compras%');
$$;

create function public.save_purchase_quotation_workspace(p_id uuid, p_version integer, p_draft jsonb)
returns integer
language sql security definer set search_path = '' as $$
  update public.purchase_quotation_rounds r
    set draft = p_draft, draft_version = r.draft_version + 1,
      title = left(coalesce(p_draft #>> '{request,name}', p_draft #>> '{costs,name}', 'Nova cotação'), 200)
  from public.profiles p
  where r.id = p_id and r.user_id = (select auth.uid()) and r.draft_version = p_version
    and r.deleted_at is null and r.published_at is null and p.id = r.user_id
    and p.is_active = true and p.account_status = 'approved'
    and (p.role = 'admin' or lower(trim(p.sector)) like 'compras%')
    and jsonb_typeof(p_draft -> 'links') = 'object' and jsonb_typeof(p_draft -> 'chosenCosts') = 'object'
    and (not (p_draft ? 'request') or (
      jsonb_typeof(p_draft #> '{request,name}') = 'string' and jsonb_typeof(p_draft #> '{request,rows}') = 'array'
    ))
    and (not (p_draft ? 'costs') or (
      jsonb_typeof(p_draft #> '{costs,name}') = 'string' and jsonb_typeof(p_draft #> '{costs,rows}') = 'array'
      and jsonb_typeof(p_draft #> '{costs,issues}') = 'array' and jsonb_typeof(p_draft #> '{costs,transfers}') = 'number'
    ))
  returning r.draft_version;
$$;

revoke all on function public.read_purchase_quotation_workspace(uuid),
  public.save_purchase_quotation_workspace(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.read_purchase_quotation_workspace(uuid),
  public.save_purchase_quotation_workspace(uuid, integer, jsonb) to authenticated;

revoke all on function public.limit_purchase_quotation_workspaces(),
  public.guard_active_purchase_quotation(), public.create_purchase_quotation_workspace(uuid),
  public.publish_purchase_quotation_workspace(uuid, uuid, integer, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.limit_purchase_quotation_workspaces(),
  public.guard_active_purchase_quotation(), public.create_purchase_quotation_workspace(uuid),
  public.publish_purchase_quotation_workspace(uuid, uuid, integer, jsonb, jsonb, jsonb)
  to service_role;

commit;
