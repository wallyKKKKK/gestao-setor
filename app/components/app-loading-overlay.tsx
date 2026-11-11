'use client';

import { useId, useLayoutEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';

export function isAppLoadingOverlayOpen() {
  return Boolean(document.querySelector('[data-app-loading-overlay]:modal'));
}

export function AppLoadingOverlay({ title, description }: { title: string; description: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      data-app-loading-overlay
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={event => event.preventDefault()}
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-[360px] cursor-wait rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-[0_22px_60px_rgba(15,23,42,0.18)] backdrop:cursor-wait backdrop:bg-white/80 backdrop:backdrop-blur-[2px] dark:backdrop:bg-slate-950/65"
    >
      <div role="status" className="flex flex-col items-center px-8 py-7 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg">
          <Loader2 size={28} aria-hidden="true" className="animate-spin" />
        </div>
        <p id={titleId} className="text-sm font-black uppercase tracking-widest">{title}</p>
        <p id={descriptionId} className="mt-2 text-xs font-bold leading-relaxed text-slate-600">{description}</p>
        <div aria-hidden="true" className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full w-full rounded-full bg-blue-600 motion-safe:animate-pulse" />
        </div>
      </div>
    </dialog>
  );
}
