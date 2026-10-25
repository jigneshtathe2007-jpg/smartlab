import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Clock, Download, PackageOpen, Percent, Undo2 } from 'lucide-react'
import { download } from '../api/client'
import type { Issue, NameValue, TrendPoint } from '../api/types'
import { Badge, Button, EmptyState, ErrorBox, PageHeader, PageLoader, StatCard } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { useApi } from '../hooks'
import { fmtDate } from '../lib'

interface Summary {
  days: number; total_loans: number; returned: number; avg_loan_days: number | null; on_time_rate: number | null
  daily: TrendPoint[]; top_components: { name: string; loans: number }[]; top_students: { name: string; roll_no: string; loans: number }[]
  by_department: NameValue[]; by_category: NameValue[]; overdue: Issue[]
}
const PALETTE = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#64748b']
const tip = { contentStyle: { borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 } }

export default function Reports() {
  const toast = useToast()
  const [days, setDays] = useState(30)
  const [busy, setBusy] = useState('')
  const { data, loading, error, reloadWithSpinner } = useApi<Summary>('/reports/summary', { days })

  const exp = async (type: string) => {
    setBusy(type)
    try { await download('/reports/export', { type }, `smartlab_${type}.csv`); toast.success('Export ready', `${type}.csv downloaded`) }
    catch (e) { toast.error('Export failed', (e as Error).message) } finally { setBusy('') }
  }

  if (error && !data) return <ErrorBox message={error} onRetry={reloadWithSpinner} />
  if (loading && !data) return <PageLoader />
  if (!data) return null
  const daily = data.daily.map((d) => ({ ...d, label: new Date(d.date + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) }))

  return (
    <>
      <PageHeader title="Reports" subtitle="Usage analytics for the cabinet."
        actions={<>
          <select className="input !w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Range">
            {[[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last year']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </>} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Loans" value={data.total_loans} icon={PackageOpen} delay={0} />
        <StatCard label="Returned" value={data.returned} icon={Undo2} tone="green" delay={50} />
        <StatCard label="Avg days out" value={Math.round(data.avg_loan_days ?? 0)} icon={Clock} tone="violet" hint={data.avg_loan_days === null ? 'No returns yet' : `${data.avg_loan_days} days`} delay={100} />
        <StatCard label="On-time %" value={data.on_time_rate ?? 0} icon={Percent} tone="amber" hint={data.on_time_rate === null ? 'No returns yet' : 'Returned by due date'} delay={150} />
        <StatCard label="Overdue now" value={data.overdue.length} icon={AlertTriangle} tone="red" delay={200} />
      </div>

      <div className="card mt-6 p-5 animate-fade-up">
        <h3 className="font-semibold text-navy-900">Loans per day</h3>
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={daily} margin={{ left: -20, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
              <Tooltip {...tip} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="issued" name="Issued" stroke="#2563eb" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="returned" name="Returned" stroke="#10b981" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card p-5 animate-fade-up">
          <h3 className="font-semibold text-navy-900">Most borrowed components</h3>
          {data.top_components.length ? (
            <div className="mt-4 h-72"><ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.top_components} layout="vertical" margin={{ left: 10, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: '#475569' }} tickLine={false} axisLine={false} />
                <Tooltip {...tip} cursor={{ fill: '#eff6ff' }} />
                <Bar dataKey="loans" name="Loans" fill="#2563eb" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer></div>
          ) : <EmptyState title="No loans in this period" />}
        </div>
        <div className="card p-5 animate-fade-up">
          <h3 className="font-semibold text-navy-900">Loans by department</h3>
          {data.by_department.length ? (
            <div className="mt-4 h-72"><ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.by_department} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={3} stroke="none">{data.by_department.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Pie>
                <Tooltip {...tip} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer></div>
          ) : <EmptyState title="No loans in this period" />}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card animate-fade-up">
          <div className="border-b border-slate-100 px-5 py-4"><h3 className="font-semibold text-navy-900">Top borrowers</h3></div>
          {data.top_students.length ? (
            <ul className="divide-y divide-slate-100">{data.top_students.map((s, i) => (
              <li key={s.roll_no + i} className="flex items-center gap-3 px-5 py-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{i + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-800">{s.name}</p><p className="text-xs text-slate-500">{s.roll_no}</p></div><Badge tone="blue">{s.loans} loans</Badge></li>
            ))}</ul>
          ) : <EmptyState title="No data" />}
        </div>
        <div className="card animate-fade-up">
          <div className="border-b border-slate-100 px-5 py-4"><h3 className="font-semibold text-navy-900">Overdue components</h3></div>
          {data.overdue.length ? (
            <ul className="divide-y divide-slate-100">{data.overdue.map((o) => (
              <li key={o.issue_id} className="flex items-center gap-3 px-5 py-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-800">{o.component_name}</p><p className="text-xs text-slate-500">{o.student_name} · due {fmtDate(o.expected_return_date)}</p></div><Badge tone="red" dot>{o.days_overdue}d late</Badge></li>
            ))}</ul>
          ) : <EmptyState title="Nothing overdue" />}
        </div>
      </div>

      <div className="card mt-6 flex flex-wrap items-center gap-3 p-5 animate-fade-up">
        <div className="mr-auto"><h3 className="font-semibold text-navy-900">Export data</h3><p className="text-sm text-slate-500">Download CSV files for spreadsheets or records.</p></div>
        {[['issues', 'All loans'], ['overdue', 'Overdue'], ['inventory', 'Inventory'], ['students', 'Students']].map(([t, l]) => (
          <Button key={t} variant="secondary" loading={busy === t} onClick={() => exp(t)}>{busy !== t && <Download className="h-4 w-4" />}{l}</Button>
        ))}
      </div>
    </>
  )
}
