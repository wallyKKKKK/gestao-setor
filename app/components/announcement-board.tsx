'use client';

import Image from 'next/image';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { Megaphone, Plus, Trash2, X } from 'lucide-react';
import type { Announcement, UserRole } from '@/lib/types';

interface AnnouncementBoardProps {
  announcements: Announcement[];
  userRole: UserRole;
  userSector: string;
  user: SupabaseUser | null;
  title: string;
  content: string;
  image: File | null;
  uploading: boolean;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onImageChange: (value: File | null) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
}

export function AnnouncementBoard({
  announcements,
  userRole,
  userSector,
  user,
  title,
  content,
  image,
  uploading,
  onTitleChange,
  onContentChange,
  onImageChange,
  onAdd,
  onDelete,
}: AnnouncementBoardProps) {
  const visibleAnnouncements = announcements.filter(
    (announcement) =>
      userRole === 'admin' || announcement.sector === userSector || announcement.sector === 'Geral',
  );

  return (
    <div className="mt-8 space-y-8 animate-in fade-in duration-500 pb-20">
      <div className="flex justify-between items-center px-4">
        <h2 className="text-3xl font-black uppercase italic tracking-tighter flex items-center gap-3">
          <Megaphone className="text-red-600 animate-bounce" size={32} /> Mural de Avisos
        </h2>
        <div className="bg-slate-900 text-white px-4 py-1.5 rounded-full font-black text-[10px] uppercase">
          Setor: {userSector}
        </div>
      </div>

      <div className="bg-white p-8 rounded-[40px] border-4 border-slate-900 shadow-[12px_12px_0px_0px_rgba(15,23,42,1)] space-y-4 mx-4">
        <input
          className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-slate-900 outline-none focus:border-red-500 uppercase"
          placeholder="TÍTULO DO ALERTA..."
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
        />
        <textarea
          className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold text-slate-700 outline-none focus:border-red-500 min-h-[100px] resize-none"
          placeholder="MENSAGEM PARA A EQUIPE..."
          value={content}
          onChange={(event) => onContentChange(event.target.value)}
        />

        <div className="flex items-center gap-4">
          <label className="flex-1 flex items-center justify-center gap-3 p-4 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-all group">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => onImageChange(event.target.files?.[0] || null)}
            />
            <div className="bg-blue-100 text-blue-600 p-2 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors">
              <Plus size={20} strokeWidth={3} />
            </div>
            <span className="text-[10px] font-black uppercase text-slate-500">
              {image ? `IMAGEM: ${image.name.slice(0, 15)}...` : 'ADICIONAR FOTO AO ALERTA'}
            </span>
          </label>

          {image && (
            <button
              onClick={() => onImageChange(null)}
              className="p-4 bg-red-50 text-red-500 rounded-2xl hover:bg-red-500 hover:text-white transition-all"
            >
              <X size={20} strokeWidth={3} />
            </button>
          )}
        </div>

        <button
          onClick={onAdd}
          disabled={uploading}
          className="w-full bg-red-600 text-white p-5 rounded-3xl font-black uppercase tracking-widest hover:bg-slate-900 transition-all flex items-center justify-center gap-3 shadow-lg active:scale-[0.98]"
        >
          {uploading ? 'ENVIANDO...' : <><Megaphone size={20} /> TRANSMITIR ALERTA</>}
        </button>
      </div>

      <div className="space-y-8 px-4">
        {visibleAnnouncements.map((announcement) => (
          <div
            key={announcement.id}
            className="bg-white border-4 border-slate-900 rounded-[40px] shadow-[12px_12px_0px_0px_rgba(248,113,113,1)] overflow-hidden"
          >
            {announcement.image_url && (
              <div className="relative w-full h-64 overflow-hidden border-b-4 border-slate-900 bg-slate-100">
                <Image
                  src={announcement.image_url}
                  alt="Alerta"
                  fill
                  sizes="(max-width: 768px) 100vw, 768px"
                  unoptimized
                  className="object-cover hover:scale-105 transition-transform duration-700"
                />
              </div>
            )}

            <div className="p-8">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="bg-red-600 text-white text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-widest">
                      ALERTA OFICIAL
                    </span>
                    <span className="bg-slate-100 text-slate-600 text-[8px] font-black px-2 py-0.5 rounded uppercase">
                      {announcement.sector}
                    </span>
                  </div>
                  <h4 className="text-3xl font-black text-slate-900 leading-none uppercase italic">
                    {announcement.title}
                  </h4>
                </div>

                <div className="text-right flex flex-col items-end">
                  <p className="text-[10px] font-black text-slate-900 uppercase">
                    {new Date(announcement.created_at).toLocaleDateString('pt-BR')}
                  </p>
                  <p className="text-[14px] font-black text-blue-600 leading-none mt-1">
                    {new Date(announcement.created_at).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 p-6 rounded-3xl border-2 border-slate-100 text-slate-700 font-bold leading-relaxed whitespace-pre-wrap mb-6">
                {announcement.content}
              </div>

              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-slate-900 text-white rounded-full flex items-center justify-center text-[8px] font-black uppercase">
                    {announcement.profiles?.full_name?.charAt(0)}
                  </div>
                  <p className="text-[9px] font-black text-slate-400 uppercase">
                    Transmitido por: <span className="text-slate-900">{announcement.profiles?.full_name}</span>
                  </p>
                </div>

                {(userRole === 'admin' || announcement.created_by === user?.id) && (
                  <button
                    onClick={() => {
                      if (confirm('Excluir alerta?')) {
                        onDelete(announcement.id);
                      }
                    }}
                    className="text-red-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-xl transition-all"
                  >
                    <Trash2 size={20} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
