import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { AlertTriangle, CheckCircle, XCircle, ShieldAlert } from 'lucide-react'

export default function SellerReturns() {
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchClaims()
  }, [])

  const fetchClaims = async () => {
    // Fetch claims that belong to this seller. 
    // RLS policy "Sellers can view claims for their products" handles security.
    const { data: claimsData, error: claimsError } = await supabase
      .from('claims')
      .select('*, orders(*, products(*)), decisions(*)')
      .order('created_at', { ascending: false })

    if (!claimsError && claimsData) {
      setClaims(claimsData)
    }
    setLoading(false)
  }

  const handleAction = async (claimId, actionType) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      
      const res = await fetch(`http://localhost:8000/api/claims/${claimId}/action`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ action: actionType })
      })

      if (!res.ok) throw new Error("Failed to update claim")
      
      // Update local state
      const newStatus = actionType === 'approve' ? 'APPROVED' : 
                        actionType === 'reject' ? 'REJECTED' : 'ESCALATED'
      
      setClaims(claims.map(c => c.id === claimId ? { ...c, status: newStatus } : c))
      
    } catch (e) {
      alert(e.message)
    }
  }

  const getScoreColor = (score) => {
    if (score === null || score === undefined) return 'text-slate-500'
    if (score <= 0.3) return 'text-emerald-400'
    if (score <= 0.7) return 'text-amber-400'
    return 'text-red-400'
  }

  return (
    <div className="p-8 bg-slate-900 min-h-screen text-white">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="text-indigo-400" /> Return Monitor
          </h1>
        </div>

        {loading ? (
          <p className="text-slate-500">Loading claims...</p>
        ) : (
          <div className="space-y-4">
            {claims.map(claim => {
              // Extract the latest decision if available
              const decision = claim.decisions && claim.decisions.length > 0 
                ? claim.decisions[0] 
                : null

              return (
                <div key={claim.id} className="bg-slate-800 border border-slate-700 p-6 rounded-xl flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
                  
                  {/* Claim Details */}
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="font-mono text-xs text-slate-500">ID: {claim.id.split('-')[0]}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                        claim.status === 'PENDING_REVIEW' ? 'bg-amber-500/20 text-amber-400' :
                        claim.status === 'REQUIRES_REVIEW' ? 'bg-orange-500/20 text-orange-400' :
                        claim.status === 'APPROVED' ? 'bg-emerald-500/20 text-emerald-400' :
                        claim.status === 'REJECTED' ? 'bg-red-500/20 text-red-400' :
                        'bg-purple-500/20 text-purple-400'
                      }`}>
                        {claim.status}
                      </span>
                    </div>
                    
                    <h3 className="font-semibold text-lg">{claim.orders?.products?.name}</h3>
                    <p className="text-sm text-slate-400">Reason: <span className="text-slate-300">{claim.reason}</span></p>
                    <p className="text-sm text-slate-500 mt-1">
                      Submitted: {new Date(claim.created_at).toLocaleDateString()}
                    </p>
                  </div>

                  {/* Fraud Score & Signals */}
                  <div className="bg-slate-900 border border-slate-700 p-4 rounded-lg min-w-[200px] text-center">
                    <p className="text-xs text-slate-500 mb-1 uppercase tracking-wider font-semibold">Fraud Score</p>
                    {decision ? (
                      <div>
                        <p className={`text-3xl font-black ${getScoreColor(decision.score)}`}>
                          {decision.score}
                        </p>
                        <p className="text-xs text-slate-400 mt-1 capitalize">AI: {decision.action}</p>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400 py-2">Pending Eval</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 min-w-[140px]">
                    {claim.status !== 'APPROVED' && (
                      <button 
                        onClick={() => handleAction(claim.id, 'approve')}
                        className="flex items-center justify-center gap-2 bg-slate-700 hover:bg-emerald-600 hover:text-white text-emerald-400 px-4 py-2 rounded transition-colors text-sm font-medium"
                      >
                        <CheckCircle size={16} /> Approve
                      </button>
                    )}
                    {claim.status !== 'REJECTED' && (
                      <button 
                        onClick={() => handleAction(claim.id, 'reject')}
                        className="flex items-center justify-center gap-2 bg-slate-700 hover:bg-red-600 hover:text-white text-red-400 px-4 py-2 rounded transition-colors text-sm font-medium"
                      >
                        <XCircle size={16} /> Reject
                      </button>
                    )}
                    {claim.status !== 'ESCALATED' && (
                      <button 
                        onClick={() => handleAction(claim.id, 'escalate')}
                        className="flex items-center justify-center gap-2 bg-slate-700 hover:bg-amber-600 hover:text-white text-amber-400 px-4 py-2 rounded transition-colors text-sm font-medium"
                      >
                        <AlertTriangle size={16} /> Escalate
                      </button>
                    )}
                  </div>

                </div>
              )
            })}
            
            {claims.length === 0 && (
              <div className="text-center py-20 border border-dashed border-slate-700 rounded-xl">
                <ShieldAlert className="mx-auto text-slate-600 mb-4" size={48} />
                <p className="text-slate-400">No return claims active for your products.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
