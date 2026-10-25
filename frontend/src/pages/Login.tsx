import { useState, type FormEvent } from 'react'
import { Cpu, Radio, ShieldCheck, Zap } from 'lucide-react'
import { ApiError } from '../api/client'
import { Button, Field } from '../components/ui'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [f, setF] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<{ field?: string; msg: string } | null>(null)
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }))
  const fe = (k: string) => (err?.field === k ? err.msg : undefined)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (mode === 'register' && (f.password ?? '').length < 8) { setErr({ field: 'password', msg: 'Password must be at least 8 characters' }); return }
    setBusy(true)
    try {
      if (mode === 'login') await login(f.username ?? '', f.password ?? '')
      else await register(f)
    } catch (x) {
      const a = x as ApiError
      setErr({ field: a.field, msg: a.message })
    } finally { setBusy(false) }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-navy-950 via-navy-900 to-navy-700 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-brand-400/10 blur-3xl" />
        <div className="relative flex items-center gap-3"><div className="rounded-xl bg-brand-600 p-2.5"><Radio className="h-6 w-6" /></div><span className="text-2xl font-bold">SmartLab</span></div>
        <div className="relative animate-fade-up">
          <h1 className="text-4xl font-bold leading-tight">Tap a tag.<br />Track every component.</h1>
          <p className="mt-4 max-w-md text-brand-200">RFID-powered cabinet management for your electronics lab: live inventory, return dates and overdue tracking, tied to the real cabinet latch.</p>
          <div className="mt-10 space-y-4 text-sm">
            {[[Zap, 'Instant issue & return by scanning tags'], [Cpu, 'Live Arduino + RC522 hardware status'], [ShieldCheck, 'Role-based access for admins and students']].map(([I, t], i) => {
              const Icon = I as typeof Zap
              return <div key={i} className="flex items-center gap-3"><div className="rounded-lg bg-white/10 p-2"><Icon className="h-4 w-4" /></div>{t as string}</div>
            })}
          </div>
        </div>
        <p className="relative text-xs text-brand-300/70">Diploma in Computer Engineering · Project</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md animate-fade-up">
          <div className="mb-8 flex items-center gap-3 lg:hidden"><div className="rounded-xl bg-brand-600 p-2 text-white"><Radio className="h-5 w-5" /></div><span className="text-xl font-bold text-navy-900">SmartLab</span></div>
          <h2 className="text-2xl font-bold text-navy-900">{mode === 'login' ? 'Welcome back' : 'Create student account'}</h2>
          <p className="mt-1 text-sm text-slate-500">{mode === 'login' ? 'Sign in to manage the lab cabinet.' : 'Register to borrow components from the cabinet.'}</p>

          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            {err && !err.field && <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700" role="alert">{err.msg}</p>}
            {mode === 'register' && (
              <>
                <Field label="Full name" error={fe('full_name')}><input className="input" value={f.full_name ?? ''} onChange={set('full_name')} required /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Roll no." error={fe('roll_no')}><input className="input" value={f.roll_no ?? ''} onChange={set('roll_no')} required /></Field>
                  <Field label="Year / Sem" error={fe('year_sem')}><input className="input" value={f.year_sem ?? ''} onChange={set('year_sem')} placeholder="TY-Sem5" /></Field>
                </div>
                <Field label="Department" error={fe('department')}><input className="input" value={f.department ?? ''} onChange={set('department')} placeholder="Computer Engineering" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Phone" error={fe('phone')}><input className="input" value={f.phone ?? ''} onChange={set('phone')} inputMode="tel" /></Field>
                  <Field label="Email" error={fe('email')}><input type="email" className="input" value={f.email ?? ''} onChange={set('email')} /></Field>
                </div>
              </>
            )}
            <Field label="Username" error={fe('username')}><input className="input" value={f.username ?? ''} onChange={set('username')} autoComplete="username" autoFocus required /></Field>
            <Field label="Password" error={fe('password')} hint={mode === 'register' ? 'At least 8 characters' : undefined}>
              <input type="password" className="input" value={f.password ?? ''} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
            </Field>
            <Button type="submit" loading={busy} className="w-full !py-3">{mode === 'login' ? 'Sign in' : 'Create account'}</Button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-500">
            {mode === 'login' ? 'New student?' : 'Already registered?'}{' '}
            <button className="font-semibold text-brand-600 hover:underline" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(null) }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button>
          </p>
        </div>
      </div>
    </div>
  )
}
