export const TOOLS_BUCKET = 'app-tools';
export const MAX_TOOL_FILE_SIZE = 50 * 1024 * 1024;
export const TOOL_FILE_ACCEPT = '.exe,.msi,.zip';

export function toolPublishError(error: unknown, stage: 'upload' | 'database') {
  const details = error && typeof error === 'object' ? error as { message?: string; code?: string; statusCode?: string | number; status?: number } : {};
  const message = String(details.message || '').slice(0, 400);
  const normalized = message.toLowerCase();
  const code = String(details.code || '');
  const status = Number(details.statusCode || details.status || 0);
  if (status === 401 || /jwt|token.*expired|invalid.*token/.test(normalized)) return 'Sua sessão expirou. Entre novamente e tente publicar.';
  if (status === 403 || code === '42501' || /row.level security|permission denied|unauthorized/.test(normalized)) return 'Sem permissão para publicar. Entre com uma conta ADMIN ativa e aprovada.';
  if (status === 413 || /exceed|too large|maximum.*size/.test(normalized)) return 'O arquivo ultrapassa o limite permitido pelo armazenamento (até 50 MB).';
  if (/mime|content.type|unsupported.*type/.test(normalized)) return 'O armazenamento recusou o tipo do arquivo. Selecione novamente o arquivo e tente publicar.';
  if (code === '23514') return 'Os dados não passaram na validação do banco. Confira nome, versão e arquivo.';
  if (code === '23505') return 'Esta publicação já foi registrada. Atualize a lista de ferramentas antes de tentar novamente.';
  const operation = stage === 'upload' ? 'enviar o arquivo' : 'salvar os dados da ferramenta';
  return `Não foi possível ${operation}.${message ? ` Detalhe: ${message}` : ' Confira sua conexão e tente novamente.'}`;
}

export interface DownloadableTool {
  id: string;
  name: string;
  description: string;
  version: string;
  file_name: string;
  file_path: string;
  file_size: number;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const TOOL_COLUMNS = 'id,name,description,version,file_name,file_path,file_size,is_active,created_by,created_at,updated_at';

export function validateToolFile(file: Pick<File, 'name' | 'size'>) {
  if (!/\.(exe|msi|zip)$/i.test(file.name)) return 'Selecione um arquivo EXE, MSI ou ZIP.';
  if (!file.size) return 'O arquivo está vazio.';
  if (file.size > MAX_TOOL_FILE_SIZE) return 'O arquivo deve ter no máximo 50 MB.';
  return '';
}

export function toolStorageName(name: string) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-180);
}

export function formatToolSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`
    : `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}
