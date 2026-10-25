import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import type { HardwareStatus } from '../api/types'
import { useAuth } from './AuthContext'

interface Ctx { status: HardwareStatus | null; reachable: boolean; refresh: () => Promise<void> }
const HwCtx = createContext<Ctx>({ status: null, reachable: true, refresh: async () => {} })

/** Polls the backend for the REAL serial/Arduino state. Nothing is assumed. */
export function HardwareProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [status, setStatus] = useState<HardwareStatus | null>(null)
  const [reachable, setReachable] = useState(true)

  const refresh = async () => {
    try { setStatus(await api<HardwareStatus>('/hardware/status')); setReachable(true) } catch { setReachable(false) }
  }

  useEffect(() => {
    if (!user) { setStatus(null); return }
    void refresh()
    const t = setInterval(() => void refresh(), 3000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  return <HwCtx.Provider value={{ status, reachable, refresh }}>{children}</HwCtx.Provider>
}

export const useHardware = () => useContext(HwCtx)
