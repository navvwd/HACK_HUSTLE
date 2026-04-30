import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, role } = useAuth()

  if (!user) {
    // If not logged in and requires seller, redirect to seller login
    if (allowedRoles.includes('seller') && !allowedRoles.includes('user')) {
      return <Navigate to="/seller/login" replace />
    }
    return <Navigate to="/login" replace />
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    // If logged in but wrong role
    if (role === 'seller') return <Navigate to="/seller/dashboard" replace />
    return <Navigate to="/dashboard" replace />
  }

  return children
}
