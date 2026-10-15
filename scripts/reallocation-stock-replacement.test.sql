begin;
do $$
declare
  v_sector text := 'test-replacement-' || gen_random_uuid();
  v_other text := 'test-other-' || gen_random_uuid();
  v_old uuid;
  v_new uuid;
  v_pending uuid;
  v_other_id uuid;
  v_replaced bigint;
begin
  insert into public.reallocation_stock_snapshots(sector,is_ready) values(v_sector,true) returning id into v_old;
  insert into public.reallocation_stock_snapshots(sector,is_ready) values(v_sector,false) returning id into v_new;
  insert into public.reallocation_stock_snapshots(sector,is_ready) values(v_sector,false) returning id into v_pending;
  insert into public.reallocation_stock_snapshots(sector,is_ready) values(v_other,true) returning id into v_other_id;
  insert into public.reallocation_stock_items(snapshot_id,store_code,store_name,ean,product_description)
    values(v_old,'01','Test','111','Old'),(v_old,'02','Test','222','Missing in new file'),
          (v_new,'01','Test','333','New'),(v_other_id,'01','Test','444','Other sector');
  -- An incomplete upload must leave the old base unchanged.
  begin
    perform public.publish_reallocation_stock_snapshot(v_new,v_sector,2);
    raise exception 'Expected incomplete upload rejection';
  exception when others then
    if sqlerrm not like 'Importacao incompleta:%' then raise; end if;
  end;
  if not exists(select 1 from public.reallocation_stock_snapshots where id=v_old and is_ready)
    or exists(select 1 from public.reallocation_stock_snapshots where id=v_new and is_ready) then
    raise exception 'Incomplete upload changed the active base';
  end if;
  v_replaced := public.publish_reallocation_stock_snapshot(v_new,v_sector,1);
  if v_replaced <> 2 then raise exception 'Expected two removed rows'; end if;
  if exists(select 1 from public.reallocation_stock_snapshots where id=v_old and is_ready)
    or not exists(select 1 from public.reallocation_stock_snapshots where id=v_old and superseded_at is not null) then
    raise exception 'Old inventory is still active';
  end if;
  if not exists(select 1 from public.reallocation_stock_snapshots where id=v_new and is_ready)
    or not exists(select 1 from public.reallocation_stock_items where snapshot_id=v_new and ean='333') then
    raise exception 'New inventory was not activated';
  end if;
  if not exists(select 1 from public.reallocation_stock_snapshots where id=v_pending and not is_ready)
    or not exists(select 1 from public.reallocation_stock_items where snapshot_id=v_other_id) then
    raise exception 'Other sector or concurrent upload was changed';
  end if;
  if public.publish_reallocation_stock_snapshot(v_new,v_sector,1) <> 0 then
    raise exception 'Publication retry was not idempotent';
  end if;
  while (public.cleanup_reallocation_stock_snapshots(v_sector,1)->>'pending')::boolean loop
    null;
  end loop;
  if exists(select 1 from public.reallocation_stock_snapshots where id=v_old)
    or exists(select 1 from public.reallocation_stock_items where snapshot_id=v_old) then
    raise exception 'Old inventory cleanup did not finish';
  end if;
  if not exists(select 1 from public.reallocation_stock_snapshots where id=v_pending and superseded_at is null)
    or not exists(select 1 from public.reallocation_stock_snapshots where id=v_new and is_ready) then
    raise exception 'Cleanup touched a pending or active import';
  end if;
  if has_function_privilege('authenticated','public.publish_reallocation_stock_snapshot(uuid,text,integer)','EXECUTE')
    or has_function_privilege('anon','public.publish_reallocation_stock_snapshot(uuid,text,integer)','EXECUTE')
    or not has_function_privilege('service_role','public.publish_reallocation_stock_snapshot(uuid,text,integer)','EXECUTE') then
    raise exception 'Publication permissions are incorrect';
  end if;
end $$;
select 'replacement, failure rollback, sector isolation, concurrent staging, retry and permissions passed' as result;
rollback;
