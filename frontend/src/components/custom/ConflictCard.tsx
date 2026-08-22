import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export const ConflictCard = ({ conflict }: { conflict?: any }) => {
  return (
    <Alert variant='destructive'>
      <AlertCircle className='h-4 w-4' />
      <AlertTitle>Validation Conflict: {conflict?.field_name}</AlertTitle>
      <AlertDescription>
        {conflict?.description || conflict?.message || 'Unknown validation issue.'}
      </AlertDescription>
    </Alert>
  )
}
