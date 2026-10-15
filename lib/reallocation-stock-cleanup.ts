import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function cleanupRetiredReallocationStock(sector: string, budgetMs = 120_000) {
  const supabase = getSupabaseAdmin();
  const deadline = Date.now() + budgetMs;
  let deletedRows = 0;
  while (Date.now() < deadline) {
    const { data, error } = await supabase.rpc('cleanup_reallocation_stock_snapshots', {
      p_sector: sector, p_batch_size: 2000,
    });
    if (error) {
      console.error('Limpeza de estoque pendente', { code: error.code, message: error.message });
      return { completed: false, deletedRows };
    }
    deletedRows += Number(data?.deleted_rows || 0);
    if (!data?.pending) return { completed: true, deletedRows };
  }
  // Retired rows are never read by the calculator; the next import resumes cleanup.
  console.warn('Limpeza de estoque continuara na proxima importacao', { deletedRows });
  return { completed: false, deletedRows };
}
