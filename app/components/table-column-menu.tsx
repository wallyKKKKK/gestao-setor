'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, Columns3, RotateCcw, X } from 'lucide-react';

interface TableColumnMenuProps<Key extends string> {
  x: number;
  y: number;
  column: { key: Key; label: string } | null;
  columns: readonly { key: Key; label: string }[];
  hidden: readonly Key[];
  configure?: boolean;
  canSort: boolean;
  onSort: (direction: 'asc' | 'desc') => void;
  onRestoreWidth: () => void;
  onRestoreAll: () => void;
  onToggle: (key: Key) => void;
  onShowAll: () => void;
  onClose: () => void;
}

export function TableColumnMenu<Key extends string>(props: TableColumnMenuProps<Key>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<'menu' | 'columns' | 'confirm'>(props.configure ? 'columns' : 'menu');
  const [position, setPosition] = useState({ x: props.x, y: props.y });
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  useLayoutEffect(() => {
    const fit = () => {
      const rect = dialogRef.current?.getBoundingClientRect();
      if (rect) setPosition({ x: Math.max(8, Math.min(props.x, window.innerWidth - rect.width - 8)), y: Math.max(8, Math.min(props.y, window.innerHeight - rect.height - 8)) });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [props.x, props.y, view]);
  const commandClass = 'flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs font-semibold hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-violet-600 disabled:opacity-40';
  const label = (column: { label: string }) => column.label || 'Selecionar itens';

  return (
    <dialog
      ref={dialogRef}
      aria-label={view === 'columns' ? 'Configurar colunas' : view === 'confirm' ? 'Restaurar todas as colunas' : 'Opcoes da coluna'}
      onCancel={props.onClose}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) props.onClose();
      }}
      className="fixed m-0 w-72 max-w-[calc(100vw_-_16px)] max-h-[min(480px,calc(100dvh_-_16px))] overflow-hidden rounded-lg border border-slate-200 bg-white p-1 text-slate-800 shadow-xl backdrop:bg-transparent"
      style={{ left: position.x, top: position.y, right: 'auto', bottom: 'auto' }}
    >
      <div className="flex max-h-[min(470px,calc(100dvh_-_26px))] flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-2 py-2">
          {view !== 'menu' && <button type="button" onClick={() => setView('menu')} title="Voltar" aria-label="Voltar" className="rounded p-1 hover:bg-slate-100"><ChevronLeft size={15} /></button>}
          <span className="min-w-0 flex-1 truncate text-xs font-bold">{view === 'columns' ? 'Configurar colunas' : view === 'confirm' ? 'Restaurar colunas' : props.column ? label(props.column) : 'Colunas'}</span>
          <button type="button" onClick={props.onClose} title="Fechar" aria-label="Fechar opcoes de colunas" className="rounded p-1 hover:bg-slate-100"><X size={15} /></button>
        </header>
        {view === 'menu' && <div className="py-1">
          <button type="button" disabled={!props.canSort} className={commandClass} onClick={() => { props.onSort('asc'); props.onClose(); }}><ArrowUp size={15} /> Ordenar crescente</button>
          <button type="button" disabled={!props.canSort} className={commandClass} onClick={() => { props.onSort('desc'); props.onClose(); }}><ArrowDown size={15} /> Ordenar decrescente</button>
          <button type="button" disabled={!props.column} className={commandClass} onClick={() => { props.onRestoreWidth(); props.onClose(); }}><RotateCcw size={15} /> Restaurar largura desta coluna</button>
          <button type="button" className={commandClass} onClick={() => setView('columns')}><Columns3 size={15} /> Configurar colunas</button>
          <button type="button" className={`${commandClass} border-t border-slate-100 text-slate-500`} onClick={() => setView('confirm')}><RotateCcw size={15} /> Restaurar todas as colunas</button>
        </div>}
        {view === 'columns' && <>
          <div className="flex shrink-0 items-center justify-between px-3 py-2 text-[11px] text-slate-500"><span>{props.hidden.length} ocultas</span><button type="button" onClick={props.onShowAll} className="font-bold text-violet-700 hover:underline">Mostrar todas</button></div>
          <div className="min-h-0 overflow-y-auto px-1 pb-1">
            {props.columns.map((column) => {
              const visible = !props.hidden.includes(column.key);
              return <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-xs hover:bg-violet-50">
                <input type="checkbox" checked={visible} disabled={visible && props.columns.length - props.hidden.length <= 1} onChange={() => props.onToggle(column.key)} className="h-4 w-4 shrink-0 accent-violet-600 disabled:opacity-40" />
                <span className="break-words">{label(column)}</span>
              </label>;
            })}
          </div>
        </>}
        {view === 'confirm' && <div className="space-y-3 px-3 py-3 text-xs">
          <p>Restaurar a ordem, as larguras e mostrar todas as colunas?</p>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setView('menu')} className="rounded border border-slate-200 px-3 py-2">Cancelar</button><button type="button" onClick={() => { props.onRestoreAll(); props.onClose(); }} className="rounded bg-violet-600 px-3 py-2 font-bold text-white">Restaurar</button></div>
        </div>}
      </div>
    </dialog>
  );
}
