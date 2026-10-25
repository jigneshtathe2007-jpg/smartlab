import { useState, type FormEvent } from 'react'
import { LockOpen, PackageCheck, PackagePlus } from 'lucide-react'
import { api, ApiError } from '../api/client'
import type { Component, HardwareResult, Issue, Student } from '../api/types'
import { useAuth } from '../context/AuthContext'
import { useHardware } from '../context/HardwareContext'
import { useToast } from '../context/ToastContext'
import { addDaysISO, fmtDate } from '../lib'
import { Button, Field } from './ui'

function reportHardware(toast: ReturnType<typeof useToast>, hw: HardwareResult, doneMsg: string) {
  if (!hw.requested) toast.success(doneMsg)
  else if (hw.ok) toast.success(doneMsg, hw.message)
  else toast.warning(`${doneMsg} - but the cabinet did not open`, hw.message)
}

function UnlockToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const { status } = useHardware()
  const ready = !!status?.connected
  return (
    <label className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${ready ? 'cursor-pointer border-slate-200 hover:bg-slate-50' : 'border-slate-200 bg-slate-50 opacity-70'}`}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" checked={checked && ready} disabled={!ready} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="flex items-center gap-1.5 font-medium text-slate-700"><LockOpen className="h-4 w-4 text-brand-600" /> Open the cabinet latch</span>
        <span className="text-xs text-slate-500">{ready ? 'The servo unlocks only after the record is saved.' : 'Unavailable: Arduino is not connected. The record will still be saved.'}</span>
      </span>
    </label>
  )
}

export function BorrowForm({ component, students, defaultStudentId, onDone, onCancel }:
  { component: Pick<Component, 'component_id' | 'name' | 'rfid_uid'>; students?: Student[]; defaultStudentId?: number | null; onDone: () => void; onCancel: () => void }) {
  const { isAdmin } = useAuth()
  const { status } = useHardware()
  const toast = useToast()
  const [studentId, setStudentId] = useState<string>(defaultStudentId ? String(defaultStudentId) : '')
  const [due, setDue] = useState(addDaysISO(7))
  const [purpose, setPurpose] = useState('')
  const [unlock, setUnlock] = useState(true)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (isAdmin && !studentId) errs.student_id = 'Select the borrowing student'
    if (!due) errs.expected_return_date = 'Choose an expected return date'
    else if (due < addDaysISO(0)) errs.expected_return_date = 'Date cannot be in the past'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const r = await api<{ issue: Issue; hardware: HardwareResult }>('/issues/borrow', {
        method: 'POST',
        body: { component_id: component.component_id, student_id: isAdmin ? Number(studentId) : undefined, expected_return_date: due, purpose, unlock: unlock && !!status?.connected },
      })
      reportHardware(toast, r.hardware, `${component.name} issued - due ${fmtDate(due)}`)
      onDone()
    } catch (err) {
      const ae = err as ApiError
      if (ae.field) setErrors({ [ae.field === 'component_id' ? 'form' : ae.field]: ae.message })
      toast.error('Could not issue component', ae.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="flex items-center gap-3 rounded-xl bg-brand-50 p-3.5">
        <div className="rounded-lg bg-white p-2 text-brand-600"><PackagePlus className="h-5 w-5" /></div>
        <div className="min-w-0">
          <p className="truncate font-semibold text-navy-900">{component.name}</p>
          <p className="font-mono text-xs text-slate-500">{component.rfid_uid}</p>
        </div>
      </div>
      {errors.form && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{errors.form}</p>}
      {isAdmin && (
        <Field label="Student" error={errors.student_id}>
          <select className={`input ${errors.student_id ? 'input-error' : ''}`} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Select student…</option>
            {students?.map((s) => <option key={s.student_id} value={s.student_id}>{s.full_name} · {s.roll_no}</option>)}
          </select>
        </Field>
      )}
      <Field label="Expected return date" error={errors.expected_return_date} hint="Shown to other students so they know when it will be free">
        <input type="date" className={`input ${errors.expected_return_date ? 'input-error' : ''}`} value={due} min={addDaysISO(0)} max={addDaysISO(90)} onChange={(e) => setDue(e.target.value)} />
      </Field>
      <Field label="Purpose / project (optional)" error={errors.purpose}>
        <input className="input" value={purpose} maxLength={200} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Mini project - door lock" />
      </Field>
      <UnlockToggle checked={unlock} onChange={setUnlock} />
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={busy}>Issue component</Button>
      </div>
    </form>
  )
}

export function ReturnForm({ issue, onDone, onCancel }:
  { issue: { issue_id: number; component_name: string; expected_return_date: string | null; student_name?: string | null }; onDone: () => void; onCancel: () => void }) {
  const { status } = useHardware()
  const toast = useToast()
  const [condition, setCondition] = useState<'OK' | 'DAMAGED'>('OK')
  const [remarks, setRemarks] = useState('')
  const [unlock, setUnlock] = useState(true)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await api<{ issue: Issue; hardware: HardwareResult }>('/issues/return', {
        method: 'POST', body: { issue_id: issue.issue_id, condition, remarks, unlock: unlock && !!status?.connected },
      })
      reportHardware(toast, r.hardware, `${issue.component_name} returned`)
      onDone()
    } catch (err) {
      toast.error('Could not return component', (err as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl bg-emerald-50 p-3.5">
        <div className="rounded-lg bg-white p-2 text-emerald-600"><PackageCheck className="h-5 w-5" /></div>
        <div className="min-w-0">
          <p className="truncate font-semibold text-navy-900">{issue.component_name}</p>
          <p className="text-xs text-slate-500">{issue.student_name ? `${issue.student_name} · ` : ''}due {fmtDate(issue.expected_return_date)}</p>
        </div>
      </div>
      <Field label="Condition">
        <div className="grid grid-cols-2 gap-2">
          {(['OK', 'DAMAGED'] as const).map((c) => (
            <button type="button" key={c} onClick={() => setCondition(c)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${condition === c ? (c === 'OK' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-amber-500 bg-amber-50 text-amber-700') : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {c === 'OK' ? 'Good condition' : 'Damaged'}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Remarks (optional)">
        <input className="input" value={remarks} maxLength={200} onChange={(e) => setRemarks(e.target.value)} placeholder={condition === 'DAMAGED' ? 'Describe the damage' : 'Any notes'} />
      </Field>
      <UnlockToggle checked={unlock} onChange={setUnlock} />
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={busy}>Confirm return</Button>
      </div>
    </form>
  )
}
