import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { fetchProductDetail, retryProduct } from '@/lib/api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfidenceBadge } from '@/components/custom/ConfidenceBadge'
import { ConflictCard } from '@/components/custom/ConflictCard'
import { DiffView } from '@/components/custom/DiffView'
import { ExplainabilityDrawer } from '@/components/custom/ExplainabilityDrawer'
import { PipelineProgress } from '@/components/custom/PipelineProgress'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

function formatSafeJson(text: string) {
  if (!text) return ''
  try {
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim()
    return JSON.stringify(JSON.parse(cleanText), null, 2)
  } catch (e) {
    return text // return raw text if parsing fails
  }
}

export function ProductDetail() {
  const { id } = useParams({ from: '/_layout/products/$id' })
  const queryClient = useQueryClient()

  const {
    data: product,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['product', id],
    queryFn: () => fetchProductDetail(id),
    // Poll every 2s while pending or processing
    refetchInterval: (query) => {
      const status = query?.state?.data?.status || query?.state?.data?.job_status
      return status === 'processing' || status === 'pending' ? 2000 : false
    },
  })

  const retryMutation = useMutation({
    mutationFn: () => retryProduct(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', id] })
    },
  })

  const status = product?.status || product?.job_status || 'pending'
  const isFailed  = status === 'failed'
  const isPending = status === 'pending' || status === 'processing'
  const isDone    = status === 'completed'

  return (
    <>
      <Header>
        <Search />
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        {isError ? (
          <Alert variant='destructive'>
            <AlertCircle className='h-4 w-4' />
            <AlertTitle>Failed to load product</AlertTitle>
            <AlertDescription>
              Could not fetch product ID: {id}. The server may have returned a
              500 error. Try refreshing.
            </AlertDescription>
          </Alert>
        ) : isLoading ? (
          <div className='flex flex-col gap-6'>
            <Skeleton className='h-10 w-64' />
            <Skeleton className='h-[400px] w-full' />
          </div>
        ) : !product ? (
          <div className='p-6 text-center text-muted-foreground'>
            Product not found.
          </div>
        ) : (
          <div className='flex flex-col gap-6'>
            {/* ── Header row ── */}
            <div className='flex flex-wrap items-start justify-between gap-4'>
              <div>
                <h1 className='text-2xl font-bold tracking-tight'>
                  {product.mfg_part_num || 'Unknown SKU'}
                </h1>
                <p className='text-muted-foreground'>
                  {product.part_desc || '—'}
                </p>
                <div className='mt-2 flex flex-wrap items-center gap-2'>
                  {/* Status badge */}
                  <Badge
                    variant={
                      isDone ? 'default' : isFailed ? 'destructive' : 'secondary'
                    }
                  >
                    {status}
                  </Badge>

                  {/* Confidence badge — only when we have a score */}
                  {typeof product.overall_confidence === 'number' && (
                    <ConfidenceBadge confidence={product.overall_confidence} />
                  )}

                  {/* Commerce ready pill */}
                  {product.commerce_ready && (
                    <Badge className='bg-green-600 hover:bg-green-700'>
                      Commerce Ready ✓
                    </Badge>
                  )}

                  {/* Classpath */}
                  {product.classpath && (
                    <span className='text-xs text-muted-foreground'>
                      {product.classpath}
                    </span>
                  )}
                </div>
              </div>

              <div className='flex items-center gap-2'>
                {/* Retry button — always visible for failed/pending; also visible after done */}
                <Button
                  variant={isFailed ? 'destructive' : 'outline'}
                  size='sm'
                  onClick={() => retryMutation.mutate()}
                  disabled={retryMutation.isPending || isPending}
                >
                  <RefreshCw
                    className={`mr-2 h-4 w-4 ${retryMutation.isPending ? 'animate-spin' : ''}`}
                  />
                  {retryMutation.isPending ? 'Queuing…' : isFailed ? 'Retry Pipeline' : 'Re-enrich'}
                </Button>
                <ExplainabilityDrawer product={product} />
              </div>
            </div>

            {/* ── Error message from the last failed run ── */}
            {isFailed && product.error_message && (
              <Alert variant='destructive'>
                <AlertCircle className='h-4 w-4' />
                <AlertTitle>Pipeline Error</AlertTitle>
                <AlertDescription className='font-mono text-xs'>
                  {product.error_message}
                </AlertDescription>
              </Alert>
            )}

            {/* ── Pipeline vertical timeline — always shown ── */}
            <PipelineProgress
              status={status}
              pipeline_events={product.pipeline_events || []}
            />

            {/* ── Enriched output — only when pipeline finished ── */}
            {isDone && (
              <Tabs defaultValue="output" className="w-full mt-6">
                <TabsList className="grid w-full grid-cols-3 mb-6">
                  <TabsTrigger value="output">Enriched Output</TabsTrigger>
                  <TabsTrigger value="input">Input JSON</TabsTrigger>
                  <TabsTrigger value="orchestration">Orchestration JSON</TabsTrigger>
                </TabsList>
                
                <TabsContent value="output">
                  <div className='grid gap-6 xl:grid-cols-3'>
                    <div className='xl:col-span-2'>
                      <DiffView
                        original={{
                          sku: product.mfg_part_num,
                          description: product.part_desc,
                        }}
                        enriched={product.enriched_fields || []}
                      />
                    </div>

                    <div className='space-y-4'>
                      <h2 className='text-xl font-semibold'>Validation Conflicts</h2>
                      {product.validation_issues && product.validation_issues.length > 0 ? (
                        product.validation_issues.map((issue: unknown, idx: number) => (
                          <ConflictCard key={idx} conflict={issue} />
                        ))
                      ) : (
                        <div className='rounded-md border bg-muted p-4 text-sm text-muted-foreground'>
                          No validation conflicts found.
                        </div>
                      )}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="input">
                  <div className="rounded-md border bg-muted p-4">
                    <pre className="text-xs overflow-auto max-h-[600px] text-muted-foreground whitespace-pre-wrap">
                      {product.input_json 
                        ? formatSafeJson(product.input_json)
                        : "No input JSON available."}
                    </pre>
                  </div>
                </TabsContent>

                <TabsContent value="orchestration">
                  <div className="rounded-md border bg-muted p-4">
                    <pre className="text-xs overflow-auto max-h-[600px] text-muted-foreground whitespace-pre-wrap">
                      {product.orchestration_json 
                        ? formatSafeJson(product.orchestration_json)
                        : "No orchestration JSON available (pipeline may still be running)."}
                    </pre>
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </div>
        )}
      </Main>
    </>
  )
}
