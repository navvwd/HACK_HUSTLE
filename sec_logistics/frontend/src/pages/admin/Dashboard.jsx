import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { Shield, TrendingUp, Users, AlertOctagon } from 'lucide-react'

export default function AdminDashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState(null)
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers = { 'Authorization': `Bearer ${session.access_token}` }
      
      const statsRes = await fetch('http://localhost:8000/api/admin/stats', { headers })
      const claimsRes = await fetch('http://localhost:8000/api/admin/claims', { headers })
      
      if (statsRes.ok && claimsRes.ok) {
        setStats(await statsRes.json())
        const cdata = await claimsRes.json()
        setClaims(cdata.data || [])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleOverride = async (claimId, actionType) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      
      const res = await fetch(`http://localhost:8000/api/admin/claims/${claimId}/override`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ action: actionType })
      })

      if (!res.ok) throw new Error("Failed to override claim")
      
      const newStatus = actionType === 'approve' ? 'APPROVED' : 'REJECTED'
      setClaims(claims.map(c => c.id === claimId ? { ...c, status: newStatus } : c))
      
    } catch (e) {
      alert(e.message)
    }
  }

  return (
    <div className="p-8 bg-slate-900 min-h-screen text-white">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold flex items-center gap-2 mb-8 text-fuchsia-400">
          <Shield /> Platform Intelligence Command
        </h1>

        {loading ? (
          <p className="text-slate-500">Loading intelligence data...</p>
        ) : (
          <>
            {/* Global Trends */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              <div className="bg-slate-800 border border-slate-700 p-6 rounded-xl">
                <div className="flex items-center gap-3 mb-2 text-slate-400">
                  <TrendingUp size={20} />
                  <h3 className="font-semibold">Platform Fraud Rate</h3>
                </div>
                <p className="text-4xl font-black text-fuchsia-400">{stats?.fraud_trends?.fraud_rate}%</p>
                <p className="text-sm text-slate-500 mt-2">of {stats?.fraud_trends?.total_claims} total claims flagged</p>
              </div>

              <div className="bg-slate-800 border border-slate-700 p-6 rounded-xl col-span-2">
                <div className="flex items-center gap-3 mb-4 text-slate-400">
                  <Users size={20} />
                  <h3 className="font-semibold">High-Risk Users Monitor</h3>
                </div>
                <div className="flex gap-4 overflow-x-auto pb-2">
                  {stats?.high_risk_users?.map((u, i) => (
                    <div key={i} className="min-w-[200px] bg-slate-900 border border-red-500/30 p-4 rounded-lg">
                      <p className="text-xs font-mono text-slate-500 mb-2">{u.customer_id.substring(0,8)}...</p>
                      <p className="text-xl font-bold text-red-400">{u.fraudulent} / {u.total}</p>
                      <p className="text-xs text-slate-500 uppercase tracking-wide">Fraudulent Claims</p>
                    </div>
                  ))}
                  {(!stats?.high_risk_users || stats.high_risk_users.length === 0) && (
                    <p className="text-slate-500 text-sm">No high-risk users detected.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Manual Override Queue */}
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
              <AlertOctagon className="text-amber-400" /> Manual Override Queue
            </h2>
            
            <div className="space-y-4">
              {claims.filter(c => ['REQUIRES_REVIEW', 'ESCALATED'].includes(c.status)).map(claim => {
                const decision = claim.decisions && claim.decisions.length > 0 ? claim.decisions[0] : null
                
                return (
                  <div key={claim.id} className="bg-slate-800 border-l-4 border-amber-500 p-6 rounded-r-xl flex flex-col md:flex-row gap-6 items-center justify-between">
                    <div className="flex-1">
                      <p className="text-xs font-bold text-amber-500 mb-1">CLAIM {claim.id.split('-')[0]}</p>
                      <h3 className="font-semibold">{claim.orders?.products?.name}</h3>
                      <p className="text-sm text-slate-400 mt-1">Reason: {claim.reason}</p>
                      <p className="text-xs text-slate-500 mt-2 font-mono">User: {claim.customer_id}</p>
                    </div>

                    <div className="text-center px-8 border-l border-r border-slate-700">
                      <p className="text-xs text-slate-500 mb-1">AI SCORE</p>
                      <p className="text-2xl font-black text-amber-400">{decision?.score || 'N/A'}</p>
                    </div>

                    <div className="flex flex-col gap-2 min-w-[150px]">
                      <button 
                        onClick={() => handleOverride(claim.id, 'approve')}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
                      >
                        Force Approve
                      </button>
                      <button 
                        onClick={() => handleOverride(claim.id, 'reject')}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
                      >
                        Force Reject
                      </button>
                    </div>
                  </div>
                )
              })}
              {claims.filter(c => ['REQUIRES_REVIEW', 'ESCALATED'].includes(c.status)).length === 0 && (
                <p className="text-slate-500 text-center py-12 border border-dashed border-slate-700 rounded-xl">
                  No claims currently require manual override.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
