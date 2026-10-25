import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Cpu, MapPin, Pencil, PackageCheck, PackagePlus, Plus, Trash2, UserRound } from 'lucide-react'
import { api, ApiError } from '../api/client'
import type { Component, Student } from '../api/types'
import { BorrowForm, ReturnForm } from '../components/LoanForms'
import { UidInput } from '../components/UidInput'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Modal, PageHeader, SearchInput, Skeleton, StatusBadge } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useApi, useDebounced } from '../hooks'
import { dueLabel, fmtDate } from '../lib'

const FILTERS = [['', 'All'], ['AVAILABLE', 'Available'], ['ISSUED', 'Issued'], ['OVERDUE', 'Overdue'], ['DAMAGED', 'Damaged'], ['LOST', 'Lost']] as const

export default function Components() {
  const { isAdmin } = useAuth()
  const toast = useToast()
  const [sp, setSp] = useSearchParams()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const q = useDebounced(search)
  const { data, loading, error, reload, reloadWithSpinner } = useApi<{ components: Component[]; categories: string[] }>('/components', { search: q, status, category })
  const students = useApi<{ students: Student[] }>(isAdmin ? '/students' : null)
  const [edit, setEdit] = useState<Component | 'new' | null>(null)
  const [prefillUid, setPrefillUid] = useState('')
  const [del, setDel] = useState<Component | null>(null)
  const [borrow, setBorrow] = useState<Component | null>(null)
  const [ret, setRet] = useState<Component | null>(null)

  useEffect(() => {
    const uid = sp.get('new')
    if (uid && isAdmin) { setPrefillUid(uid); setEdit('new'); setSp({}, { replace: true }) }
  }, [sp, setSp, isAdmin])

  const done = () => { setEdit(null); setBorrow(null); setRet(null); setPrefillUid(''); void reload(); void students.reload() }

  return (
    <>
      <PageHeader title="Components" subtitle="Inventory in the cabinet, with live availability and return dates."
        actions={isAdmin && <Button onClick={() => { setPrefillUid(''); setEdit('new') }}><Plus className="h-4 w-4" /> Add component</Button>} />

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="lg:w-80"><SearchInput value={search} onChange={setSearch} placeholder="Search name, UID, shelf…" /></div>
        <select className="input lg:w-48" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {data?.categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(([v, l]) => (
            <button key={v} onClick={() => setStatus(v)} className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${status === v ? 'bg-navy-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
      </div>

      {error && !data ? <ErrorBox message={error} onRetry={reloadWithSpinner} /> : loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-44" />)}</div>
      ) : data && data.components.length === 0 ? (
        <div className="card"><EmptyState title="No components found" text="Try a different search or filter." /></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data?.components.map((c, i) => {
            const d = dueLabel(c.expected_return_date)
            return (
              <div key={c.component_id} className="card group flex flex-col p-5 transition duration-300 hover:-translate-y-0.5 hover:shadow-lg animate-fade-up" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-brand-50 p-2.5 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white"><Cpu className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold text-navy-900">{c.name}</h3>
                    <p className="font-mono text-[11px] text-slate-400">{c.rfid_uid}</p>
                  </div>
                  <StatusBadge status={c.status} overdue={!!c.overdue} />
                </div>
                <div className="mt-4 space-y-1.5 text-sm text-slate-500">
                  <p className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" />{[c.category, c.shelf_location].filter(Boolean).join(' · ') || 'No location'}</p>
                  {c.status === 'ISSUED' && (
                    <>
                      <p className="flex items-center gap-2"><PackageCheck className="h-3.5 w-3.5" />Back by {fmtDate(c.expected_return_date)} <Badge tone={d.tone}>{d.text}</Badge></p>
                      {isAdmin && c.holder_name && <p className="flex items-center gap-2"><UserRound className="h-3.5 w-3.5" />{c.holder_name} ({c.holder_roll})</p>}
                    </>
                  )}
                  {c.description && <p className="line-clamp-2 text-xs text-slate-400">{c.description}</p>}
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                  {c.status === 'AVAILABLE' && <Button className="!px-3 !py-2" onClick={() => setBorrow(c)}><PackagePlus className="h-4 w-4" /> Borrow</Button>}
                  {c.status === 'ISSUED' && (isAdmin || c.mine) && c.issue_id && <Button variant="secondary" className="!px-3 !py-2" onClick={() => setRet(c)}><PackageCheck className="h-4 w-4" /> Return</Button>}
                  {isAdmin && (
                    <div className="ml-auto flex gap-1">
                      <button className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-brand-600" onClick={() => setEdit(c)} aria-label={`Edit ${c.name}`}><Pencil className="h-4 w-4" /></button>
                      <button className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600" onClick={() => setDel(c)} aria-label={`Delete ${c.name}`}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {edit && <ComponentForm comp={edit === 'new' ? null : edit} prefillUid={prefillUid} categories={data?.categories ?? []} onClose={() => { setEdit(null); setPrefillUid('') }} onSaved={() => { toast.success(edit === 'new' ? 'Component added' : 'Component updated'); done() }} />}
      {borrow && <Modal title="Borrow component" onClose={() => setBorrow(null)}><BorrowForm component={borrow} students={students.data?.students} onDone={done} onCancel={() => setBorrow(null)} /></Modal>}
      {ret && ret.issue_id && <Modal title="Return component" onClose={() => setRet(null)}><ReturnForm issue={{ issue_id: ret.issue_id, component_name: ret.name, expected_return_date: ret.expected_return_date, student_name: ret.holder_name }} onDone={done} onCancel={() => setRet(null)} /></Modal>}
      {del && <ConfirmDialog title="Delete component" message={`Delete "${del.name}"? This cannot be undone. Components with borrowing history cannot be deleted.`}
        onClose={() => setDel(null)} onConfirm={async () => { try { await api(`/components/${del.component_id}`, { method: 'DELETE' }); toast.success('Component deleted'); setDel(null); void reload() } catch (e) { toast.error('Cannot delete', (e as ApiError).message); setDel(null) } }} />}
    </>
  )
}

function ComponentForm({ comp, prefillUid, categories, onClose, onSaved }: { comp: Component | null; prefillUid: string; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ rfid_uid: comp?.rfid_uid ?? prefillUid, name: comp?.name ?? '', category: comp?.category ?? '', shelf_location: comp?.shelf_location ?? '', description: comp?.description ?? '', status: comp?.status ?? 'AVAILABLE' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!f.name.trim()) errs.name = 'Name is required'
    if (!/^[0-9A-Fa-f:\s-]{8,29}$/.test(f.rfid_uid.trim())) errs.rfid_uid = 'Enter or scan a valid UID (8-20 hex characters)'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      await api(comp ? `/components/${comp.component_id}` : '/components', { method: comp ? 'PUT' : 'POST', body: f })
      onSaved()
    } catch (x) {
      const a = x as ApiError
      if (a.field) setErrors({ [a.field]: a.message }); else toast.error('Could not save', a.message)
    } finally { setBusy(false) }
  }

  return (
    <Modal title={comp ? 'Edit component' : 'Add component'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="RFID tag UID" error={errors.rfid_uid} hint="Press Scan, then hold the tag on the reader"><UidInput value={f.rfid_uid} onChange={(v) => set('rfid_uid', v)} error={errors.rfid_uid} /></Field>
        <Field label="Name" error={errors.name}><input className={`input ${errors.name ? 'input-error' : ''}`} value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={100} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" error={errors.category}><input className="input" list="cats" value={f.category} onChange={(e) => set('category', e.target.value)} maxLength={60} /><datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
          <Field label="Shelf" error={errors.shelf_location}><input className="input" value={f.shelf_location} onChange={(e) => set('shelf_location', e.target.value)} maxLength={60} /></Field>
        </div>
        <Field label="Description" error={errors.description}><textarea className="input min-h-20" value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={300} /></Field>
        {comp && (
          <Field label="Status" error={errors.status} hint={comp.status === 'ISSUED' ? 'Return the component to change its status' : undefined}>
            <select className="input" value={f.status} disabled={comp.status === 'ISSUED'} onChange={(e) => set('status', e.target.value)}>
              {comp.status === 'ISSUED' ? <option value="ISSUED">Issued</option> : <><option value="AVAILABLE">Available</option><option value="DAMAGED">Damaged</option><option value="LOST">Lost</option></>}
            </select>
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>{comp ? 'Save changes' : 'Add component'}</Button></div>
      </form>
    </Modal>
  )
}
