import { Link } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Boxes, CalendarClock, CheckCircle2, PackageOpen, ScanLine, Users } from 'lucide-react'
import type { Issue, NameValue, TrendPoint } from '../api/types'
import { Badge, Button, EmptyState, ErrorBox, PageHeader, PageLoader, StatCard } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useHardware } from '../context/HardwareContext'
import { useApi } from '../hooks'
import { dueLabel, fmtDate, fmtDateTime } from '../lib'

interface Dash {
  role: 'admin' | 'student'
  status_counts: Record<string, number>; components_total: number
  upcoming_returns: { name: string; category: string | null; expected_return_date: string; overdue: number }[]
  trend: TrendPoint[]
  students_total?: number; active_loans?: number; overdue_loans?: number; due_soon?: number; issued_today?: number; returned_today?: number
  by_category?: NameValue[]
  recent?: { issue_id: number; component_name: string; student_name: string; returned: number; at: string }[]
  my_active?: Issue[]; my_overdue?: number; my_total?: number
}

const COLORS = { AVAILABLE: '#10b981', ISSUED: '#3b82f6', DAMAGED: '#f59e0b', LOST: '#ef4444' }

export default function Dashboard() {
  const { user, isAdmin } = useAuth()
  const { status } = useHardware()
  const { data, loading, error, reloadWithSpinner } = useApi<Dash>('/dashboard', undefined, 15000)
  if (loading && !data) return <PageLoader />
  if (error && !data) return <ErrorBox message={error} onRetry={reloadWithSpinner} />
  if (!data) return null

  const pie = (Object.keys(COLORS) as (keyof typeof COLORS)[]).map((k) => ({ name: k[0] + k.slice(1).toLowerCase(), value: data.status_counts[k] ?? 0, key: k })).filter((p) => p.value > 0)
  const trend = data.trend.map((t) => ({ ...t, label: new Date(t.date + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) }))

  return (
    <>
      <PageHeader title={`Hello, ${(user?.full_name ?? user?.username ?? '').split(' ')[0]}`} subtitle={isAdmin ? "Here's what's happening in the lab cabinet." : 'Your borrowed components and what is available.'}
        actions={<Link to="/scanner"><Button><ScanLine className="h-4 w-4" /> Open scanner</Button></Link>} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {isAdmin ? (
          <>
            <StatCard label="Components" value={data.components_total} icon={Boxes} hint={`${data.status_counts.AVAILABLE ?? 0} available`} delay={0} />
            <StatCard label="Active loans" value={data.active_loans ?? 0} icon={PackageOpen} tone="violet" hint={`${data.due_soon ?? 0} due within 3 days`} delay={60} />
            <StatCard label="Overdue" value={data.overdue_loans ?? 0} icon={AlertTriangle} tone="red" hint="Needs follow-up" delay={120} />
            <StatCard label="Students" value={data.students_total ?? 0} icon={Users} tone="green" hint={`${data.issued_today ?? 0} issued · ${data.returned_today ?? 0} returned today`} delay={180} />
          </>
        ) : (
          <>
            <StatCard label="Borrowed now" value={data.my_active?.length ?? 0} icon={PackageOpen} delay={0} />
            <StatCard label="My overdue" value={data.my_overdue ?? 0} icon={AlertTriangle} tone="red" delay={60} />
            <StatCard label="Total borrowed" value={data.my_total ?? 0} icon={CheckCircle2} tone="green" delay={120} />
            <StatCard label="Available now" value={data.status_counts.AVAILABLE ?? 0} icon={Boxes} tone="violet" delay={180} />
          </>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2 animate-fade-up" style={{ animationDelay: '120ms' }}>
          <h3 className="font-semibold text-navy-900">{isAdmin ? 'Activity - last 14 days' : 'My activity - last 14 days'}</h3>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ left: -20, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="gi" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} /><stop offset="95%" stopColor="#2563eb" stopOpacity={0} /></linearGradient>
                  <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="issued" name="Issued" stroke="#2563eb" strokeWidth={2.5} fill="url(#gi)" />
                <Area type="monotone" dataKey="returned" name="Returned" stroke="#10b981" strokeWidth={2.5} fill="url(#gr)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-5 animate-fade-up" style={{ animationDelay: '180ms' }}>
          <h3 className="font-semibold text-navy-900">Inventory status</h3>
          <div className="mt-2 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3} stroke="none">
                  {pie.map((p) => <Cell key={p.key} fill={COLORS[p.key]} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {!isAdmin && (
          <div className="card animate-fade-up lg:col-span-2" style={{ animationDelay: '220ms' }}>
            <div className="border-b border-slate-100 px-5 py-4"><h3 className="font-semibold text-navy-900">My borrowed components</h3></div>
            {data.my_active?.length ? (
              <ul className="divide-y divide-slate-100">
                {data.my_active.map((i) => { const d = dueLabel(i.expected_return_date); return (
                  <li key={i.issue_id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0"><p className="truncate font-medium text-slate-800">{i.component_name}</p><p className="text-xs text-slate-500">Return by {fmtDate(i.expected_return_date)}</p></div>
                    <Badge tone={d.tone === 'slate' ? 'slate' : d.tone} dot>{d.text}</Badge>
                  </li>) })}
              </ul>
            ) : <EmptyState title="Nothing borrowed" text="Scan a component tag to borrow it." />}
          </div>
        )}

        <div className="card animate-fade-up" style={{ animationDelay: '240ms' }}>
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4"><CalendarClock className="h-4 w-4 text-brand-600" /><h3 className="font-semibold text-navy-900">Expected returns</h3></div>
          {data.upcoming_returns.length ? (
            <ul className="divide-y divide-slate-100">
              {data.upcoming_returns.map((u, i) => { const d = dueLabel(u.expected_return_date); return (
                <li key={i} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-800">{u.name}</p><p className="text-xs text-slate-500">{fmtDate(u.expected_return_date)}</p></div>
                  <Badge tone={d.tone === 'slate' ? 'slate' : d.tone}>{d.text}</Badge>
                </li>) })}
            </ul>
          ) : <EmptyState title="All components are in the cabinet" />}
        </div>

        {isAdmin && (
          <div className="card animate-fade-up" style={{ animationDelay: '300ms' }}>
            <div className="border-b border-slate-100 px-5 py-4"><h3 className="font-semibold text-navy-900">Recent activity</h3></div>
            {data.recent?.length ? (
              <ul className="divide-y divide-slate-100">
                {data.recent.map((r) => (
                  <li key={`${r.issue_id}-${r.returned}`} className="flex items-center gap-3 px-5 py-3">
                    <div className={`rounded-lg p-2 ${r.returned ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-50 text-brand-600'}`}>{r.returned ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}</div>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm text-slate-800"><b>{r.student_name}</b> {r.returned ? 'returned' : 'borrowed'} {r.component_name}</p><p className="text-xs text-slate-500">{fmtDateTime(r.at)}</p></div>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No activity yet" />}
          </div>
        )}
      </div>

      {isAdmin && status && !status.connected && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 animate-fade-up">
          <b>Arduino not connected.</b> {status.last_error ?? 'Plug it in via USB and upload the firmware.'} Issue/return still work, but the cabinet latch and tag scanning need the hardware.
        </div>
      )}
    </>
  )
}
