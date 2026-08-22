import axios from 'axios'
import { API_BASE_URL } from './constants'

const api = axios.create({
  baseURL: API_BASE_URL,
})

export const fetchStats = async () => {
  const { data } = await api.get('/api/stats')
  return data
}

export const fetchProducts = async (params?: { category?: string, status?: string, page?: number, limit?: number, batch_id?: string, confidence_min?: number }) => {
  const searchParams = new URLSearchParams()
  if (params?.category) searchParams.append('category', params.category)
  if (params?.status) searchParams.append('status', params.status)
  if (params?.page) searchParams.append('page', params.page.toString())
  if (params?.limit) searchParams.append('limit', params.limit.toString())
  if (params?.batch_id) searchParams.append('batch_id', params.batch_id)
  if (params?.confidence_min !== undefined) searchParams.append('confidence_min', params.confidence_min.toString())
  
  const queryStr = searchParams.toString() ? `?${searchParams.toString()}` : ''
  const { data } = await api.get('/api/products' + queryStr)
  return data
}

export const fetchProductDetail = async (id: string) => {
  const { data } = await api.get('/api/products/' + id)
  return data
}

export const retryProduct = async (id: string) => {
  const { data } = await api.post('/api/products/' + id + '/re-enrich')
  return data
}

export const fetchProductDiff = async (id: string) => {
  const { data } = await api.get('/api/products/' + id + '/diff')
  return data
}

export const uploadFile = async (file: File) => {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await api.post('/api/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
  return data
}

export const exportProducts = async (confidence?: number, batchId?: string) => {
  const searchParams = new URLSearchParams()
  if (confidence !== undefined) searchParams.append('confidence_threshold', (confidence / 100).toString())
  if (batchId) searchParams.append('batch_id', batchId)
  
  const queryStr = searchParams.toString() ? `?${searchParams.toString()}` : ''
  const response = await api.get('/api/export' + queryStr, { responseType: 'blob' })
  return response.data
}

export const fetchJobStatus = async (id: string) => {
  const { data } = await api.get('/api/products/' + id)
  return data
}

export const fetchBatchProgress = async (batchId: string) => {
  const { data } = await api.get('/api/upload/batches/' + batchId)
  return data
}

export const fetchCategories = async () => {
  const { data } = await api.get('/api/categories')
  return data
}

export { api }

export const fetchBatches = async () => {
  const res = await api.get('/api/stats/batches')
  return res.data
}
