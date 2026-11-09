create table public.app_tools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 2000),
  version text not null default '' check (length(version) <= 40),
  file_name text not null check (length(file_name) between 1 and 255 and file_name ~* '\.(exe|msi|zip)$'),
  file_path text not null unique check (file_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[a-zA-Z0-9._-]+$'),
  file_size bigint not null check (file_size between 1 and 52428800),
  is_active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index app_tools_created_by_idx on public.app_tools (created_by);
alter table public.app_tools enable row level security;
revoke all on public.app_tools from anon, authenticated;
grant select, insert on public.app_tools to authenticated;
grant update (name, description, version, file_name, file_path, file_size, is_active, updated_at) on public.app_tools to authenticated;

create policy tools_read on public.app_tools for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid())
    and p.is_active and p.account_status = 'approved' and (app_tools.is_active or p.role = 'admin'))
);
create policy tools_insert_admin on public.app_tools for insert to authenticated with check (
  created_by = (select auth.uid()) and exists (
    select 1 from public.profiles p where p.id = (select auth.uid())
      and p.is_active and p.account_status = 'approved' and p.role = 'admin'
  )
);
create policy tools_update_admin on public.app_tools for update to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_active and p.account_status = 'approved' and p.role = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_active and p.account_status = 'approved' and p.role = 'admin'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('app-tools', 'app-tools', false, 52428800, array['application/octet-stream']);

create policy tools_files_read on storage.objects for select to authenticated using (
  bucket_id = 'app-tools' and exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_active and p.account_status = 'approved'
      and (p.role = 'admin' or exists (select 1 from public.app_tools t where t.file_path = storage.objects.name and t.is_active))
  )
);
create policy tools_files_upload_admin on storage.objects for insert to authenticated with check (
  bucket_id = 'app-tools' and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~* '\.(exe|msi|zip)$' and exists (
      select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_active and p.account_status = 'approved' and p.role = 'admin'
    )
);
-- Objects are immutable; new versions receive new paths. Removal is only for failed uploads.
create policy tools_files_delete_admin on storage.objects for delete to authenticated using (
  bucket_id = 'app-tools' and exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_active and p.account_status = 'approved' and p.role = 'admin'
  ) and not exists (select 1 from public.app_tools t where t.file_path = storage.objects.name)
);

alter table public.sidebar_preferences drop constraint sidebar_preferences_sections_valid;
alter table public.sidebar_preferences add constraint sidebar_preferences_sections_valid check (
  cardinality(sections) <= 14 and sections <@ array['TAREFAS','REUNIAO','NOTAS','FERRAMENTAS','COMPRAS_IA','CADASTROS','ESTOQUE_ERP','PRECIFICACAO','PRE_VENCIDOS','PRAZOS','TRANSPORTE','BALACUBACO','AUDITORIA','USUARIOS']::text[]
);
