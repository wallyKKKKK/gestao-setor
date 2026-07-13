'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

export type SystemToastTone = 'info' | 'success' | 'warning' | 'error'

export interface SystemToastInput {
  title?: string
  description?: string
  tone?: SystemToastTone
  durationMs?: number
  onClick?: () => void
}

interface SystemToastItem extends Required<Pick<SystemToastInput, 'title' | 'tone'>> {
  id: string
  description?: string
  durationMs: number
  onClick?: () => void
}

const TOAST_EVENT = 'wally-system-toast'
const DEFAULT_DURATION_MS = 5200

function normalizeAlertMessage(message: unknown) {
  if (message instanceof Error) return message.message
  if (typeof message === 'string') return message
  if (message === undefined || message === null) return ''

  try {
    return JSON.stringify(message)
  } catch {
    return String(message)
  }
}

function inferTone(message: string): SystemToastTone {
  const normalized = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/(sucesso|salv[oa]|atualizad|importad|exportad|ativad|concluid)/.test(normalized)) return 'success'
  if (/(bloquead|permissao|selecione|preencha|informe|confirme|expirou|reconecte)/.test(normalized)) return 'warning'
  if (/(erro|falha|nao foi possivel|nao consigo|invalid|excluir)/.test(normalized)) return 'error'
  return 'info'
}

function splitAlertMessage(message: string) {
  const cleanMessage = message.trim()
  if (!cleanMessage) {
    return { title: 'Aviso do sistema', description: undefined }
  }

  const colonIndex = cleanMessage.indexOf(':')
  if (colonIndex > 0 && colonIndex <= 48) {
    return {
      title: cleanMessage.slice(0, colonIndex).trim(),
      description: cleanMessage.slice(colonIndex + 1).trim() || undefined,
    }
  }

  return {
    title: inferTone(cleanMessage) === 'success' ? 'Tudo certo' : 'Aviso do sistema',
    description: cleanMessage,
  }
}

export function showSystemToast(input: string | SystemToastInput) {
  if (typeof window === 'undefined') return

  const detail = typeof input === 'string'
    ? { description: input }
    : input

  window.dispatchEvent(new CustomEvent<SystemToastInput>(TOAST_EVENT, { detail }))
}

export function SystemToastProvider() {
  const [toasts, setToasts] = useState<SystemToastItem[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const pushToast = useCallback((input: SystemToastInput) => {
    const rawMessage = normalizeAlertMessage(input.description || input.title)
    const inferred = splitAlertMessage(rawMessage)
    const title = input.title || inferred.title
    const description = input.description || inferred.description
    const tone = input.tone || inferTone(`${title} ${description || ''}`)
    const id = `toast:${Date.now()}:${Math.random().toString(16).slice(2)}`

    setToasts((current) => [
      ...current.slice(-4),
      {
        id,
        title,
        description,
        tone,
        durationMs: input.durationMs || DEFAULT_DURATION_MS,
        onClick: input.onClick,
      },
    ])
  }, [])

  useEffect(() => {
    const handleToast = (event: Event) => {
      const detail = (event as CustomEvent<SystemToastInput>).detail
      pushToast(detail || { title: 'Aviso do sistema' })
    }

    window.addEventListener(TOAST_EVENT, handleToast)
    return () => window.removeEventListener(TOAST_EVENT, handleToast)
  }, [pushToast])

  useEffect(() => {
    const nativeAlert = window.alert

    window.alert = (message?: unknown) => {
      const text = normalizeAlertMessage(message)
      const parsed = splitAlertMessage(text)
      pushToast({
        ...parsed,
        tone: inferTone(text),
        durationMs: inferTone(text) === 'error' ? 7600 : DEFAULT_DURATION_MS,
      })
    }

    return () => {
      window.alert = nativeAlert
    }
  }, [pushToast])

  const timersRef = useRef<Map<string, number>>(new Map())

  // Agenda um timer por toast apenas uma vez, sem reiniciar os já existentes
  // quando um novo toast chega.
  useEffect(() => {
    const timers = timersRef.current

    toasts.forEach((toast) => {
      if (timers.has(toast.id)) return
      const handle = window.setTimeout(() => dismiss(toast.id), toast.durationMs)
      timers.set(toast.id, handle)
    })

    for (const id of Array.from(timers.keys())) {
      if (!toasts.some((toast) => toast.id === id)) {
        window.clearTimeout(timers.get(id))
        timers.delete(id)
      }
    }
  }, [dismiss, toasts])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((handle) => window.clearTimeout(handle))
      timers.clear()
    }
  }, [])

  return (
    <div className="pointer-events-none fixed right-3 top-20 z-[500] flex w-[min(390px,calc(100vw-1.5rem))] flex-col gap-2 sm:right-5">
      {toasts.map((toast) => (
        <SystemToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  )
}

function SystemToastCard({ toast, onDismiss }: { toast: SystemToastItem; onDismiss: (id: string) => void }) {
  const [progress, setProgress] = useState(1)

  const toneMeta = useMemo(() => {
    if (toast.tone === 'success') return {
      Icon: CheckCircle2,
      iconClassName: 'bg-emerald-600 text-white',
      barClassName: 'bg-emerald-500',
    }
    if (toast.tone === 'warning') return {
      Icon: AlertTriangle,
      iconClassName: 'bg-amber-500 text-white',
      barClassName: 'bg-amber-400',
    }
    if (toast.tone === 'error') return {
      Icon: XCircle,
      iconClassName: 'bg-red-600 text-white',
      barClassName: 'bg-red-500',
    }
    return {
      Icon: Info,
      iconClassName: 'bg-blue-600 text-white',
      barClassName: 'bg-blue-500',
    }
  }, [toast.tone])

  const Icon = toneMeta.Icon

  useEffect(() => {
    const duration = Math.max(toast.durationMs, 1)
    const startedAt = performance.now()
    let frame = 0

    const updateProgress = (timestamp: number) => {
      const elapsed = timestamp - startedAt
      const nextProgress = Math.max(0, 1 - elapsed / duration)
      setProgress(nextProgress)

      if (nextProgress > 0) {
        frame = window.requestAnimationFrame(updateProgress)
      }
    }

    frame = window.requestAnimationFrame(updateProgress)

    return () => window.cancelAnimationFrame(frame)
  }, [toast.durationMs, toast.id])

  return (
    <div
      role="status"
      className={`pointer-events-auto overflow-hidden rounded-2xl border border-slate-200 bg-[var(--app-surface)] text-[var(--app-text)] shadow-[0_22px_60px_rgba(15,23,42,0.22)] ${toast.onClick ? 'cursor-pointer transition hover:-translate-y-0.5 hover:shadow-[0_26px_70px_rgba(15,23,42,0.26)]' : ''}`}
      onClick={() => {
        toast.onClick?.()
        if (toast.onClick) onDismiss(toast.id)
      }}
    >
      <div className="h-1 bg-slate-100">
        <div
          aria-hidden="true"
          className={`h-full ${toneMeta.barClassName}`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <div className="flex gap-3 p-3.5">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${toneMeta.iconClassName}`}>
          <Icon size={18} strokeWidth={2.7} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--app-text)]">
            {toast.title}
          </p>
          {toast.description && (
            <p className="mt-1 text-[12px] font-bold leading-relaxed text-[var(--app-text-muted)]">
              {toast.description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onDismiss(toast.id)
          }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label="Fechar aviso"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
