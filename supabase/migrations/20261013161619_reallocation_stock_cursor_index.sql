-- Supports snapshot filtering and deterministic UUID keyset pagination.
-- Version matches the migration applied to the connected Supabase project.
create index if not exists reallocation_stock_items_snapshot_id_cursor_idx
on public.reallocation_stock_items (snapshot_id, id);
