/** Date helpers. The DB stores CURRENT_TIMESTAMP in UTC and due dates as plain YYYY-MM-DD. */
export function parseDbDate(s?: string | null): Date | null {
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) && s.length <= 10) {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  const d = new Date(s.replace(' ', 'T') + (s.includes('Z') || s.includes('+') ? '' : 'Z'))
  return isNaN(d.getTime()) ? null : d
}

export function fmtDate(s?: string | null): string {
  const d = parseDbDate(s)
  return d ? d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
}

export function fmtDateTime(s?: string | null): string {
  const d = parseDbDate(s)
  return d ? d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
}

export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function addDaysISO(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return isoDate(d)
}

export function daysUntil(due?: string | null): number | null {
  const d = parseDbDate(due?.slice(0, 10))
  if (!d) return null
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - t.getTime()) / 86400000)
}

export function dueLabel(due?: string | null): { text: string; tone: 'red' | 'amber' | 'green' | 'slate' } {
  const n = daysUntil(due)
  if (n === null) return { text: '—', tone: 'slate' }
  if (n < 0) return { text: `${-n} day${n === -1 ? '' : 's'} overdue`, tone: 'red' }
  if (n === 0) return { text: 'Due today', tone: 'amber' }
  if (n <= 2) return { text: `Due in ${n} day${n === 1 ? '' : 's'}`, tone: 'amber' }
  return { text: `Due in ${n} days`, tone: 'green' }
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}
