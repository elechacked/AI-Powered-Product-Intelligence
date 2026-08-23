import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

export const ExplainabilityDrawer = ({ product }: { product?: any }) => {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant='outline' size='sm'>
          <Info className='mr-2 h-4 w-4' />
          Explain
        </Button>
      </SheetTrigger>
      <SheetContent className='w-[400px] sm:w-[600px] overflow-y-auto'>
        <SheetHeader>
          <SheetTitle>AI Enrichment Explainability</SheetTitle>
          <SheetDescription>
            Trace back the source of every extracted attribute.
          </SheetDescription>
        </SheetHeader>
        <div className='space-y-4 py-6'>
          {product?.enriched_fields?.length > 0 ? (
            product.enriched_fields.map((field: any, idx: number) => (
              <div key={idx} className='rounded-md border p-4 bg-card'>
                <div className='flex items-center justify-between'>
                  <h4 className='text-sm font-semibold'>{field.field_name}</h4>
                  <span className='text-xs font-medium bg-muted px-2 py-1 rounded'>
                    {field.field_value} {field.field_uom}
                  </span>
                </div>
                {field.source_snippet && (
                  <div className='mt-3'>
                    <div className='text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1'>Source Snippet</div>
                    <div className='rounded bg-muted p-2 text-xs font-mono border-l-2 border-primary'>
                      "{field.source_snippet}"
                    </div>
                  </div>
                )}
                {field.source_url && (
                  <div className='mt-1 text-[10px] text-muted-foreground'>
                    Source:{' '}
                    <a href={field.source_url} target='_blank' rel='noreferrer' className='text-blue-500 hover:underline'>
                      {field.source_url}
                    </a>
                  </div>
                )}
                <div className='mt-3'>
                  <div className='text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1'>AI Reasoning</div>
                  <p className='text-xs text-foreground'>
                    {field.reasoning || 'No reasoning provided.'}
                  </p>
                </div>
                {field.is_inferred && (
                  <div className='mt-2 inline-block bg-amber-500/10 text-amber-500 text-[10px] px-2 py-0.5 rounded font-medium'>
                    Value Inferred
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className='text-sm text-muted-foreground'>No fields extracted.</div>
          )}

          <div className='rounded-md border p-4 flex flex-col h-[400px] mt-8'>
            <h4 className='text-sm font-medium mb-2'>Raw Scraped Source Text</h4>
            <div className='flex-1 overflow-y-auto rounded bg-muted p-2 text-xs font-mono whitespace-pre-wrap break-all'>
              {product?.scraped_text || 'No source text was cached for this product.'}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
