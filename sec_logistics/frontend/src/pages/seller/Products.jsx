import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { Plus, Package } from 'lucide-react'

export default function SellerProducts() {
  const { user } = useAuth()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  
  // New Product Form State
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [price, setPrice] = useState('')

  useEffect(() => {
    fetchProducts()
  }, [])

  const fetchProducts = async () => {
    // RLS ensures they only fetch their own products if we had a view, 
    // but the policy allows viewing ALL products. 
    // So we explicitly filter by their seller_id here.
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('seller_id', user.id)
      .order('created_at', { ascending: false })

    if (!error && data) {
      setProducts(data)
    }
    setLoading(false)
  }

  const handleCreateProduct = async (e) => {
    e.preventDefault()
    // RLS will enforce that seller_id matches auth.uid()
    const { data, error } = await supabase
      .from('products')
      .insert([{
        seller_id: user.id,
        name,
        category,
        price: parseFloat(price)
      }])
      .select()

    if (!error && data) {
      setProducts([data[0], ...products])
      setShowForm(false)
      setName('')
      setCategory('')
      setPrice('')
    } else {
      alert("Error creating product: " + error.message)
    }
  }

  return (
    <div className="p-8 bg-slate-900 min-h-screen text-white">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package /> My Products
          </h1>
          <button 
            onClick={() => setShowForm(!showForm)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg flex items-center gap-2"
          >
            <Plus size={20} /> Add Product
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleCreateProduct} className="bg-slate-800 p-6 rounded-xl border border-slate-700 mb-8 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Product Name</label>
                <input 
                  type="text" required value={name} onChange={e => setName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white outline-none focus:border-indigo-500" 
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Category</label>
                <input 
                  type="text" required value={category} onChange={e => setCategory(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white outline-none focus:border-indigo-500" 
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Price (INR)</label>
                <input 
                  type="number" required min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white outline-none focus:border-indigo-500" 
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button type="submit" className="bg-indigo-600 px-6 py-2 rounded hover:bg-indigo-700">
                Save Product
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <p className="text-slate-500">Loading products...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {products.map(p => (
              <div key={p.id} className="bg-slate-800 border border-slate-700 p-6 rounded-xl">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="font-semibold text-lg">{p.name}</h3>
                  <span className="bg-slate-700 text-xs px-2 py-1 rounded text-slate-300">{p.category}</span>
                </div>
                <p className="text-2xl font-bold text-indigo-400">₹{p.price}</p>
                <p className="text-sm text-slate-500 mt-4">Risk Level: {p.risk_level}</p>
              </div>
            ))}
            {products.length === 0 && !showForm && (
              <p className="text-slate-500 col-span-3 text-center py-12">No products added yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
