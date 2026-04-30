import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { Package } from 'lucide-react'

export default function UserOrders() {
  const { user } = useAuth()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchOrders()
  }, [])

  const fetchOrders = async () => {
    // RLS guarantees user only sees their own orders
    const { data, error } = await supabase
      .from('orders')
      .select('*, products(name, price)')
      .order('created_at', { ascending: false })

    if (!error && data) {
      setOrders(data)
    }
    setLoading(false)
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-8">
        <Package size={28} className="text-blue-600" />
        <h1 className="text-2xl font-bold text-slate-800">My Orders</h1>
      </div>

      {loading ? (
        <p className="text-slate-500">Loading orders...</p>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-sm">
                <th className="p-4">Order ID</th>
                <th className="p-4">Product</th>
                <th className="p-4">Amount</th>
                <th className="p-4">Status</th>
                <th className="p-4">Date</th>
                <th className="p-4">Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="p-4 text-sm text-slate-500 font-mono">{o.id.substring(0,8)}...</td>
                  <td className="p-4 font-medium text-slate-800">{o.products?.name}</td>
                  <td className="p-4 text-slate-600">₹{o.products?.price}</td>
                  <td className="p-4">
                    <span className="bg-amber-100 text-amber-700 text-xs px-2 py-1 rounded-full font-medium">
                      {o.status}
                    </span>
                  </td>
                  <td className="p-4 text-sm text-slate-500">
                    {new Date(o.created_at).toLocaleDateString()}
                  </td>
                  <td className="p-4">
                    <Link 
                      to={`/dashboard/return/${o.id}`}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium hover:underline"
                    >
                      Return Item
                    </Link>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan="5" className="p-8 text-center text-slate-500">
                    You haven't placed any orders yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
