import { useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Activity, AlertTriangle, BarChart3, Boxes, Clock, History, KeyRound, LayoutDashboard, LogOut, Menu, Radio, ScanLine, Users, Wifi, WifiOff, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useHardware } from '../context/HardwareContext'
import { useToast } from '../context/ToastContext'
import { api, ApiError } from '../api/client'
import { Button, Field, Modal } from './ui'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/scanner', label: 'RFID Scanner', icon: ScanLine },
  { to: '/components', label: 'Components', icon: Boxes },
  { to: '/students', label: 'Students', icon: Users, admin: true },
  { to: '/loans', label: 'Issue & Return', icon: Clock },
  { to: '/overdue', label: 'Overdue', icon: AlertTriangle },
  { to: '/history', label: 'History', icon: History },
  { to: '/reports', label: 'Reports', icon: BarChart3, admin: true },
  { to: '/activity', label: 'Activity log', icon: Activity, admin: true },
]

export function HardwarePill() {
  const { status, reachable } = useHardware()
  if (!reachable) return <Pill tone="red" icon={WifiOff} text="Server offline" />
  if (!status) return <Pill tone="slate" icon={Radio} text="Checking hardware…" />
  if (!status.connected) return <Pill tone="red" icon={WifiOff} text="Arduino disconnected" />
  if (status.rfid_reader === false) return <Pill tone="amber" icon={Wifi} text={`${status.port} · reader fault`} />
  return <Pill tone="green" icon={Wifi} text={`Arduino · ${status.port}`} pulse />
}

function Pill({ tone, icon: Icon, text, pulse }: { tone: 'green' | 'red' | 'amber' | 'slate'; icon: typeof Wifi; text: string; pulse?: boolean }) {
  const cls = { green: 'bg-emerald-50 text-emerald-700 ring-emerald-200', red: 'bg-rose-50 text-rose-700 ring-rose-200', amber: 'bg-amber-50 text-amber-700 ring-amber-200', slate: 'bg-slate-100 text-slate-600 ring-slate-200' }[tone]
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${cls}`}>
      <span className="relative flex h-2 w-2">
        {pulse && <span className="absolute inline-flex h-full w-full animate-ping2 rounded-full bg-current" />}
        <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
      </span>
      <Icon className="h-3.5 w-3.5" /> {text}
    </span>
  )
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [cur, setCur] = useState(''), [next, setNext] = useState(''), [busy, setBusy] = useState(false)
  const [err, setErr] = useState<{ field?: string; msg: string } | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await api('/auth/change-password', { method: 'POST', body: { current_password: cur, new_password: next } })
      toast.success('Password changed'); onClose()
    } catch (x) { const a = x as ApiError; setErr({ field: a.field, msg: a.message }) } finally { setBusy(false) }
  }
  return (
    <Modal title="Change password" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Current password" error={err?.field === 'current_password' ? err.msg : undefined}><input type="password" className="input" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required /></Field>
        <Field label="New password" hint="At least 8 characters" error={err?.field === 'new_password' ? err.msg : undefined}><input type="password" className="input" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={8} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Update</Button></div>
      </form>
    </Modal>
  )
}

export function Layout(): ReactNode {
  const { user, isAdmin, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState(false)
  const loc = useLocation()
  const items = NAV.filter((n) => !n.admin || isAdmin).map((n) => (n.to === '/loans' && !isAdmin ? { ...n, label: 'My Loans' } : n))

  const sidebar = (
    <div className="flex h-full flex-col bg-gradient-to-b from-navy-900 to-navy-950 text-slate-300">
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="rounded-xl bg-brand-600 p-2 shadow-lg shadow-brand-600/40"><Radio className="h-5 w-5 text-white" /></div>
        <div>
          <p className="text-lg font-bold leading-none tracking-tight text-white">SmartLab</p>
          <p className="mt-1 text-[11px] uppercase tracking-widest text-brand-300">RFID Cabinet</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}
            className={({ isActive }) => `group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${isActive ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/25' : 'hover:bg-white/5 hover:text-white'}`}>
            <n.icon className="h-[18px] w-[18px] transition group-hover:scale-110" /> {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="m-3 rounded-2xl bg-white/5 p-4">
        <p className="truncate text-sm font-semibold text-white">{user?.full_name ?? user?.username}</p>
        <p className="mb-3 text-xs capitalize text-brand-300">{user?.role}{user?.roll_no ? ` · ${user.roll_no}` : ''}</p>
        <div className="flex gap-2">
          <button onClick={() => setPw(true)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/5 py-2 text-xs font-medium transition hover:bg-white/10"><KeyRound className="h-3.5 w-3.5" /> Password</button>
          <button onClick={logout} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/5 py-2 text-xs font-medium transition hover:bg-rose-500/80 hover:text-white"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm animate-fade-in" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 animate-slide-in">{sidebar}
            <button onClick={() => setOpen(false)} className="absolute right-3 top-5 rounded-lg p-1.5 text-slate-400 hover:text-white" aria-label="Close menu"><X className="h-5 w-5" /></button>
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200/70 bg-white/80 px-4 py-3 backdrop-blur-md sm:px-8">
        <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
        <p className="hidden text-sm text-slate-500 lg:block">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <HardwarePill />
      </header>
      <main key={loc.pathname} className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8"><Outlet /></main>
      {pw && <ChangePassword onClose={() => setPw(false)} />}
    </div>
  )
}
