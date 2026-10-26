import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { PageLoader } from './components/ui'
import { useAuth } from './context/AuthContext'
import Activity from './pages/Activity'
import Components from './pages/Components'
import Dashboard from './pages/Dashboard'
import Loans from './pages/Loans'
import Login from './pages/Login'
import Reports from './pages/Reports'
import Scanner from './pages/Scanner'
import Students from './pages/Students'

export default function App() {
  const { user, loading, isAdmin } = useAuth()
  if (loading) return <div className="flex min-h-screen items-center justify-center"><PageLoader /></div>
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="scanner" element={<Scanner />} />
        <Route path="components" element={<Components />} />
        <Route path="students" element={isAdmin ? <Students /> : <Navigate to="/" replace />} />
        <Route path="loans" element={<Loans mode="active" />} />
        <Route path="overdue" element={<Loans mode="overdue" />} />
        <Route path="history" element={<Loans mode="history" />} />
        <Route path="reports" element={isAdmin ? <Reports /> : <Navigate to="/" replace />} />
        <Route path="activity" element={isAdmin ? <Activity /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
