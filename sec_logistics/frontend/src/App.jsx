import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import UserLogin from './pages/auth/UserLogin'
import SellerLogin from './pages/auth/SellerLogin'
import Signup from './pages/auth/Signup'
import Storefront from './pages/user/Storefront'
import UserOrders from './pages/user/Orders'
import ReturnClaim from './pages/user/ReturnClaim'
import SellerProducts from './pages/seller/Products'
import SellerReturns from './pages/seller/Returns'
import AdminDashboard from './pages/admin/Dashboard'

const UserDashboard = () => {
  const { signOut } = useAuth()
  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold text-slate-800">sec_logistics</h1>
        <div className="flex items-center gap-6">
          <Link to="/dashboard" className="text-slate-600 hover:text-blue-600 font-medium">Storefront</Link>
          <Link to="/dashboard/orders" className="text-slate-600 hover:text-blue-600 font-medium">My Orders</Link>
          <button onClick={signOut} className="bg-slate-100 text-slate-700 hover:bg-slate-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors">Sign Out</button>
        </div>
      </nav>
      
      <Routes>
        <Route path="/" element={<Storefront />} />
        <Route path="/orders" element={<UserOrders />} />
        <Route path="/return/:orderId" element={<ReturnClaim />} />
      </Routes>
    </div>
  )
}

const SellerDashboard = () => {
  const { signOut } = useAuth()
  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      <nav className="bg-slate-800 border-b border-slate-700 px-8 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold text-indigo-400">Seller Portal</h1>
        <div className="flex items-center gap-6">
          <Link to="/seller/dashboard" className="text-slate-300 hover:text-white font-medium">Products</Link>
          <Link to="/seller/dashboard/returns" className="text-slate-300 hover:text-white font-medium">Return Claims</Link>
          <button onClick={signOut} className="bg-slate-700 text-slate-300 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm font-medium transition-colors">Sign Out</button>
        </div>
      </nav>

      <div className="flex-1">
        <Routes>
          <Route path="/" element={<SellerProducts />} />
          <Route path="/returns" element={<SellerReturns />} />
        </Routes>
      </div>
    </div>
  )
}

const AdminLayout = () => {
  const { signOut } = useAuth()
  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      <nav className="bg-slate-950 border-b border-fuchsia-500/20 px-8 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold text-fuchsia-400 tracking-wider">sec_logistics // ADMIN</h1>
        <div className="flex items-center gap-6">
          <Link to="/admin/dashboard" className="text-slate-300 hover:text-white font-medium">Intelligence</Link>
          <button onClick={signOut} className="bg-slate-800 text-slate-300 hover:bg-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">Sign Out</button>
        </div>
      </nav>

      <div className="flex-1">
        <Routes>
          <Route path="/" element={<AdminDashboard />} />
        </Routes>
      </div>
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Public Auth Routes */}
          <Route path="/login" element={<UserLogin />} />
          <Route path="/seller/login" element={<SellerLogin />} />
          <Route path="/signup" element={<Signup />} />

          {/* Protected User Routes */}
          <Route 
            path="/dashboard/*" 
            element={
              <ProtectedRoute allowedRoles={['user']}>
                <UserDashboard />
              </ProtectedRoute>
            } 
          />

          {/* Protected Seller Routes */}
          <Route 
            path="/seller/dashboard/*" 
            element={
              <ProtectedRoute allowedRoles={['seller']}>
                <SellerDashboard />
              </ProtectedRoute>
            } 
          />

          {/* Protected Admin Routes */}
          <Route 
            path="/admin/dashboard/*" 
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminLayout />
              </ProtectedRoute>
            } 
          />

          {/* Default Route */}
          <Route path="/" element={<Navigate to="/login" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  )
}

export default App
