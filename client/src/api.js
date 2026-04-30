import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000/api',
  headers: { 'Content-Type': 'application/json' },
});

export const submitReturn = (data) => api.post('/returns/submit', data);
export const analyzeDamage = (formData) => api.post('/returns/analyze-damage', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
export const analyzeReceipt = (formData) => api.post('/returns/analyze-receipt', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
export const getReturnHistory = () => api.get('/returns/history');
export const getAnalytics = () => api.get('/analytics/summary');
export const getFingerprints = () => api.get('/analytics/fingerprints');
export const getGraphData = () => api.get('/analytics/graph');
export const getTimeline = () => api.get('/analytics/timeline');
export const getReviewQueue = () => api.get('/review/queue');
export const submitReviewDecision = (id, data) => api.post(`/review/${id}/decide`, data);
export const getReviewStats = () => api.get('/review/stats');

// New endpoints for fraud vectors
export const getChargebacks = () => api.get('/analytics/chargebacks');
export const getWardrobingFlags = () => api.get('/analytics/wardrobing');
export const getINRClaims = () => api.get('/analytics/inr');
export const getDemoScenarios = () => axios.get('http://localhost:8000/api/demo/scenarios');
export const submitAdminReview = (data) => axios.post('http://localhost:8000/api/v1/admin/review', data, { headers: { 'Content-Type': 'multipart/form-data' } });

export default api;
