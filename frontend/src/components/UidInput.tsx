import { useEffect, useRef, useState } from 'react'
import { Radio } from 'lucide-react'
import { api } from '../api/client'
import { useHardware } from '../context/HardwareContext'
import { useToast } from '../context/ToastContext'
import { Button } from './ui'

/** Text field for an RFID UID with a "Scan" button that waits for the REAL reader (20 s timeout). */
export function UidInput({ value, onChange, error, disabled }: { value: string; onChange: (v: string) => void; error?: string; disabled?: boolean }) {
  const { status } = useHardware()
  const toast = useToast()
  const [waiting, setWaiting] = useState(false)
  const timer = useRef<number>(0)
  useEffect(() => () => clearInterval(timer.current), [])

  const capture = async () => {
    if (!status?.connected || !status.rfid_reader) {
      toast.error('Reader not available', status?.connected ? 'The RC522 module is not responding.' : 'Arduino is not connected. Type the UID manually.')
      return
    }
    setWaiting(true)
    try {
      const { latest_id } = await api<{ latest_id: number }>('/hardware/scans')
      const deadline = Date.now() + 20000
      await new Promise<void>((resolve) => {
        timer.current = window.setInterval(async () => {
          try {
            const r = await api<{ scans: { uid: string }[] }>('/hardware/scans', { params: { after: latest_id } })
            if (r.scans.length) { onChange(r.scans[0].uid); clearInterval(timer.current); resolve() }
            else if (Date.now() > deadline) { clearInterval(timer.current); toast.warning('No tag detected', 'Hold a tag over the reader and try again.'); resolve() }
          } catch { clearInterval(timer.current); resolve() }
        }, 600)
      })
    } catch {
      toast.error('Could not start scan')
    } finally {
      setWaiting(false)
    }
  }

  return (
    <div className="flex gap-2">
      <input className={`input font-mono uppercase ${error ? 'input-error' : ''}`} value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} placeholder="A1B2C3D4" maxLength={24} spellCheck={false} />
      <Button type="button" variant="secondary" onClick={capture} loading={waiting} disabled={disabled} title="Wait for a tag on the reader">
        {!waiting && <Radio className="h-4 w-4" />}{waiting ? 'Scanning…' : 'Scan'}
      </Button>
    </div>
  )
}
