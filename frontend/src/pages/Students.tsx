import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { History, KeyRound, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { api, ApiError } from '../api/client'
import type { Student } from '../api/types'
import { UidInput } from '../components/UidInput'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Modal, PageHeader, PageLoader, SearchInput } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { useApi, useDebounced } from '../hooks'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const PHONE = /^\+?[0-9 -]{7,15}$/

export default function Students() {
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [dept, setDept] = useState('')
  const q = useDebounced(search)
  const { data, loading, error, reload, reloadWithSpinner } = useApi<{ students: Student[]; departments: string[] }>('/students', { search: q, department: dept })
  const [edit, setEdit] = useState<Student | 'new' | null>(null)
  const [acct, setAcct] = useState<Student | null>(null)
  const [del, setDel] = useState<Student | null>(null)

  return (
    <>
      <PageHeader title="Students" subtitle="Manage borrowers, ID cards and logins." actions={<Button onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> Add student</Button>} />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <div className="sm:w-80"><SearchInput value={search} onChange={setSearch} placeholder="Search name, roll no, email…" /></div>
        <select className="input sm:w-56" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {data?.departments.map((d) => <option key={d}>{d}</option>)}
        </select>
      </div>

      {error && !data ? <ErrorBox message={error} onRetry={reloadWithSpinner} /> : loading && !data ? <PageLoader /> : (
        <div className="card overflow-hidden animate-fade-up">
          {data?.students.length === 0 ? <EmptyState title="No students found" text="Add a student or adjust the filters." /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="border-b border-slate-100 bg-slate-50/70"><tr>{['Student', 'Department', 'ID card', 'Loans', 'Login', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data?.students.map((s) => (
                    <tr key={s.student_id} className="transition hover:bg-slate-50/70">
                      <td className="td"><p className="font-semibold text-slate-800">{s.full_name}</p><p className="text-xs text-slate-500">{s.roll_no}{s.year_sem ? ` · ${s.year_sem}` : ''}</p></td>
                      <td className="td text-slate-600">{s.department ?? '—'}</td>
                      <td className="td font-mono text-xs text-slate-500">{s.rfid_uid ?? <span className="font-sans text-slate-300">not assigned</span>}</td>
                      <td className="td"><div className="flex gap-1.5"><Badge tone="blue">{s.active_loans} active</Badge>{s.overdue_loans > 0 && <Badge tone="red">{s.overdue_loans} overdue</Badge>}</div></td>
                      <td className="td">{s.has_login ? <Badge tone="green" dot>{s.username}</Badge> : <Badge>No login</Badge>}</td>
                      <td className="td"><div className="flex justify-end gap-0.5">
                        <Link to={`/history?student_id=${s.student_id}`} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-brand-600" aria-label={`History of ${s.full_name}`} title="Borrowing history"><History className="h-4 w-4" /></Link>
                        <button className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-brand-600" onClick={() => setAcct(s)} aria-label="Manage login" title={s.has_login ? 'Reset password' : 'Create login'}><KeyRound className="h-4 w-4" /></button>
                        <button className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-brand-600" onClick={() => setEdit(s)} aria-label={`Edit ${s.full_name}`}><Pencil className="h-4 w-4" /></button>
                        <button className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600" onClick={() => setDel(s)} aria-label={`Delete ${s.full_name}`}><Trash2 className="h-4 w-4" /></button>
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {edit && <StudentForm student={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { toast.success(edit === 'new' ? 'Student added' : 'Student updated'); setEdit(null); void reload() }} />}
      {acct && <AccountForm student={acct} onClose={() => setAcct(null)} onSaved={() => { toast.success(acct.has_login ? 'Password reset' : 'Login created'); setAcct(null); void reload() }} />}
      {del && <ConfirmDialog title="Delete student" message={`Delete ${del.full_name} (${del.roll_no}) and their login? Students with borrowing history cannot be deleted.`} onClose={() => setDel(null)}
        onConfirm={async () => { try { await api(`/students/${del.student_id}`, { method: 'DELETE' }); toast.success('Student deleted'); void reload() } catch (e) { toast.error('Cannot delete', (e as ApiError).message) } setDel(null) }} />}
    </>
  )
}

function StudentForm({ student, onClose, onSaved }: { student: Student | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ roll_no: student?.roll_no ?? '', full_name: student?.full_name ?? '', rfid_uid: student?.rfid_uid ?? '', department: student?.department ?? '', year_sem: student?.year_sem ?? '', phone: student?.phone ?? '', email: student?.email ?? '', username: '', password: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!f.full_name.trim()) errs.full_name = 'Full name is required'
    if (!f.roll_no.trim()) errs.roll_no = 'Roll number is required'
    if (f.email && !EMAIL.test(f.email)) errs.email = 'Invalid email'
    if (f.phone && !PHONE.test(f.phone)) errs.phone = 'Invalid phone number'
    if (f.rfid_uid && !/^[0-9A-Fa-f:\s-]{8,29}$/.test(f.rfid_uid)) errs.rfid_uid = 'Invalid UID'
    if (!student && (f.username || f.password) && (!f.username || f.password.length < 8)) errs.password = 'Login needs a username and a password of 8+ characters'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const body: Record<string, string> = { ...f }
      if (student || !f.username) { delete body.username; delete body.password }
      await api(student ? `/students/${student.student_id}` : '/students', { method: student ? 'PUT' : 'POST', body })
      onSaved()
    } catch (x) {
      const a = x as ApiError
      if (a.field) setErrors({ [a.field]: a.message }); else toast.error('Could not save', a.message)
    } finally { setBusy(false) }
  }

  return (
    <Modal title={student ? 'Edit student' : 'Add student'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={errors.full_name}><input className={`input ${errors.full_name ? 'input-error' : ''}`} value={f.full_name} onChange={set('full_name')} autoFocus /></Field>
          <Field label="Roll number" error={errors.roll_no}><input className={`input ${errors.roll_no ? 'input-error' : ''}`} value={f.roll_no} onChange={set('roll_no')} /></Field>
          <Field label="Department" error={errors.department}><input className="input" value={f.department} onChange={set('department')} /></Field>
          <Field label="Year / Sem" error={errors.year_sem}><input className="input" value={f.year_sem} onChange={set('year_sem')} /></Field>
          <Field label="Phone" error={errors.phone}><input className={`input ${errors.phone ? 'input-error' : ''}`} value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
          <Field label="Email" error={errors.email}><input className={`input ${errors.email ? 'input-error' : ''}`} value={f.email} onChange={set('email')} type="email" /></Field>
        </div>
        <Field label="ID card UID (optional)" error={errors.rfid_uid} hint="Lets the scanner identify the student"><UidInput value={f.rfid_uid} onChange={(v) => setF((p) => ({ ...p, rfid_uid: v }))} error={errors.rfid_uid} /></Field>
        {!student && (
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><ShieldCheck className="h-4 w-4 text-brand-600" /> Login (optional)</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Username" error={errors.username}><input className="input" value={f.username} onChange={set('username')} autoComplete="off" /></Field>
              <Field label="Password" error={errors.password}><input type="password" className="input" value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>{student ? 'Save changes' : 'Add student'}</Button></div>
      </form>
    </Modal>
  )
}

function AccountForm({ student, onClose, onSaved }: { student: Student; onClose: () => void; onSaved: () => void }) {
  const [username, setUsername] = useState(student.roll_no.toLowerCase().replace(/[^a-z0-9_.-]/g, ''))
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<{ field?: string; msg: string } | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 8) { setErr({ field: 'password', msg: 'Password must be at least 8 characters' }); return }
    setBusy(true); setErr(null)
    try { await api(`/students/${student.student_id}/account`, { method: 'POST', body: { username, password } }); onSaved() }
    catch (x) { const a = x as ApiError; setErr({ field: a.field, msg: a.message }) } finally { setBusy(false) }
  }
  return (
    <Modal title={student.has_login ? `Reset password · ${student.full_name}` : `Create login · ${student.full_name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Username" error={err?.field === 'username' ? err.msg : undefined}><input className="input" value={student.has_login ? student.username ?? '' : username} disabled={!!student.has_login} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="New password" hint="At least 8 characters" error={err?.field === 'password' ? err.msg : undefined}><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>{student.has_login ? 'Reset password' : 'Create login'}</Button></div>
      </form>
    </Modal>
  )
}
