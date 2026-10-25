import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, PackageCheck, PackagePlus, X } from 'lucide-react'
import type { Component, Issue, Student } from '../api/types'
import { BorrowForm, ReturnForm } from '../components/LoanForms'
import { Badge, Button, EmptyState, ErrorBox, Field, Modal, PageHeader, PageLoader, SearchInput } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useApi, useDebounced } from '../hooks'
import { dueLabel, fmtDate, fmtDateTime } from '../lib'

const PAGE = 25
type Mode = 'active' | 'overdue' | 'history'
const META: Record<Mode, { title: string; sub: string }> = {
  active: { title: 'Issue & Return', sub: 'Components currently out of the cabinet, with their expected return dates.' },
  overdue: { title: 'Overdue', sub: 'Components that are past their expected return date.' },
  history: { title: 'Borrowing History', sub: 'Every issue and return recorded in the cabinet.' },
}

export default function Loans({ mode }: { mode: Mode }) {
  const { isAdmin } = useAuth()
  const [sp, setSp] = useSearchParams()
  const studentId = sp.get('student_id') ?? ''
  const [search, setSearch] = useState('')
  const [histStatus, setHistStatus] = useState('all')
  const [from, setFrom] = useState(''), [to, setTo] = useState('')
  const [page, setPage] = useState(0)
  const q = useDebounced(search)
  useEffect(() => setPage(0), [q, histStatus, from, to, mode, studentId])

  const status = mode === 'history' ? histStatus : mode
  const { data, loading, error, reload, reloadWithSpinner } = useApi<{ issues: Issue[]; total: number }>('/issues', { status, search: q, student_id: studentId, from, to, limit: PAGE, offset: page * PAGE })
  const [ret, setRet] = useState<Issue | null>(null)
  const [issueOpen, setIssueOpen] = useState(false)
  const [pick, setPick] = useState<Component | null>(null)
  const avail = useApi<{ components: Component[] }>(issueOpen ? '/components' : null, { status: 'AVAILABLE' })
  const students = useApi<{ students: Student[] }>(isAdmin && issueOpen ? '/students' : null)
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE))
  const meta = META[mode]
  const title = !isAdmin && mode === 'active' ? 'My Loans' : meta.title
  const done = () => { setRet(null); setIssueOpen(false); setPick(null); void reload() }
  const showReturned = mode === 'history'

  return (
    <>
      <PageHeader title={title} subtitle={isAdmin ? meta.sub : `${meta.sub} Showing only your records.`}
        actions={mode === 'active' && <Button onClick={() => setIssueOpen(true)}><PackagePlus className="h-4 w-4" /> Issue component</Button>} />

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="lg:w-80"><SearchInput value={search} onChange={setSearch} placeholder="Search component, student, purpose…" /></div>
        {mode === 'history' && (
          <>
            <select className="input lg:w-44" value={histStatus} onChange={(e) => setHistStatus(e.target.value)} aria-label="Status">
              <option value="all">All records</option><option value="active">Active</option><option value="overdue">Overdue</option><option value="returned">Returned</option>
            </select>
            <div className="flex items-center gap-2"><input type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /><span className="text-slate-400">to</span><input type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" /></div>
          </>
        )}
        {studentId && isAdmin && <button onClick={() => setSp({})} className="inline-flex items-center gap-1.5 self-start rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-200">Filtered by student #{studentId} <X className="h-3.5 w-3.5" /></button>}
      </div>

      {error && !data ? <ErrorBox message={error} onRetry={reloadWithSpinner} /> : loading && !data ? <PageLoader /> : (
        <div className="card overflow-hidden animate-fade-up">
          {data?.issues.length === 0 ? (
            <EmptyState title={mode === 'overdue' ? 'Nothing overdue 🎉' : 'No records found'} text={mode === 'overdue' ? 'Every component is back on time.' : 'Adjust the filters or issue a component.'} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead className="border-b border-slate-100 bg-slate-50/70"><tr>
                  <th className="th">Component</th>{isAdmin && <th className="th">Student</th>}<th className="th">Issued</th><th className="th">Expected return</th>{showReturned && <th className="th">Returned</th>}<th className="th">Status</th><th className="th" />
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data?.issues.map((i) => {
                    const d = dueLabel(i.expected_return_date)
                    return (
                      <tr key={i.issue_id} className={`transition hover:bg-slate-50/70 ${i.overdue ? 'bg-rose-50/30' : ''}`}>
                        <td className="td"><p className="font-semibold text-slate-800">{i.component_name}</p><p className="text-xs text-slate-500">{i.purpose || i.category || '—'}</p></td>
                        {isAdmin && <td className="td"><Link to={`/history?student_id=${i.student_id}`} className="font-medium text-slate-700 hover:text-brand-600">{i.student_name}</Link><p className="text-xs text-slate-500">{i.roll_no}</p></td>}
                        <td className="td text-slate-600">{fmtDateTime(i.issue_date)}</td>
                        <td className="td text-slate-600">{fmtDate(i.expected_return_date)}</td>
                        {showReturned && <td className="td text-slate-600">{i.actual_return_date ? fmtDateTime(i.actual_return_date) : '—'}</td>}
                        <td className="td">{i.returned ? <Badge tone="green" dot>Returned</Badge> : <Badge tone={d.tone} dot>{d.text}</Badge>}{!!i.remarks && <p className="mt-1 max-w-[12rem] truncate text-xs text-slate-400" title={i.remarks}>{i.remarks}</p>}</td>
                        <td className="td text-right">{!i.returned && <Button variant="secondary" className="!px-3 !py-1.5" onClick={() => setRet(i)}><PackageCheck className="h-4 w-4" /> Return</Button>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {data && data.total > PAGE && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
              <span>{page * PAGE + 1}–{Math.min((page + 1) * PAGE, data.total)} of {data.total}</span>
              <div className="flex gap-1"><Button variant="ghost" className="!p-2" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button><Button variant="ghost" className="!p-2" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button></div>
            </div>
          )}
        </div>
      )}

      {ret && <Modal title="Return component" onClose={() => setRet(null)}><ReturnForm issue={{ issue_id: ret.issue_id, component_name: ret.component_name, expected_return_date: ret.expected_return_date, student_name: isAdmin ? ret.student_name : null }} onDone={done} onCancel={() => setRet(null)} /></Modal>}
      {issueOpen && (
        <Modal title="Issue component" onClose={() => { setIssueOpen(false); setPick(null) }}>
          {!pick ? (
            <Field label="Choose an available component" hint="Or use the RFID Scanner to identify it by tag">
              {avail.loading ? <PageLoader /> : avail.data?.components.length ? (
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {avail.data.components.map((c) => (
                    <button key={c.component_id} onClick={() => setPick(c)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 p-3 text-left transition hover:border-brand-400 hover:bg-brand-50/50">
                      <span><span className="font-semibold text-slate-800">{c.name}</span><span className="block text-xs text-slate-500">{[c.category, c.shelf_location].filter(Boolean).join(' · ')}</span></span>
                      <Badge tone="green">Available</Badge>
                    </button>
                  ))}
                </div>
              ) : <p className="text-sm text-slate-500">No components are available right now.</p>}
            </Field>
          ) : <BorrowForm component={pick} students={students.data?.students} onDone={done} onCancel={() => setPick(null)} />}
        </Modal>
      )}
    </>
  )
}
