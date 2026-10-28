alter table public.personal_notes add column task_id bigint references public.tasks(id) on delete set null;
create index personal_notes_task_idx on public.personal_notes(task_id) where task_id is not null;

create function public.create_task_from_note(note_id uuid, task_input jsonb)
returns text language plpgsql security invoker set search_path = '' as $$
declare linked_id bigint; new_id bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select n.task_id into linked_id from public.personal_notes n
    where n.id = note_id and n.user_id = auth.uid() for update;
  if not found then raise exception 'Note not found' using errcode = '42501'; end if;
  if linked_id is not null then return linked_id::text; end if;
  if nullif(btrim(task_input->>'title'), '') is null then raise exception 'Title required'; end if;
  insert into public.tasks(title, assigned_to, category, notes, repeat_days, repeat_interval, subtasks, due_date, sector, is_one_off, priority)
  values (
    upper(task_input->>'title'), (task_input->>'assignedTo')::uuid,
    coalesce(task_input->>'category', 'Geral'), coalesce(task_input->>'notes', ''),
    coalesce(task_input->>'repeatDays', ''), greatest(coalesce((task_input->>'repeatInterval')::integer, 1), 1),
    coalesce(task_input->'subtasks', '[]'::jsonb), nullif(task_input->>'dueDate', '')::date,
    coalesce(task_input->>'sector', 'Geral'), coalesce((task_input->>'isOneOff')::boolean, false),
    coalesce(task_input->>'priority', 'normal')
  ) returning id into new_id;
  update public.personal_notes set task_id = new_id where id = note_id and user_id = auth.uid();
  return new_id::text;
end;
$$;
revoke all on function public.create_task_from_note(uuid, jsonb) from public, anon;
grant execute on function public.create_task_from_note(uuid, jsonb) to authenticated;
