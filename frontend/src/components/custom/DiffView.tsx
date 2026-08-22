import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const DiffView = ({
  original,
  enriched,
}: {
  original?: any
  enriched?: any[]
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Data Difference</CardTitle>
      </CardHeader>
      <CardContent>
        <div className='grid grid-cols-2 gap-4'>
          <div className='rounded-md border border-red-100 bg-red-50/50 p-4 dark:border-red-900 dark:bg-red-950/20'>
            <h3 className='mb-4 text-sm font-semibold text-red-800 dark:text-red-300'>
              Original (Sparse)
            </h3>
            <div className='space-y-3'>
              {original && Object.entries(original).map(([key, value]) => (
                <div key={key} className='flex flex-col border-b border-red-100 dark:border-red-900/50 pb-2 last:border-0'>
                  <span className='text-[10px] font-medium uppercase text-red-600/70 dark:text-red-400/70'>{key}</span>
                  <span className='text-sm text-red-900 dark:text-red-100'>{String(value || '—')}</span>
                </div>
              ))}
            </div>
          </div>
          <div className='rounded-md border border-green-100 bg-green-50/50 p-4 dark:border-green-900 dark:bg-green-950/20'>
            <h3 className='mb-4 text-sm font-semibold text-green-800 dark:text-green-300'>
              Enriched (Unilog Format)
            </h3>
            <div className='space-y-3'>
              {enriched && enriched.length > 0 ? (
                enriched.map((field, idx) => (
                  <div key={idx} className='flex flex-col border-b border-green-100 dark:border-green-900/50 pb-2 last:border-0'>
                    <span className='text-[10px] font-medium uppercase text-green-600/70 dark:text-green-400/70'>{field.field_name}</span>
                    <span className='text-sm font-medium text-green-900 dark:text-green-100'>
                      {field.field_value} {field.field_uom}
                    </span>
                  </div>
                ))
              ) : (
                <div className='text-sm text-green-700/50'>No enriched fields yet.</div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
