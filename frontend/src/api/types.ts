export type Role = 'admin' | 'student'
export type CompStatus = 'AVAILABLE' | 'ISSUED' | 'DAMAGED' | 'LOST'

export interface User {
  user_id: number; username: string; role: Role
  student_id: number | null; full_name: string | null; roll_no: string | null
}

export interface Component {
  component_id: number; rfid_uid: string; name: string
  category: string | null; description: string | null; shelf_location: string | null
  status: CompStatus; added_at: string
  issue_id: number | null; issue_date: string | null; expected_return_date: string | null
  loan_purpose: string | null
  holder_id: number | null; holder_name: string | null; holder_roll: string | null
  overdue: number; mine: boolean
}

export interface Student {
  student_id: number; rfid_uid: string | null; roll_no: string; full_name: string
  department: string | null; year_sem: string | null; phone: string | null; email: string | null
  created_at: string; username: string | null; has_login: number
  active_loans: number; overdue_loans: number; total_loans: number
}

export interface Issue {
  issue_id: number; component_id: number; student_id: number
  purpose: string | null; issue_date: string; expected_return_date: string
  actual_return_date: string | null; returned: number; remarks: string | null
  component_name: string; component_uid: string; category: string | null
  student_name: string; roll_no: string; department: string | null
  overdue: number; days_overdue: number | null
}

export interface HardwareStatus {
  connected: boolean; port: string | null; baud: number
  rfid_reader: boolean | null; servo: 'LOCKED' | 'UNLOCKED' | null
  last_seen: number | null; last_error: string | null
  pyserial_installed: boolean; available_ports: string[]
}

export interface HardwareResult { requested: boolean; ok: boolean; message: string }

export type Resolved =
  | { type: 'component'; component: Component }
  | { type: 'student'; student: { student_id: number; full_name: string; roll_no: string; department: string | null; year_sem: string | null; active_loans: number } | null }
  | { type: 'unknown' }

export interface ScanEvent { id: number; uid: string; ts: number; source: 'reader' | 'manual'; resolved: Resolved }

export interface TrendPoint { date: string; issued: number; returned: number }
export interface NameValue { name: string; value: number }
