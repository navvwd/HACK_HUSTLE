import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { UserPlus, Mail, Lock, Store, User } from 'lucide-react'

export default function Signup() {
  const [searchParams] = useSearchParams()
  const defaultType = searchParams.get('type') === 'seller' ? 'seller' : 'user'
  
  const [role, setRole] = useState(defaultType)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSignup = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    // Supabase Auth SignUp with role metadata
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
          role: role
        }
      }
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    // Call our backend to create profile row
    try {
      const response = await fetch('http://localhost:8000/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: data.user.id,
          email: email,
          name: name,
          role: role
        })
      })
      if (!response.ok) {
        throw new Error('Failed to create profile in backend')
      }
    } catch (err) {
      console.error(err)
      // Non-blocking for now, as user is authenticated
    }

    setLoading(false)
    if (role === 'seller') {
      navigate('/seller/dashboard')
    } else {
      navigate('/dashboard')
    }
  }

  const isSeller = role === 'seller'

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 transition-colors duration-500 ${isSeller ? 'bg-slate-900' : 'bg-slate-50'}`}>
      <div className={`max-w-md w-full rounded-xl shadow-lg p-8 border ${isSeller ? 'bg-slate-800 border-slate-700 shadow-2xl' : 'bg-white border-slate-100'}`}>
        <div className="text-center mb-6">
          <div className={`p-3 rounded-full inline-flex mb-4 ${isSeller ? 'bg-indigo-500/20 text-indigo-400' : 'bg-blue-100 text-blue-600'}`}>
            <UserPlus size={32} />
          </div>
          <h2 className={`text-2xl font-bold ${isSeller ? 'text-white' : 'text-slate-800'}`}>
            Create Account
          </h2>
          <p className={`mt-2 ${isSeller ? 'text-slate-400' : 'text-slate-500'}`}>
            Join sec_logistics today
          </p>
        </div>

        {/* Role Toggle */}
        <div className="flex bg-slate-200 rounded-lg p-1 mb-6">
          <button
            type="button"
            onClick={() => setRole('user')}
            className={`flex-1 py-2 text-sm font-medium rounded-md flex items-center justify-center gap-2 transition-all ${!isSeller ? 'bg-white text-slate-800 shadow' : 'text-slate-600 hover:text-slate-800'}`}
          >
            <User size={16} /> Customer
          </button>
          <button
            type="button"
            onClick={() => setRole('seller')}
            className={`flex-1 py-2 text-sm font-medium rounded-md flex items-center justify-center gap-2 transition-all ${isSeller ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-800'}`}
          >
            <Store size={16} /> Merchant
          </button>
        </div>

        {error && (
          <div className={`p-3 rounded-lg mb-6 text-sm ${isSeller ? 'bg-red-500/10 border border-red-500/50 text-red-400' : 'bg-red-50 text-red-600'}`}>
            {error}
          </div>
        )}

        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label className={`block text-sm font-medium mb-1 ${isSeller ? 'text-slate-300' : 'text-slate-700'}`}>
              {isSeller ? 'Business Name' : 'Full Name'}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`block w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 ${isSeller ? 'bg-slate-900 border-slate-700 text-white focus:ring-indigo-500 focus:border-indigo-500 placeholder-slate-600' : 'bg-white border-slate-300 text-slate-900 focus:ring-blue-500 focus:border-blue-500'}`}
              placeholder={isSeller ? "Acme Corp" : "John Doe"}
              required
            />
          </div>

          <div>
            <label className={`block text-sm font-medium mb-1 ${isSeller ? 'text-slate-300' : 'text-slate-700'}`}>Email</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Mail className={`h-5 w-5 ${isSeller ? 'text-slate-500' : 'text-slate-400'}`} />
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`block w-full pl-10 pr-3 py-2 border rounded-lg outline-none focus:ring-2 ${isSeller ? 'bg-slate-900 border-slate-700 text-white focus:ring-indigo-500 focus:border-indigo-500 placeholder-slate-600' : 'bg-white border-slate-300 text-slate-900 focus:ring-blue-500 focus:border-blue-500'}`}
                placeholder="email@example.com"
                required
              />
            </div>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-1 ${isSeller ? 'text-slate-300' : 'text-slate-700'}`}>Password</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock className={`h-5 w-5 ${isSeller ? 'text-slate-500' : 'text-slate-400'}`} />
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`block w-full pl-10 pr-3 py-2 border rounded-lg outline-none focus:ring-2 ${isSeller ? 'bg-slate-900 border-slate-700 text-white focus:ring-indigo-500 focus:border-indigo-500 placeholder-slate-600' : 'bg-white border-slate-300 text-slate-900 focus:ring-blue-500 focus:border-blue-500'}`}
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`w-full font-medium py-2 px-4 rounded-lg transition-colors ${isSeller ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-500/25' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
          >
            {loading ? 'Creating account...' : 'Sign Up'}
          </button>
        </form>

        <div className="mt-6 text-center space-y-2">
          <p className={`text-sm ${isSeller ? 'text-slate-400' : 'text-slate-600'}`}>
            Already have an account?{' '}
            <Link to={isSeller ? '/seller/login' : '/login'} className={`hover:underline ${isSeller ? 'text-indigo-400' : 'text-blue-600'}`}>
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
