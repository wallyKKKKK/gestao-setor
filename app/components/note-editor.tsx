'use client';

import { useEffect, useRef } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, CheckSquare, Highlighter, Italic, Link, List, ListOrdered, Minus, Redo2, RemoveFormatting, Strikethrough, Underline, Undo2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { decodeNote, encodeNote } from '@/lib/note-content';

export function NoteEditor({ value, disabled, onChange, onSave }: { value: string; disabled: boolean; onChange: (value: string) => void; onSave: () => void }) {
  const callbacks = useRef({ onChange, onSave });
  useEffect(() => { callbacks.current = { onChange, onSave }; }, [onChange, onSave]);
  const emitted = useRef(value);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, defaultProtocol: 'https', protocols: ['http', 'https', 'mailto'] } }),
      TextStyleKit, TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight.configure({ multicolor: true }), TaskList, TaskItem.configure({ nested: true }),
    ],
    content: decodeNote(value),
    editable: !disabled,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': 'Conteúdo da nota', 'aria-multiline': 'true', class: 'note-rich-content min-h-[45vh] p-3 outline-none' },
      handleClick: (_view, _position, event) => {
        const anchor = (event.target as HTMLElement)?.closest('a');
        if ((event.ctrlKey || event.metaKey) && anchor && /^(https?:\/\/|mailto:)/i.test(anchor.href)) {
          event.preventDefault();
          window.open(anchor.href, '_blank', 'noopener,noreferrer');
          return true;
        }
        return false;
      },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault(); callbacks.current.onSave(); return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      emitted.current = encodeNote(editor.getJSON());
      callbacks.current.onChange(emitted.current);
    },
  });
  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);
  useEffect(() => {
    if (editor && value !== emitted.current) {
      editor.commands.setContent(decodeNote(value), { emitUpdate: false });
      emitted.current = value;
    }
  }, [editor, value]);
  const state = useEditorState({ editor, selector: ({ editor }) => editor ? {
    bold: editor.isActive('bold'), italic: editor.isActive('italic'), underline: editor.isActive('underline'), strike: editor.isActive('strike'),
    bullet: editor.isActive('bulletList'), ordered: editor.isActive('orderedList'), task: editor.isActive('taskList'),
    highlight: editor.isActive('highlight'), link: editor.isActive('link'),
    heading: editor.getAttributes('heading').level || 0,
    font: editor.getAttributes('textStyle').fontFamily || '', size: editor.getAttributes('textStyle').fontSize || '',
    color: editor.getAttributes('textStyle').color || '#111827',
    alignment: editor.getAttributes('paragraph').textAlign || editor.getAttributes('heading').textAlign || 'left',
    undo: editor.can().undo(), redo: editor.can().redo(), text: editor.getText(),
  } : null });
  if (!editor || !state) return <p className="p-3 text-sm text-slate-500">Carregando editor...</p>;
  const button = (label: string, Icon: LucideIcon, action: () => void, active = false, unavailable = false) => (
    <button key={label} type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled || unavailable} onMouseDown={event => event.preventDefault()} onClick={action} className={`flex h-8 w-8 items-center justify-center rounded disabled:opacity-35 ${active ? 'bg-teal-100 text-teal-900' : 'text-slate-600 hover:bg-slate-100'}`}><Icon size={16} /></button>
  );
  const link = () => {
    const url = window.prompt('Endereço do link (https://...)', editor.getAttributes('link').href || '');
    if (url === null) return;
    if (!url.trim()) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    const normalized = /^[a-z][a-z\d+.-]*:/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    if (!/^(https?:\/\/|mailto:)/i.test(normalized)) { window.alert('Use um endereço http, https ou mailto.'); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: normalized }).run();
  };
  const words = state.text.trim() ? state.text.trim().split(/\s+/).length : 0;
  return <div className="min-w-0 rounded-md border border-slate-200">
    <div role="toolbar" aria-label="Formatação da nota" className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 p-2">
      <select title="Estilo do texto" aria-label="Estilo do texto" disabled={disabled} value={state.heading} onChange={event => { const level = Number(event.target.value); if (level) editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 }).run(); else editor.chain().focus().setParagraph().run(); }} className="h-8 max-w-full rounded border border-slate-200 bg-white px-2 text-xs"><option value={0}>Normal</option><option value={1}>Título 1</option><option value={2}>Título 2</option><option value={3}>Título 3</option></select>
      <select title="Fonte" aria-label="Fonte" disabled={disabled} value={state.font} onChange={event => { if (event.target.value) editor.chain().focus().setFontFamily(event.target.value).run(); else editor.chain().focus().unsetFontFamily().run(); }} className="h-8 max-w-full rounded border border-slate-200 bg-white px-2 text-xs"><option value="">Fonte padrão</option>{['Arial', 'Georgia', 'Times New Roman', 'Verdana', 'Courier New'].map(font => <option key={font}>{font}</option>)}</select>
      <select title="Tamanho da fonte" aria-label="Tamanho da fonte" disabled={disabled} value={state.size} onChange={event => { if (event.target.value) editor.chain().focus().setFontSize(event.target.value).run(); else editor.chain().focus().unsetFontSize().run(); }} className="h-8 rounded border border-slate-200 bg-white px-2 text-xs"><option value="">Tamanho</option>{[12, 14, 16, 18, 20, 24, 28, 32].map(size => <option key={size} value={`${size}px`}>{size}</option>)}</select>
      {button('Desfazer', Undo2, () => { editor.chain().focus().undo().run(); }, false, !state.undo)}
      {button('Refazer', Redo2, () => { editor.chain().focus().redo().run(); }, false, !state.redo)}
      {button('Negrito', Bold, () => { editor.chain().focus().toggleBold().run(); }, state.bold)}
      {button('Itálico', Italic, () => { editor.chain().focus().toggleItalic().run(); }, state.italic)}
      {button('Sublinhado', Underline, () => { editor.chain().focus().toggleUnderline().run(); }, state.underline)}
      {button('Tachado', Strikethrough, () => { editor.chain().focus().toggleStrike().run(); }, state.strike)}
      <input type="color" title="Cor do texto" aria-label="Cor do texto" disabled={disabled} value={/^#[\da-f]{6}$/i.test(state.color) ? state.color : '#111827'} onChange={event => { editor.chain().focus().setColor(event.target.value).run(); }} className="h-8 w-8 cursor-pointer rounded border border-slate-200 bg-white p-1" />
      {button('Marca-texto', Highlighter, () => { editor.chain().focus().toggleHighlight({ color: '#fde047' }).run(); }, state.highlight)}
      {button('Lista com marcadores', List, () => { editor.chain().focus().toggleBulletList().run(); }, state.bullet)}
      {button('Lista numerada', ListOrdered, () => { editor.chain().focus().toggleOrderedList().run(); }, state.ordered)}
      {button('Lista de tarefas', CheckSquare, () => { editor.chain().focus().toggleTaskList().run(); }, state.task)}
      {(['left', 'center', 'right', 'justify'] as const).map((alignment, i) => button(['Alinhar à esquerda', 'Centralizar', 'Alinhar à direita', 'Justificar'][i], [AlignLeft, AlignCenter, AlignRight, AlignJustify][i], () => { editor.chain().focus().setTextAlign(alignment).run(); }, state.alignment === alignment))}
      {button('Inserir ou remover link', Link, link, state.link)}
      {button('Linha horizontal', Minus, () => { editor.chain().focus().setHorizontalRule().run(); })}
      {button('Limpar formatação', RemoveFormatting, () => { editor.chain().focus().unsetAllMarks().clearNodes().unsetTextAlign().run(); })}
    </div>
    <EditorContent editor={editor} />
    <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">{words} palavras · {state.text.length} caracteres</p>
  </div>;
}
