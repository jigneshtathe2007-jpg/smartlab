const TOKEN_KEY = 'smartlab_token'

export class ApiError extends Error {
  status: number
  field?: string
  constructor(message: string, status: number, field?: string) {
    super(message)
    this.status = status
    this.field = field
  }
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

let unauthorizedHandler: (() => void) | null = null
export const onUnauthorized = (fn: () => void) => { unauthorizedHandler = fn }

interface Opts { method?: string; body?: unknown; params?: Record<string, string | number | undefined | null>; signal?: AbortSignal }

function url(path: string, params?: Opts['params']) {
  const q = new URLSearchParams()
  Object.entries(params ?? {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)) })
  const s = q.toString()
  return `/api${path}${s ? `?${s}` : ''}`
}

async function request(path: string, o: Opts): Promise<Response> {
  const headers: Record<string, string> = {}
  const t = tokenStore.get()
  if (t) headers.Authorization = `Bearer ${t}`
  if (o.body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(url(path, o.params), { method: o.method ?? 'GET', headers, signal: o.signal, body: o.body !== undefined ? JSON.stringify(o.body) : undefined })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError('Cannot reach the SmartLab server. Is the backend running?', 0)
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    let field: string | undefined
    try { const j = await res.json(); msg = j.error ?? msg; field = j.field } catch { /* non-JSON */ }
    if (res.status === 401 && t && !path.startsWith('/auth/login')) unauthorizedHandler?.()
    throw new ApiError(msg, res.status, field)
  }
  return res
}

export async function api<T>(path: string, o: Opts = {}): Promise<T> {
  const res = await request(path, o)
  return (await res.json()) as T
}

export async function download(path: string, params: Opts['params'], filename: string) {
  const res = await request(path, { params })
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
