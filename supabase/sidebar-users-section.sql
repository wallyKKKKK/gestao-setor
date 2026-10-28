alter table public.sidebar_preferences drop constraint sidebar_preferences_sections_valid;
alter table public.sidebar_preferences add constraint sidebar_preferences_sections_valid check (
  cardinality(sections) <= 13 and sections <@ array['TAREFAS','REUNIAO','NOTAS','COMPRAS_IA','CADASTROS','ESTOQUE_ERP','PRECIFICACAO','PRE_VENCIDOS','PRAZOS','TRANSPORTE','BALACUBACO','AUDITORIA','USUARIOS']::text[]
);
