alter table public.reallocation_stock_snapshots add column if not exists superseded_at timestamptz;
create index if not exists reallocation_stock_snapshots_retired_idx
  on public.reallocation_stock_snapshots(sector,superseded_at)
  where not is_ready and superseded_at is not null;

create or replace function public.publish_reallocation_stock_snapshot(
  p_snapshot_id uuid, p_sector text, p_expected_rows integer
) returns bigint
language plpgsql security invoker set search_path = '' set statement_timeout = '30s'
as $$
declare
  v_ready boolean;
  v_retired timestamptz;
  v_count bigint;
  v_replaced bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('reallocation-stock:' || p_sector, 0));
  select is_ready,superseded_at into v_ready,v_retired from public.reallocation_stock_snapshots
    where id = p_snapshot_id and sector = p_sector for update;
  if not found then raise exception 'Base de estoque nao encontrada no setor'; end if;
  if v_ready then return 0; end if;
  if v_retired is not null then raise exception 'Esta importacao ja foi substituida ou cancelada'; end if;
  select count(*) into v_count from public.reallocation_stock_items where snapshot_id = p_snapshot_id;
  if p_expected_rows is null or p_expected_rows <= 0 or v_count <> p_expected_rows then
    raise exception 'Importacao incompleta: esperado %, encontrado %', p_expected_rows, v_count;
  end if;
  select count(*) into v_replaced from public.reallocation_stock_items i
    join public.reallocation_stock_snapshots s on s.id=i.snapshot_id
    where s.sector=p_sector and s.is_ready and s.id<>p_snapshot_id;
  -- Switch visibility atomically; expensive deletion happens separately in small batches.
  update public.reallocation_stock_snapshots set is_ready=false,superseded_at=clock_timestamp()
    where sector=p_sector and is_ready and id<>p_snapshot_id;
  update public.reallocation_stock_snapshots set is_ready=true,imported_at=clock_timestamp(),
    notes='Base integral do setor ' || p_sector where id=p_snapshot_id;
  return v_replaced;
end;
$$;
revoke all on function public.publish_reallocation_stock_snapshot(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.publish_reallocation_stock_snapshot(uuid,text,integer) to service_role;

create or replace function public.cleanup_reallocation_stock_snapshots(p_sector text, p_batch_size integer default 2000)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_id uuid;
  v_deleted integer;
begin
  select id into v_id from public.reallocation_stock_snapshots
    where sector=p_sector and not is_ready and superseded_at is not null
    order by superseded_at,id limit 1 for update skip locked;
  if not found then return jsonb_build_object('deleted_rows',0,'pending',false); end if;
  delete from public.reallocation_stock_items where id in (
    select id from public.reallocation_stock_items where snapshot_id=v_id
    order by id limit greatest(1,least(coalesce(p_batch_size,2000),5000))
  );
  get diagnostics v_deleted = row_count;
  if not exists(select 1 from public.reallocation_stock_items where snapshot_id=v_id) then
    delete from public.reallocation_stock_snapshots where id=v_id and not is_ready and superseded_at is not null;
  end if;
  return jsonb_build_object('deleted_rows',v_deleted,'pending',exists(
    select 1 from public.reallocation_stock_snapshots where sector=p_sector and not is_ready and superseded_at is not null
  ));
end;
$$;
revoke all on function public.cleanup_reallocation_stock_snapshots(text,integer) from public, anon, authenticated;
grant execute on function public.cleanup_reallocation_stock_snapshots(text,integer) to service_role;
notify pgrst, 'reload schema';
