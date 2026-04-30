import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { ShoppingBag } from 'lucide-react'

export default function Storefront() {
  const { user } = useAuth()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchProducts()
  }, [])

  const fetchProducts = async () => {
    // RLS allows anyone to view products
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('created_at', { ascending: false })

    if (!error && data) {
      setProducts(data)
    }
    setLoading(false)
  }

  const handlePurchase = async (product) => {
    // RLS allows users to insert into orders where customer_id = auth.uid()
    const { error } = await supabase
      .from('orders')
      .insert([{
        customer_id: user.id,
        product_id: product.id,
        status: 'PENDING'
      }])

    if (error) {
      alert("Error placing order: " + error.message)
    } else {
      alert(`Successfully ordered ${product.name}!`)
    }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-8">
        <ShoppingBag size={28} className="text-blue-600" />
        <h1 className="text-2xl font-bold text-slate-800">Storefront</h1>
      </div>

      {loading ? (
        <p className="text-slate-500">Loading products...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {products.map(p => (
            <div key={p.id} className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm hover:shadow-md transition-shadow">
              <div className="h-32 bg-slate-100 rounded-lg mb-4 flex items-center justify-center">
                <span className="text-slate-400">Image</span>
              </div>
              <h3 className="font-semibold text-slate-800">{p.name}</h3>
              <p className="text-sm text-slate-500 mb-4">{p.category}</p>
              <div className="flex items-center justify-between mt-auto">
                <span className="text-lg font-bold text-slate-900">₹{p.price}</span>
                <button 
                  onClick={() => handlePurchase(p)}
                  className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700"
                >
                  Buy Now
                </button>
              </div>
            </div>
          ))}
          {products.length === 0 && (
            <p className="text-slate-500 col-span-4 text-center py-12">No products available.</p>
          )}
        </div>
      )}
    </div>
  )
}
