import { CheckCircle2, Circle, Loader2, XCircle, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

type PipelineEvent = {
  event_type: string // This is the stage (e.g. 'input', 'orchestration', 'scraper')
  message: string // This is the status (e.g. 'done', 'processing', 'pending', 'failed')
}

export function PipelineProgress({
  status,
  pipeline_events = [],
}: {
  status: string
  pipeline_events?: PipelineEvent[]
}) {
  return (
    <Card>
      <CardHeader className='pb-4'>
        <CardTitle className='flex items-center justify-between text-lg font-semibold'>
          AI Enrichment Pipeline
          <span>
            {status === 'processing' && (
              <Badge variant='outline' className='gap-1 border-blue-400 text-blue-600'>
                <Loader2 className='h-3 w-3 animate-spin' /> Processing
              </Badge>
            )}
            {status === 'completed' && (
              <Badge variant='outline' className='gap-1 border-green-500 text-green-600'>
                <CheckCircle2 className='h-3 w-3' /> Completed
              </Badge>
            )}
            {status === 'failed' && (
              <Badge variant='outline' className='gap-1 border-red-500 text-red-600'>
                <XCircle className='h-3 w-3' /> Failed
              </Badge>
            )}
            {(status === 'pending' || status === 'queued') && (
              <Badge variant='outline' className='gap-1 border-muted-foreground text-muted-foreground'>
                <Circle className='h-3 w-3' /> Queued
              </Badge>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className='relative space-y-0'>
          {pipeline_events.map((event, index) => {
            const stepStatus = event.message === 'done' ? 'completed' :
                               event.message === 'failed' ? 'failed' :
                               event.message === 'processing' ? 'processing' : 'pending'

            return (
              <div key={event.event_type} className='relative flex gap-4'>
                {/* Vertical connector line */}
                {index < pipeline_events.length - 1 && (
                  <div className='absolute top-8 left-[15px] h-full w-[2px] bg-border' />
                )}

                {/* Step icon */}
                <div className='relative z-10 flex-shrink-0'>
                  <div
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full border-2 bg-background',
                      stepStatus === 'completed' ? 'border-green-500 text-green-500' :
                      stepStatus === 'processing' ? 'border-blue-500 text-blue-500' :
                      stepStatus === 'failed'     ? 'border-red-500 text-red-500' :
                                                    'border-muted-foreground/40 text-muted-foreground/40'
                    )}
                  >
                    {stepStatus === 'completed'  ? <CheckCircle2 className='h-4 w-4' /> :
                     stepStatus === 'processing' ? <Loader2 className='h-4 w-4 animate-spin' /> :
                     stepStatus === 'failed'     ? <XCircle className='h-4 w-4' /> :
                                                   <Circle className='h-4 w-4' />}
                  </div>
                </div>

                {/* Step body */}
                <div className={cn('min-w-0 flex-1 pb-6', index === pipeline_events.length - 1 && 'pb-0')}>
                  <div className='flex items-center gap-2'>
                    <p className={cn(
                      'text-sm font-semibold capitalize',
                      stepStatus === 'pending' ? 'text-muted-foreground' : 'text-foreground'
                    )}>
                      {event.event_type}
                    </p>
                    {stepStatus === 'failed' && (
                      <Badge variant='destructive' className='h-5 text-[10px]'>Error</Badge>
                    )}
                    {stepStatus === 'completed' && (
                      <Badge variant='outline' className='h-5 border-green-500 text-[10px] text-green-600'>Done</Badge>
                    )}
                    {stepStatus === 'processing' && (
                      <Badge variant='outline' className='h-5 border-blue-400 text-[10px] text-blue-600'>Running</Badge>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
