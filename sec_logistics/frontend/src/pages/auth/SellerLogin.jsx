import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Store, Lock, Mail } from 'lucide-react'

export default function SellerLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  const handleLogin = async (e) => {
    e.preventDefault()
    setError(null)
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      return
    }

    if (data?.user?.user_metadata?.role !== 'seller') {
      setError("This portal is restricted to Sellers. Please use the user login.")
      await supabase.auth.signOut()
      return
    }

    navigate('/seller/dashboard')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
      <div className="max-w-md w-full bg-slate-800 rounded-xl shadow-2xl p-8 border border-slate-700">
        <div className="text-center mb-8">
          <div className="bg-indigo-500/20 text-indigo-400 p-3 rounded-full inline-flex mb-4">
            <Store size={32} />
          </div>
          <h2 className="text-2xl font-bold text-white">Seller Portal</h2>
          <p className="text-slate-400 mt-2">Manage your returns securely</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded-lg mb-6 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Business Email</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Mail className="h-5 w-5 text-slate-500" />
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full pl-10 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:ring-indigo-500 focus:border-indigo-500 outline-none placeholder-slate-600"
                placeholder="seller@business.com"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Password</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock className="h-5 w-5 text-slate-500" />
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full pl-10 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:ring-indigo-500 focus:border-indigo-500 outline-none placeholder-slate-600"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full bg-indigo-600 text-white font-medium py-2 px-4 rounded-lg hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-500/25"
          >
            Access Portal
          </button>
        </form>

        <div className="mt-6 text-center space-y-2">
          <p className="text-sm text-slate-400">
            Apply as a merchant? <Link to="/signup?type=seller" className="text-indigo-400 hover:underline">Register Business</Link>
          </p>
          <p className="text-sm text-slate-400">
            Customer returning an item? <Link to="/login" className="text-indigo-400 hover:underline">User Login</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
