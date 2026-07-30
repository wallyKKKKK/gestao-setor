export type ThemedAppSection =
  | 'INICIO'
  | 'TAREFAS'
  | 'REUNIAO'
  | 'COMPRAS_IA'
  | 'CADASTROS'
  | 'ESTOQUE_ERP'
  | 'PRECIFICACAO'
  | 'PRE_VENCIDOS'
  | 'PRAZOS'
  | 'TRANSPORTE'
  | 'BALACUBACO'
  | 'AUDITORIA';

interface SectionTheme {
  helper: string;
  gradientClassName: string;
  iconClassName: string;
  accent: string;
  soft: string;
  softDark: string;
}

export const SECTION_THEMES: Record<ThemedAppSection, SectionTheme> = {
  INICIO: {
    helper: 'Central',
    gradientClassName: 'from-blue-600 to-sky-500',
    iconClassName: 'bg-blue-600 text-white',
    accent: '#2563eb',
    soft: '#E8F1FF',
    softDark: '#101B33',
  },
  TAREFAS: {
    helper: 'Operacao diaria',
    gradientClassName: 'from-blue-600 to-sky-500',
    iconClassName: 'bg-blue-600 text-white',
    accent: '#2563eb',
    soft: '#E8F1FF',
    softDark: '#101B33',
  },
  REUNIAO: {
    helper: 'Calendario',
    gradientClassName: 'from-sky-500 to-cyan-500',
    iconClassName: 'bg-sky-500 text-white',
    accent: '#06b6d4',
    soft: '#E6F8FF',
    softDark: '#0B2433',
  },
  COMPRAS_IA: {
    helper: 'Fornecedor',
    gradientClassName: 'from-emerald-600 to-teal-500',
    iconClassName: 'bg-emerald-600 text-white',
    accent: '#059669',
    soft: '#E8FFF5',
    softDark: '#0B2A22',
  },
  CADASTROS: {
    helper: 'Base mestre',
    gradientClassName: 'from-slate-700 to-slate-500',
    iconClassName: 'bg-slate-700 text-white',
    accent: '#475569',
    soft: '#EEF2F7',
    softDark: '#172033',
  },
  ESTOQUE_ERP: {
    helper: 'Estoque',
    gradientClassName: 'from-indigo-600 to-blue-500',
    iconClassName: 'bg-indigo-600 text-white',
    accent: '#4f46e5',
    soft: '#EEF2FF',
    softDark: '#151A3A',
  },
  PRECIFICACAO: {
    helper: 'Preco',
    gradientClassName: 'from-violet-600 to-indigo-500',
    iconClassName: 'bg-violet-600 text-white',
    accent: '#7c3aed',
    soft: '#F3ECFF',
    softDark: '#21163A',
  },
  PRE_VENCIDOS: {
    helper: 'Validade',
    gradientClassName: 'from-amber-500 to-orange-500',
    iconClassName: 'bg-amber-500 text-white',
    accent: '#f59e0b',
    soft: '#FFF6E2',
    softDark: '#33200B',
  },
  PRAZOS: {
    helper: 'Compras',
    gradientClassName: 'from-emerald-500 to-lime-500',
    iconClassName: 'bg-emerald-500 text-white',
    accent: '#22c55e',
    soft: '#ECFCEB',
    softDark: '#133318',
  },
  TRANSPORTE: {
    helper: 'Logistica',
    gradientClassName: 'from-cyan-600 to-blue-500',
    iconClassName: 'bg-cyan-600 text-white',
    accent: '#0891b2',
    soft: '#E6F8FF',
    softDark: '#0B2533',
  },
  BALACUBACO: {
    helper: 'Transferencia',
    gradientClassName: 'from-purple-600 to-fuchsia-500',
    iconClassName: 'bg-purple-600 text-white',
    accent: '#a21caf',
    soft: '#FAEAFF',
    softDark: '#2B1236',
  },
  AUDITORIA: {
    helper: 'Controle',
    gradientClassName: 'from-red-500 to-rose-500',
    iconClassName: 'bg-red-500 text-white',
    accent: '#f43f5e',
    soft: '#FFF0F3',
    softDark: '#33131C',
  },
};

export function getSectionTheme(section: ThemedAppSection) {
  return SECTION_THEMES[section];
}
