import type { JSONContent } from '@tiptap/react';

const PREFIX = 'wally-rich-note:v1\n';

export function decodeNote(content: string): JSONContent {
  if (content.startsWith(PREFIX)) {
    try {
      const document = JSON.parse(content.slice(PREFIX.length));
      if (document?.type === 'doc' && Array.isArray(document.content)) return document;
    } catch { /* Preserve malformed stored text instead of dropping it. */ }
  }
  return { type: 'doc', content: content.split('\n').map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) };
}

export function encodeNote(document: JSONContent): string {
  return PREFIX + JSON.stringify(document);
}

export function notePlainText(content: string): string {
  if (!content.startsWith(PREFIX)) return content;
  const text = (node: JSONContent): string => {
    if (node.type === 'text') return node.text || '';
    if (node.type === 'hardBreak') return '\n';
    const children = (node.content || []).map(text).join('');
    return ['paragraph', 'heading', 'listItem', 'taskItem'].includes(node.type || '') ? children + '\n' : children;
  };
  return text(decodeNote(content)).trim();
}

export interface NoteTaskContent {
  description: string;
  subtasks: Array<{ title: string; done: boolean }>;
}

export function noteTaskContent(content: string): NoteTaskContent {
  const subtasks: NoteTaskContent['subtasks'] = [];
  const description: string[] = [];
  const segments: Array<{ text: string; list: boolean; infer: boolean }> = [];
  const marker = /^\s*(?:(?:[-*+•–—]\s+)(?:\[[ xX]\]\s*)?|\[[ xX]\]\s*|(?:\d{1,3}\s*[.)-]|\(\d{1,3}\))\s+)(\S.*)$/;
  const add = (title: string) => {
    const trimmed = title.trim();
    if (trimmed) segments.push({ text: trimmed, list: true, infer: false });
  };
  const plain = (text: string) => {
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(marker);
      if (match) add(match[1]);
      else segments.push({ text: line, list: false, infer: true });
    }
  };
  const nodeText = (node: JSONContent): string => {
    if (node.type === 'text') return node.text || '';
    if (node.type === 'hardBreak') return '\n';
    return (node.content || []).filter(child => !['bulletList', 'orderedList', 'taskList'].includes(child.type || '')).map(nodeText).join(node.type === 'listItem' || node.type === 'taskItem' ? ' ' : '');
  };
  const walk = (node: JSONContent) => {
    if (node.type === 'listItem' || node.type === 'taskItem') {
      add(nodeText(node));
      for (const child of node.content || []) {
        if (['bulletList', 'orderedList', 'taskList'].includes(child.type || '')) walk(child);
      }
    } else if (['bulletList', 'orderedList', 'taskList', 'doc'].includes(node.type || '')) {
      (node.content || []).forEach(walk);
    } else if (node.type === 'paragraph' || node.type === 'heading') {
      plain(nodeText(node));
    } else {
      // Keep quotes and code as description, not inferred checklist items.
      segments.push({ text: notePlainText(encodeNote({ type: 'doc', content: [node] })), list: false, infer: false });
    }
  };
  if (content.startsWith(PREFIX)) walk(decodeNote(content));
  else plain(content);
  // Bare numbers need a sequence, so a single quantity is not treated as a list.
  const numbered = /^\s*(\d{1,3})[ \t]+(\S.*)$/;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment.list) {
      subtasks.push({ title: segment.text, done: false });
      continue;
    }
    const first = segment.infer ? segment.text.match(numbered) : null;
    if (first) {
      const titles = [first[2].trim()];
      let nextNumber = Number(first[1]) + 1;
      let last = index;
      for (let next = index + 1; next < segments.length; next++) {
        const candidate = segments[next];
        if (candidate.list || !candidate.infer) break;
        if (!candidate.text.trim()) continue;
        const match = candidate.text.match(numbered);
        if (!match || Number(match[1]) !== nextNumber) break;
        titles.push(match[2].trim());
        nextNumber++;
        last = next;
      }
      if (titles.length >= 2) {
        titles.forEach(title => subtasks.push({ title, done: false }));
        index = last;
        continue;
      }
    }
    description.push(segment.text);
  }
  return { description: description.join('\n').replace(/\n{3,}/g, '\n\n').trim(), subtasks };
}
