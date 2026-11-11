'use client';

import { useEffect, useId, useRef, useState } from 'react';

export function BrazilianDateField({ value, min, onChange, label, required }: {
  value: string;
  min?: string;
  onChange: (value: string) => void;
  label: string;
  required?: boolean;
}) {
  const displayDate = value ? value.split('-').reverse().join('/') : 'DD/MM/AAAA';
  return (
    <div className="relative">
      <input
        type="date"
        lang="pt-BR"
        aria-label={label}
        value={value}
        min={min}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 text-sm font-black text-transparent outline-none transition focus:border-blue-600 [&::-webkit-datetime-edit]:opacity-0"
      />
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-4 right-10 flex items-center text-sm font-black text-slate-900">
        {displayDate}
      </span>
    </div>
  );
}

function padTimePart(value: number) {
  return String(value).padStart(2, '0');
}

function TimeDialPicker({ value, onChange, exactMinutes }: {
  value: string; onChange: (value: string) => void; exactMinutes: boolean;
}) {
  const [mode, setMode] = useState<'hour' | 'minute'>('hour');
  const [hourValue, minuteValue] = (value || '09:00').split(':');
  const hour = Number.parseInt(hourValue, 10) || 0;
  const minute = Number.parseInt(minuteValue, 10) || 0;
  const values = mode === 'hour'
    ? Array.from({ length: 24 }, (_, index) => index)
    : Array.from({ length: 12 }, (_, index) => index * 5);
  const activeValue = mode === 'hour' ? hour : minute;
  const activePosition = mode === 'hour' ? activeValue % 12 : activeValue / 5;
  const selectedAngle = (activePosition / 12) * 360 - 90;
  const selectedRadius = mode === 'hour' && activeValue >= 12 ? 29 : 42;

  const selectValue = (nextValue: number) => {
    if (mode === 'hour') {
      onChange(`${padTimePart(nextValue)}:${padTimePart(minute)}`);
      setMode('minute');
      return;
    }

    onChange(`${padTimePart(hour)}:${padTimePart(nextValue)}`);
  };

  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-3 text-slate-900 shadow-[0_18px_50px_rgba(15,23,42,0.16)]">
      <p className="text-[10px] font-black uppercase tracking-[0.24em] text-blue-600">Selecione o horário</p>

      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <button
          type="button"
          aria-label={`Ajustar horas: ${padTimePart(hour)}`}
          aria-pressed={mode === 'hour'}
          onClick={() => setMode('hour')}
          className={`h-14 rounded-[18px] text-3xl font-black transition ${
            mode === 'hour' ? 'bg-blue-600 text-white shadow-[0_12px_28px_rgba(37,99,235,0.24)]' : 'bg-slate-50 text-slate-700 ring-1 ring-slate-200 hover:bg-blue-50'
          }`}
        >
          {padTimePart(hour)}
        </button>
        <span className="text-3xl font-black text-slate-400">:</span>
        <button
          type="button"
          aria-label={`Ajustar minutos: ${padTimePart(minute)}`}
          aria-pressed={mode === 'minute'}
          onClick={() => setMode('minute')}
          className={`h-14 rounded-[18px] text-3xl font-black transition ${
            mode === 'minute' ? 'bg-blue-600 text-white shadow-[0_12px_28px_rgba(37,99,235,0.24)]' : 'bg-slate-50 text-slate-700 ring-1 ring-slate-200 hover:bg-blue-50'
          }`}
        >
          {padTimePart(minute)}
        </button>
      </div>

      <div className="mx-auto mt-3 flex aspect-square max-h-[245px] min-h-[220px] w-full max-w-[245px] items-center justify-center rounded-full bg-slate-50 ring-1 ring-slate-200">
        <div className="relative h-[88%] w-[88%] rounded-full">
          <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500" />
          <div
            className="absolute left-1/2 top-1/2 h-1 rounded-full bg-blue-500"
            style={{
              width: `${selectedRadius}%`,
              transform: `rotate(${selectedAngle}deg)`,
              transformOrigin: 'left center',
            }}
          />

          {values.map((item) => {
            const position = mode === 'hour' ? item % 12 : item / 5;
            const angle = (position / 12) * Math.PI * 2 - Math.PI / 2;
            const radius = mode === 'hour' && item >= 12 ? 29 : 42;
            const left = 50 + Math.cos(angle) * radius;
            const top = 50 + Math.sin(angle) * radius;
            const selected = item === activeValue;
            const innerHour = mode === 'hour' && item >= 12;

            return (
              <button
                key={item}
                type="button"
                aria-pressed={selected}
                onClick={() => selectValue(item)}
                className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-black transition ${
                  selected ? 'bg-blue-600 text-white shadow-[0_10px_24px_rgba(37,99,235,0.28)]' : 'text-slate-700 hover:bg-blue-50 hover:text-blue-700'
                } ${innerHour ? 'h-8 w-8 text-xs' : 'h-9 w-9 text-sm'}`}
                style={{ left: `${left}%`, top: `${top}%` }}
              >
                {padTimePart(item)}
              </button>
            );
          })}
        </div>
      </div>
      {exactMinutes && mode === 'minute' && (
        <label className="mt-3 flex items-center justify-center gap-2 text-xs font-semibold">
          Minuto exato
          <select className="rounded-md border border-slate-200 bg-slate-50 p-1.5" value={minute} onChange={event => selectValue(Number(event.target.value))}>
            {Array.from({ length: 60 }, (_, index) => <option key={index} value={index}>{padTimePart(index)}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

export function TimePickerField({ value, onChange, label = 'Hora', exactMinutes = false, alignEnd = false }: {
  value: string; onChange: (value: string) => void; label?: string; exactMinutes?: boolean; alignEnd?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        ref={trigger}
        aria-label={value ? `${label}: ${value}` : label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          const spaceBelow = window.innerHeight - rect.bottom;
          setAbove(spaceBelow < 380 && rect.top > spaceBelow);
          setOpen(current => !current);
        }}
        className="flex h-12 w-full items-center justify-between rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 text-left font-black text-slate-900 outline-none transition hover:border-blue-200 hover:bg-white focus:border-blue-600"
      >
        <span className="text-xl tabular-nums">{value || '--:--'}</span>
        <span className="rounded-full bg-blue-100 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-blue-700">
          Ajustar
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[80]" onMouseDown={() => setOpen(false)} />
          <div
            id={panelId}
            className={`absolute left-0 z-[90] w-[min(360px,calc(100vw-3rem))] ${alignEnd ? 'sm:right-0 sm:left-auto' : ''} ${above ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]'}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <TimeDialPicker value={value} onChange={onChange} exactMinutes={exactMinutes} />
          </div>
        </>
      )}
    </div>
  );
}
