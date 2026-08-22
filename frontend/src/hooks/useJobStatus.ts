import { useQuery } from '@tanstack/react-query'
import { fetchJobStatus } from '../lib/api'

export const useJobStatus = (jobId: string) => {
  return useQuery({
    queryKey: ['job', jobId],
    queryFn: () => fetchJobStatus(jobId),
    enabled: !!jobId,
    refetchInterval: (query) => {
      // stop polling if status is done or error
      const status = query?.state?.data?.status
      if (status === 'completed' || status === 'failed') return false
      return 2000
    },
  })
}
