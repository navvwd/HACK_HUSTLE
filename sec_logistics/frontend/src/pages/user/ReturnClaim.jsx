import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { Camera, FileText, AlertCircle } from 'lucide-react'

export default function ReturnClaim() {
  const { orderId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  
  const [reason, setReason] = useState('damaged')
  const [image, setImage] = useState(null)
  const [receipt, setReceipt] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!image) {
      setError('Product image is required for returns.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Get the session to pass the token to our backend
      const { data: { session } } = await supabase.auth.getSession()

      const formData = new FormData()
      formData.append('order_id', orderId)
      formData.append('reason', reason)
      formData.append('image', image)
      if (receipt) formData.append('receipt', receipt)

      const response = await fetch('http://localhost:8000/api/claims/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        },
        body: formData
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'Failed to submit claim')
      }

      alert('Return claim submitted successfully!')
      navigate('/dashboard/orders')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Initiate Return</h1>
      
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="bg-blue-50 text-blue-800 p-4 rounded-lg flex items-start gap-3 mb-6">
          <AlertCircle className="shrink-0 mt-0.5" size={20} />
          <div>
            <p className="font-medium">Return Policy Notice</p>
            <p className="text-sm mt-1">To process your return rapidly, please capture a clear image of the item using your camera. Ensure the defect (if any) is visible.</p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-6 text-sm border border-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Reason for Return</label>
            <select 
              value={reason} 
              onChange={e => setReason(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="damaged">Product Damaged/Defective</option>
              <option value="not_received">Item Not Received (Empty Box)</option>
              <option value="wrong_item">Wrong Item Sent</option>
              <option value="changed_mind">Changed Mind / Doesn't Fit</option>
            </select>
          </div>

          <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:bg-slate-50 transition-colors">
            <Camera className="mx-auto text-slate-400 mb-3" size={32} />
            <label className="block text-sm font-medium text-slate-700 cursor-pointer">
              <span className="text-blue-600 hover:underline">Capture Image</span>
              <input 
                type="file" 
                accept="image/*" 
                capture="environment" 
                className="hidden" 
                onChange={e => setImage(e.target.files[0])}
              />
            </label>
            <p className="text-xs text-slate-500 mt-2">
              {image ? image.name : 'Required: Take a photo of the item'}
            </p>
          </div>

          <div className="border border-slate-200 rounded-xl p-6 hover:bg-slate-50 transition-colors">
            <div className="flex items-center justify-center gap-3 mb-2">
              <FileText className="text-slate-400" size={24} />
              <label className="text-sm font-medium text-slate-700 cursor-pointer">
                <span className="text-blue-600 hover:underline">Upload Receipt</span>
                <input 
                  type="file" 
                  accept=".pdf,image/*" 
                  className="hidden" 
                  onChange={e => setReceipt(e.target.files[0])}
                />
              </label>
            </div>
            <p className="text-xs text-slate-500 text-center">
              {receipt ? receipt.name : '(Optional) Upload invoice/receipt'}
            </p>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-70"
          >
            {loading ? 'Submitting...' : 'Submit Claim'}
          </button>
        </form>
      </div>
    </div>
  )
}
