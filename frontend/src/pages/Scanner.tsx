import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, CircleHelp, Cpu, KeyRound, Lock, LockOpen, PackageSearch, RefreshCw, Search, UserCheck, WifiOff, X } from 'lucide-react'
import { api, ApiError } from '../api/client'
import type { Resolved, ScanEvent, Student } from '../api/types'
import { BorrowForm, ReturnForm } from '../components/LoanForms'
import { Badge, Button, PageHeader, StatusBadge } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useHardware } from '../context/HardwareContext'
import { useToast } from '../context/ToastContext'
import { useApi } from '../hooks'
import { dueLabel, fmtDate, timeAgo } from '../lib'

type StudentCtx = { student_id: number; full_name: string; roll_no: string }
interface ScanResp { latest_id: number; scans: { id: number; uid: string; ts: number; resolved: Resolved }[] }

export default function Scanner() {
  const { isAdmin } = useAuth()
  const { status, refresh } = useHardware()
  const toast = useToast()
  const nav = useNavigate()
  const students = useApi<{ students: Student[] }>(isAdmin ? '/students' : null)
  const [feed, setFeed] = useState<ScanEvent[]>([])
  const [active, setActive] = useState<ScanEvent | null>(null)
  const [student, setStudent] = useState<StudentCtx | null>(null)
  const [manual, setManual] = useState('')
  const [looking, setLooking] = useState(false)
  const [, tick] = useState(0)
  const cursor = useRef<number | null>(null)

  const handle = useCallback((ev: ScanEvent) => {
    setFeed((f) => [ev, ...f].slice(0, 12))
    const r = ev.resolved
    if (r.type === 'student') {
      if (r.student && isAdmin) { setStudent({ student_id: r.student.student_id, full_name: r.student.full_name, roll_no: r.student.roll_no }); toast.info('Student identified', r.student.full_name) }
      else if (!r.student) toast.info('Student card scanned', 'Details are only visible to administrators.')
      return
    }
    setActive(ev)
  }, [isAdmin, toast])

  // Poll the physical reader through the backend
  useEffect(() => {
    let stop = false
    const poll = async () => {
      try {
        if (cursor.current === null) { cursor.current = (await api<ScanResp>('/hardware/scans')).latest_id; return }
        const r = await api<ScanResp>('/hardware/scans', { params: { after: cursor.current } })
        if (stop) return
        r.scans.forEach((s) => handle({ ...s, source: 'reader' }))
        cursor.current = Math.max(cursor.current, r.latest_id)
      } catch { /* status pill shows connectivity problems */ }
    }
    void poll()
    const t = setInterval(poll, 1000)
    const clock = setInterval(() => tick((n) => n + 1), 15000)
    return () => { stop = true; clearInterval(t); clearInterval(clock) }
  }, [handle])

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!manual.trim()) return
    setLooking(true)
    try {
      const r = await api<{ uid: string; resolved: Resolved }>(`/lookup/${encodeURIComponent(manual.trim())}`)
      handle({ id: -Date.now(), uid: r.uid, ts: Date.now() / 1000, source: 'manual', resolved: r.resolved })
      setManual('')
    } catch (x) { toast.error('Lookup failed', (x as ApiError).message) } finally { setLooking(false) }
  }

  const finish = () => { setActive(null); void students.reload() }
  const testLatch = async () => {
    try { const r = await api<{ message: string }>('/hardware/unlock', { method: 'POST', body: {} }); toast.success('Latch opened', r.message) }
    catch (x) { toast.error('Latch not opened', (x as ApiError).message) }
    void refresh()
  }
  const reconnect = async () => { await api('/hardware/reconnect', { method: 'POST' }).catch(() => null); toast.info('Reconnecting…'); void refresh() }

  const connected = !!status?.connected
  return (
    <>
      <PageHeader title="RFID Scanner" subtitle="Hold a component tag over the reader, or type a UID. Admins can scan a student card first." />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-2">
          {/* Reader card */}
          <div className="card overflow-hidden animate-fade-up">
            <div className={`relative flex flex-col items-center px-6 py-10 text-center ${connected ? 'bg-gradient-to-b from-navy-900 to-navy-700 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {connected ? (
                <>
                  <div className="relative mb-4 flex h-28 w-28 items-center justify-center overflow-hidden rounded-3xl bg-white/10 ring-1 ring-white/20">
                    <Cpu className="h-12 w-12 text-brand-300" />
                    <span className="absolute left-3 right-3 h-0.5 animate-scan rounded bg-brand-400 shadow-[0_0_12px_2px_rgba(96,165,250,.8)]" />
                  </div>
                  <p className="text-lg font-semibold">{status?.rfid_reader === false ? 'Reader not responding' : 'Waiting for a tag…'}</p>
                  <p className="mt-1 text-sm text-brand-200">{status?.port} · {status?.baud} baud</p>
                </>
              ) : (
                <>
                  <div className="mb-4 rounded-3xl bg-white p-6 text-slate-400"><WifiOff className="h-12 w-12" /></div>
                  <p className="text-lg font-semibold">Arduino not connected</p>
                  <p className="mt-1 max-w-xs text-sm">{status?.last_error ?? 'Waiting for the backend…'}</p>
                </>
              )}
            </div>
            <div className="space-y-2 border-t border-slate-100 p-5 text-sm">
              <Row label="Serial link" value={<Badge tone={connected ? 'green' : 'red'} dot>{connected ? 'Connected' : 'Disconnected'}</Badge>} />
              <Row label="RC522 reader" value={status?.rfid_reader == null ? <Badge>Unknown</Badge> : <Badge tone={status.rfid_reader ? 'green' : 'red'} dot>{status.rfid_reader ? 'Detected' : 'Not detected'}</Badge>} />
              <Row label="Cabinet latch" value={status?.servo == null ? <Badge>Unknown</Badge> : <Badge tone={status.servo === 'LOCKED' ? 'blue' : 'amber'}>{status.servo === 'LOCKED' ? <><Lock className="h-3 w-3" /> Locked</> : <><LockOpen className="h-3 w-3" /> Open</>}</Badge>} />
              <Row label="Ports found" value={<span className="text-xs text-slate-500">{status?.available_ports.length ? status.available_ports.join(', ') : 'none'}</span>} />
              {isAdmin && (
                <div className="flex gap-2 pt-3">
                  <Button variant="secondary" className="flex-1" onClick={reconnect}><RefreshCw className="h-4 w-4" /> Reconnect</Button>
                  <Button variant="secondary" className="flex-1" onClick={testLatch} disabled={!connected}><LockOpen className="h-4 w-4" /> Test latch</Button>
                </div>
              )}
            </div>
          </div>

          <form onSubmit={lookup} className="card p-5 animate-fade-up" style={{ animationDelay: '80ms' }}>
            <p className="label">Look up by UID (manual)</p>
            <div className="flex gap-2">
              <input className="input font-mono uppercase" placeholder="A1B2C3D4" value={manual} onChange={(e) => setManual(e.target.value)} maxLength={24} />
              <Button type="submit" variant="secondary" loading={looking}><Search className="h-4 w-4" /></Button>
            </div>
            <p className="mt-2 text-xs text-slate-400">Manual lookups query the database only; they do not touch the hardware.</p>
          </form>

          <div className="card animate-fade-up" style={{ animationDelay: '140ms' }}>
            <div className="border-b border-slate-100 px-5 py-4"><h3 className="font-semibold text-navy-900">Recent scans</h3></div>
            {feed.length === 0 ? <p className="px-5 py-8 text-center text-sm text-slate-400">No scans yet this session</p> : (
              <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                {feed.map((s) => (
                  <li key={`${s.id}-${s.ts}`}>
                    <button onClick={() => s.resolved.type !== 'student' && setActive(s)} className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">{label(s.resolved)}</p>
                        <p className="font-mono text-xs text-slate-400">{s.uid}</p>
                      </div>
                      <div className="text-right"><Badge tone={s.source === 'reader' ? 'blue' : 'slate'}>{s.source === 'reader' ? 'Reader' : 'Manual'}</Badge><p className="mt-1 text-[11px] text-slate-400">{timeAgo(s.ts)}</p></div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-6 lg:col-span-3">
          {isAdmin && (
            <div className={`card flex items-center gap-3 p-4 animate-fade-up ${student ? 'border-brand-300 bg-brand-50/50' : ''}`}>
              <div className={`rounded-xl p-2.5 ${student ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-400'}`}><UserCheck className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-navy-900">{student ? student.full_name : 'No student selected'}</p>
                <p className="text-xs text-slate-500">{student ? `${student.roll_no} · will be pre-selected for the next issue` : 'Scan a student ID card to pre-fill the borrower'}</p>
              </div>
              {student && <button onClick={() => setStudent(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-700" aria-label="Clear student"><X className="h-4 w-4" /></button>}
            </div>
          )}

          {!active ? (
            <div className="card flex flex-col items-center px-6 py-20 text-center animate-fade-up">
              <div className="mb-4 rounded-2xl bg-brand-50 p-5 text-brand-500"><PackageSearch className="h-10 w-10" /></div>
              <p className="text-lg font-semibold text-navy-900">Scan a component to begin</p>
              <p className="mt-1 max-w-sm text-sm text-slate-500">Its details, availability and expected return date appear here, with the borrow or return form.</p>
            </div>
          ) : (
            <ActivePanel ev={active} student={student} students={students.data?.students} isAdmin={isAdmin} onDone={finish} onCancel={() => setActive(null)} onRegister={() => nav(`/components?new=${active.uid}`)} />
          )}
        </div>
      </div>
    </>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between"><span className="text-slate-500">{label}</span>{value}</div>
}

function label(r: Resolved) {
  if (r.type === 'component') return r.component.name
  if (r.type === 'student') return r.student ? `Student: ${r.student.full_name}` : 'Student card'
  return 'Unregistered tag'
}

function ActivePanel({ ev, student, students, isAdmin, onDone, onCancel, onRegister }:
  { ev: ScanEvent; student: StudentCtx | null; students?: Student[]; isAdmin: boolean; onDone: () => void; onCancel: () => void; onRegister: () => void }) {
  const r = ev.resolved
  if (r.type === 'unknown') {
    return (
      <div className="card flex flex-col items-center px-6 py-14 text-center animate-scale-in">
        <div className="mb-4 rounded-2xl bg-amber-50 p-5 text-amber-500"><CircleHelp className="h-10 w-10" /></div>
        <p className="text-lg font-semibold text-navy-900">Unregistered tag</p>
        <p className="mt-1 font-mono text-sm text-slate-500">{ev.uid}</p>
        <p className="mt-3 max-w-sm text-sm text-slate-500">{isAdmin ? 'This tag is not in the database yet.' : 'This tag is not registered. Please ask an administrator.'}</p>
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" onClick={onCancel}>Dismiss</Button>
          {isAdmin && <Button onClick={onRegister}><KeyRound className="h-4 w-4" /> Register as component</Button>}
        </div>
      </div>
    )
  }
  if (r.type !== 'component') return null
  const c = r.component
  const d = dueLabel(c.expected_return_date)
  return (
    <div className="card animate-scale-in" key={ev.uid + ev.ts}>
      <div className="flex items-start gap-4 border-b border-slate-100 p-5">
        <div className="rounded-2xl bg-brand-50 p-3 text-brand-600"><Cpu className="h-7 w-7" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-bold text-navy-900">{c.name}</h2>
          <p className="font-mono text-xs text-slate-400">{c.rfid_uid}</p>
          <p className="mt-1 text-sm text-slate-500">{[c.category, c.shelf_location].filter(Boolean).join(' · ') || 'No category'}</p>
        </div>
        <StatusBadge status={c.status} overdue={!!c.overdue} />
      </div>
      <div className="p-5">
        {c.status === 'AVAILABLE' && <BorrowForm component={c} students={students} defaultStudentId={student?.student_id} onDone={onDone} onCancel={onCancel} />}
        {c.status === 'ISSUED' && (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-4 text-sm">
              {isAdmin && c.holder_name && <p className="text-slate-600">Held by <b className="text-slate-900">{c.holder_name}</b> ({c.holder_roll})</p>}
              <p className="mt-1 text-slate-600">Expected back <b className="text-slate-900">{fmtDate(c.expected_return_date)}</b> <Badge tone={d.tone}>{d.text}</Badge></p>
            </div>
            {(isAdmin || c.mine) && c.issue_id
              ? <ReturnForm issue={{ issue_id: c.issue_id, component_name: c.name, expected_return_date: c.expected_return_date, student_name: c.holder_name }} onDone={onDone} onCancel={onCancel} />
              : <><p className="flex items-center gap-2 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4" /> Not available. It will be free around {fmtDate(c.expected_return_date)}.</p><Button variant="secondary" onClick={onCancel}>Close</Button></>}
          </div>
        )}
        {(c.status === 'DAMAGED' || c.status === 'LOST') && (
          <div className="space-y-4"><p className="text-sm text-slate-600">This component is marked <b>{c.status.toLowerCase()}</b> and cannot be issued.</p><Button variant="secondary" onClick={onCancel}>Close</Button></div>
        )}
      </div>
    </div>
  )
}
