export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL 
  || (import.meta.env.PROD ? 'https://backend.pska.org.in' : 'http://localhost:9100')

export const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.9,
  MEDIUM: 0.6,
  LOW: 0.0,
}
