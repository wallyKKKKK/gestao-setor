begin;

create table public.purchase_quotation_settlements (
  round_id uuid primary key,
  user_id uuid not null,
  revision integer not null check (revision > 0),
  decisions jsonb not null check (jsonb_typeof(decisions) = 'object'),
  orders jsonb check (jsonb_typeof(orders) = 'array'),
  closed_at timestamptz,
  submitted_suppliers uuid[] not null default '{}',
  check ((closed_at is null) = (orders is null)),
  foreign key (round_id, user_id) references public.purchase_quotation_rounds (id, user_id) on delete cascade
);

alter table public.purchase_quotation_settlements enable row level security;
revoke all on public.purchase_quotation_settlements from public, anon, authenticated;
grant select, insert, update on public.purchase_quotation_settlements to service_role;

create function public.guard_purchase_quotation_close() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform 1 from public.purchase_quotation_rounds
    where id = new.round_id and user_id = new.user_id for update;
  if tg_table_name = 'purchase_quotation_invites' then
    if exists (select 1 from public.purchase_quotation_settlements
      where round_id = new.round_id and closed_at is not null) then
      raise exception 'Quotation already closed' using errcode = '23514';
    end if;
    if new.submitted_at is not null and new.expires_at <= clock_timestamp() then
      raise exception 'Quotation invitation expired' using errcode = '23514';
    end if;
  else
    if tg_op = 'UPDATE' then
      if old.closed_at is not null then
        raise exception 'Quotation already closed' using errcode = '23514';
      end if;
    end if;
    if new.closed_at is not null and exists (
      select 1 from public.purchase_quotation_invites
      where round_id = new.round_id and revoked_at is null
        and submitted_at is null and expires_at > clock_timestamp()
    ) then
      raise exception 'Quotation has pending invitations' using errcode = '23514';
    end if;
    if new.closed_at is not null and new.submitted_suppliers <> array(
      select supplier_id from public.purchase_quotation_invites
      where round_id = new.round_id and revoked_at is null and submitted_at is not null
      order by supplier_id
    ) then
      raise exception 'Quotation responses changed' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_purchase_quotation_close() from public, anon, authenticated;
grant execute on function public.guard_purchase_quotation_close() to service_role;

create trigger guard_purchase_quotation_invite before insert or update
  on public.purchase_quotation_invites for each row execute function public.guard_purchase_quotation_close();
create trigger guard_purchase_quotation_settlement before insert or update
  on public.purchase_quotation_settlements for each row execute function public.guard_purchase_quotation_close();

commit;
