import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

type Tone = 'success' | 'error' | 'warning' | 'info'
interface Toast { id: number; tone: Tone; title: string; text?: string }
interface Api { success: (t: string, d?: string) => void; error: (t: string, d?: string) => void; warning: (t: string, d?: string) => void; info: (t: string, d?: string) => void }

const Ctx = createContext<Api | null>(null)
let seq = 0

const STYLE: Record<Tone, { icon: typeof Info; cls: string }> = {
  success: { icon: CheckCircle2, cls: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  error: { icon: XCircle, cls: 'text-rose-600 bg-rose-50 border-rose-200' },
  warning: { icon: AlertTriangle, cls: 'text-amber-600 bg-amber-50 border-amber-200' },
  info: { icon: Info, cls: 'text-brand-600 bg-brand-50 border-brand-200' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const push = useCallback((tone: Tone, title: string, text?: string) => {
    const id = ++seq
    setToasts((t) => [...t.slice(-3), { id, tone, title, text }])
    setTimeout(() => dismiss(id), tone === 'error' || tone === 'warning' ? 7000 : 4000)
  }, [dismiss])
  const api = useMemo<Api>(() => ({
    success: (t, d) => push('success', t, d), error: (t, d) => push('error', t, d),
    warning: (t, d) => push('warning', t, d), info: (t, d) => push('info', t, d),
  }), [push])

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => {
          const S = STYLE[t.tone]
          return (
            <div key={t.id} className={`pointer-events-auto flex animate-slide-in items-start gap-3 rounded-xl border p-3.5 shadow-lg ${S.cls}`}>
              <S.icon className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">{t.title}</p>
                {t.text && <p className="mt-0.5 text-sm text-slate-600">{t.text}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} className="rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Dismiss"><X className="h-4 w-4" /></button>
            </div>
          )
        })}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useToast outside provider')
  return c
}
