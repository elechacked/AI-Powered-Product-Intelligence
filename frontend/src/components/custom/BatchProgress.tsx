export const BatchProgress = ({ progress }: { progress?: any }) => {
  const percent = progress?.percent || 0
  const processed = progress?.processed || 0
  const total = progress?.total || 0

  return (
    <div className='w-full space-y-2'>
      <div className='flex justify-between text-sm'>
        <span>Processing batch...</span>
        <span className='font-medium'>{String(percent)}%</span>
      </div>
      <div className='h-2 w-full overflow-hidden rounded-full bg-secondary'>
        <div
          className='h-full bg-primary transition-all duration-500 ease-in-out'
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className='text-xs text-muted-foreground'>
        {String(processed)} / {String(total)} products enriched
      </p>
    </div>
  )
}
