"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatToBR } from "@/lib/task-recurrence";

export function TaskOccurrenceNotice({ date }: { date: string }) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, transform: "" });

  const show = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const card = buttonRef.current?.closest("[data-task-card]")?.getBoundingClientRect() || rect;
    const width = Math.min(272, window.innerWidth - 24);
    const above = card.top >= 108;
    const fitsRight = card.right + 10 + width <= window.innerWidth - 12;
    setPosition({
      top: fitsRight ? Math.max(12, Math.min(rect.top, window.innerHeight - 108)) : above ? card.top - 8 : card.bottom + 8,
      left: fitsRight ? card.right + 10 : Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
      transform: !fitsRight && above ? "translateY(-100%)" : "",
    });
    setVisible(true);
  };

  useEffect(() => {
    if (!visible) return;
    const dismiss = () => setVisible(false);
    const onPointerDown = (event: PointerEvent) => {
      if (!buttonRef.current?.contains(event.target as Node)) dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [visible]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Ver pendência da ocorrência anterior"
        aria-expanded={visible}
        aria-describedby={visible ? id : undefined}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerEnter={(event) => { if (event.pointerType === "mouse") show(); }}
        onPointerLeave={() => { if (document.activeElement !== buttonRef.current) setVisible(false); }}
        onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) show(); }}
        onBlur={() => setVisible(false)}
        onClick={(event) => {
          event.stopPropagation();
          show();
        }}
        className="absolute right-2 top-2 z-30 flex h-8 w-8 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
      >
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-amber-500 ring-4 ring-amber-100" />
      </button>
      {visible && createPortal(
        <div
          id={id}
          role="tooltip"
          className="pointer-events-none fixed z-[1000] w-[272px] max-w-[calc(100vw-24px)] rounded-lg border border-amber-200 bg-white p-3 text-left text-slate-700 shadow-lg"
          style={position}
        >
          <p className="text-xs font-bold text-amber-800">Pendência anterior</p>
          <p className="mt-1 text-xs leading-relaxed">Última ocorrência não concluída: {formatToBR(date)}</p>
        </div>,
        document.body,
      )}
    </>
  );
}
