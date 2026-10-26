import { useState } from 'react'
import { Activity as ActivityIcon, ArrowDownLeft, ArrowUpRight, DoorOpen, FilePlus2, LogIn, Pencil, RefreshCw, Search, Trash2, UserRound } from 'lucide-react'
import type { ActivityEvent } from '../api/types'
import { Badge, EmptyState, ErrorBox, PageHeader, PageLoader, StatCard } from '../components/ui'
import { useApi, useDebounced } from '../hooks'
import { fmtDateTime } from '../lib'

const PAGE_SIZE = 50

interface ActivityResponse {
  events: ActivityEvent[]
  total: number
  opened: number
  created: number
}

const ACTIONS: Record<string, { label: string; tone: 'blue' | 'green' | 'red' | 'amber' | 'slate'; icon: typeof ActivityIcon }> = {
  opened: { label: 'Opened cabinet', tone: 'green', icon: DoorOpen },
  signed_in: { label: 'Signed in', tone: 'blue', icon: LogIn },
  created: { label: 'Created', tone: 'green', icon: FilePlus2 },
  updated: { label: 'Updated', tone: 'amber', icon: Pencil },
  deleted: { label: 'Deleted', tone: 'red', icon: Trash2 },
  borrowed: { label: 'Issued', tone: 'blue', icon: ArrowUpRight },
  returned: { label: 'Returned', tone: 'green', icon: ArrowDownLeft },
  account_created: { label: 'Created login', tone: 'green', icon: UserRound },
  password_reset: { label: 'Reset password', tone: 'slate', icon: RefreshCw },
}

function actionFor(action: string) {
  return ACTIONS[action] ?? { label: action.split('_').join(' '), tone: 'slate' as const, icon: ActivityIcon }
}

export default function Activity() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const query = useDebounced(search.trim(), 250)
  const { data, loading, error, reload, reloadWithSpinner } = useApi<ActivityResponse>(
    '/activity',
    { search: query, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
  )

  if (loading && !data) return <PageLoader />
  if (error && !data) return <ErrorBox message={error} onRetry={reloadWithSpinner} />
  if (!data) return null

  const pageCount = Math.ceil(data.total / PAGE_SIZE)

  return (
    <>
      <PageHeader
        title="Activity log"
        subtitle="See who signed in, opened the cabinet, and changed lab records."
        actions={<button className="btn-secondary" onClick={reload} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Recorded events" value={data.total} icon={ActivityIcon} />
        <StatCard label="Cabinet openings" value={data.opened} icon={DoorOpen} tone="green" />
        <StatCard label="Records created" value={data.created} icon={FilePlus2} tone="violet" />
      </div>

      <section className="card mt-6 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-navy-900">All activity</h2>
            <p className="mt-0.5 text-xs text-slate-500">Newest actions appear first.</p>
          </div>
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-10"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(0) }}
              placeholder="Search person or record…"
              aria-label="Search activity"
            />
          </div>
        </div>

        {error && <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}

        {data.events.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead className="bg-slate-50/80">
                  <tr><th className="th">Who</th><th className="th">Action</th><th className="th">Record</th><th className="th">When</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.events.map((event) => {
                    const action = actionFor(event.action)
                    const Icon = action.icon
                    return (
                      <tr key={event.activity_id} className="transition hover:bg-slate-50/70">
                        <td className="td">
                          <div className="font-medium text-slate-800">{event.actor_name}</div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                            <span>@{event.actor_username}</span><span aria-hidden="true">·</span><span className="capitalize">{event.actor_role}</span>
                          </div>
                        </td>
                        <td className="td"><Badge tone={action.tone}><Icon className="h-3.5 w-3.5" />{action.label}</Badge></td>
                        <td className="td">
                          <div className="font-medium text-slate-700">{event.entity_name}</div>
                          <div className="mt-0.5 text-xs capitalize text-slate-400">{event.entity_type}</div>
                        </td>
                        <td className="td whitespace-nowrap text-slate-500">{fmtDateTime(event.created_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">
                Showing {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + data.events.length} of {data.total}
              </p>
              <div className="flex gap-2">
                <button className="btn-secondary !px-3 !py-1.5 text-xs" disabled={page === 0 || loading} onClick={() => setPage((current) => current - 1)}>Previous</button>
                <button className="btn-secondary !px-3 !py-1.5 text-xs" disabled={page + 1 >= pageCount || loading} onClick={() => setPage((current) => current + 1)}>Next</button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title={query ? 'No matching activity' : 'No activity recorded yet'}
            text={query ? 'Try another name or record.' : 'Sign-ins, cabinet openings, and record changes will appear here.'}
          />
        )}
      </section>
    </>
  )
}
