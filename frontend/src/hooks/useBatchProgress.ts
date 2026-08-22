import { useQuery } from '@tanstack/react-query'
import { fetchBatchProgress } from '../lib/api'

export const useBatchProgress = (batchId: string = '') => {
  const query = useQuery({
    queryKey: ['batch', batchId],
    queryFn: () => fetchBatchProgress(batchId),
    enabled: !!batchId,
    refetchInterval: (q) => {
      const data = q?.state?.data
      // stop polling if there are no pending tasks (i.e. batch is done)
      if (data && data.pending === 0) return false
      return 2000
    },
  })

  return {
    ...query,
    progress: query.data?.pct_complete || 0,
    isPolling: query.isFetching && query.data?.pending > 0,
  }
}
