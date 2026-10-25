import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, onUnauthorized, tokenStore } from '../api/client'
import type { User } from '../api/types'

interface AuthCtx {
  user: User | null
  loading: boolean
  isAdmin: boolean
  login: (username: string, password: string) => Promise<void>
  register: (data: Record<string, string>) => Promise<void>
  logout: () => void
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(!!tokenStore.get())

  const logout = useCallback(() => { tokenStore.clear(); setUser(null) }, [])

  useEffect(() => {
    onUnauthorized(logout)
    if (!tokenStore.get()) return
    api<{ user: User }>('/auth/me').then((r) => setUser(r.user)).catch(() => tokenStore.clear()).finally(() => setLoading(false))
  }, [logout])

  const login = useCallback(async (username: string, password: string) => {
    const r = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: { username, password } })
    tokenStore.set(r.token)
    setUser(r.user)
  }, [])

  const register = useCallback(async (data: Record<string, string>) => {
    const r = await api<{ token: string; user: User }>('/auth/register', { method: 'POST', body: data })
    tokenStore.set(r.token)
    setUser(r.user)
  }, [])

  const value = useMemo(() => ({ user, loading, isAdmin: user?.role === 'admin', login, register, logout }), [user, loading, login, register, logout])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside provider')
  return c
}
