import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api/client'

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

type Params = Record<string, string | number | undefined | null>

/** Fetch JSON from the API; re-fetches whenever path/params change. */
export function useApi<T>(path: string | null, params?: Params, refreshMs?: number) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const key = path ? path + JSON.stringify(params ?? {}) : ''
  const first = useRef(true)

  const load = useCallback(async (silent = false) => {
    if (!path) return
    if (!silent) setLoading(true)
    try {
      setData(await api<T>(path, { params }))
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => { first.current = false; void load() }, [load])
  useEffect(() => {
    if (!refreshMs) return
    const t = setInterval(() => void load(true), refreshMs)
    return () => clearInterval(t)
  }, [load, refreshMs])

  return { data, loading, error, reload: () => load(true), reloadWithSpinner: () => load(false) }
}
