'use client';

import { useCallback, useState } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { createAnnouncement, deleteAnnouncement } from '@/lib/api';

interface UseAnnouncementActionsInput {
  user: SupabaseUser | null;
  userSector: string;
  onChanged: () => void;
}

export function useAnnouncementActions({ user, userSector, onChanged }: UseAnnouncementActionsInput) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const addAnnouncement = useCallback(async () => {
    if (!title || !content || !user) return;
    setUploading(true);

    try {
      await createAnnouncement({
        title,
        content,
        createdBy: user.id,
        sector: userSector,
        image,
      });
      setTitle('');
      setContent('');
      setImage(null);
      onChanged();
      alert('Alerta transmitido!');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      alert('Erro ao transmitir alerta: ' + message);
    } finally {
      setUploading(false);
    }
  }, [content, image, onChanged, title, user, userSector]);

  const removeAnnouncement = useCallback(async (announcementId: string) => {
    await deleteAnnouncement(announcementId);
    onChanged();
  }, [onChanged]);

  return {
    title,
    setTitle,
    content,
    setContent,
    image,
    setImage,
    uploading,
    addAnnouncement,
    removeAnnouncement,
  };
}
