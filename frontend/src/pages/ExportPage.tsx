import { useState } from 'react'
import { Download, AlertCircle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { exportProducts, fetchBatches } from '@/lib/api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ProductTable } from '@/components/custom/ProductTable'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

export function ExportPage() {
  const [sliderValue, setSliderValue] = useState([60])
  const [confidenceThreshold, setConfidenceThreshold] = useState([60])
  const [selectedBatch, setSelectedBatch] = useState<string>('')
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const { data: batches } = useQuery({
    queryKey: ['batches'],
    queryFn: fetchBatches,
  })

  const handleExport = async () => {
    try {
      setIsExporting(true)
      setExportError(null)
      const blob = await exportProducts(confidenceThreshold[0], selectedBatch || undefined)
      
      // Trigger download
      const url = window.URL.createObjectURL(new Blob([blob]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `unilog_export_${selectedBatch || 'all'}.csv`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (error: any) {
      let msg = 'Failed to export. Please try again.';
      if (error.response?.data instanceof Blob) {
        try {
          const text = await error.response.data.text();
          const parsed = JSON.parse(text);
          if (parsed.error) msg = parsed.error;
        } catch (e) {
          // fallback
        }
      }
      setExportError(msg);
    } finally {
      setIsExporting(false)
    }
  }

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
        <div className='flex flex-col gap-6'>
          <div className='flex items-center justify-between'>
            <div>
              <h1 className='text-3xl font-bold tracking-tight'>Export Data</h1>
              <p className='text-muted-foreground'>
                Export enriched products to the 252-column Unilog delivery
                format.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <select 
                className="flex h-10 w-[200px] items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedBatch}
                onChange={(e) => setSelectedBatch(e.target.value)}
              >
                <option value="">All Uploads (Everything)</option>
                {batches?.map((b: any) => (
                  <option key={b.id} value={b.id}>
                    {b.filename} ({b.total} total | ${b.completed_count} completed | ${b.pending_count} pending | ${b.skipped_count} skipped | ${b.failed_count} failed)
                  </option>
                ))}
              </select>
              <Button onClick={handleExport} disabled={isExporting}>
                <Download className='mr-2 h-4 w-4' />
                {isExporting ? 'Exporting...' : 'Export to CSV'}
              </Button>
            </div>
          </div>

          {exportError && (
            <Alert variant='destructive'>
              <AlertCircle className='h-4 w-4' />
              <AlertTitle>Export Error</AlertTitle>
              <AlertDescription>{exportError}</AlertDescription>
            </Alert>
          )}

          <div className='rounded-lg border bg-card p-6'>
            <h2 className='mb-4 text-lg font-medium'>
              Confidence Threshold: {sliderValue[0]}%
            </h2>
            <Slider
              value={sliderValue}
              onValueChange={setSliderValue}
              onValueCommit={setConfidenceThreshold}
              max={100}
              step={1}
              className='w-full max-w-md py-4'
            />
            <p className='mt-2 text-sm text-muted-foreground'>
              Only products with an average confidence score above this
              threshold will be marked as commerce-ready.
            </p>
          </div>

          <div className='mt-4'>
            <h2 className='mb-4 text-xl font-semibold tracking-tight'>
              Preview Products
            </h2>
            {isExporting ? (
              <div className='flex justify-center p-12 text-muted-foreground'>
                Generating export...
              </div>
            ) : (
              <ProductTable filterConfidence={confidenceThreshold[0]} batchId={selectedBatch || undefined} />
            )}
          </div>
        </div>
      </Main>
    </>
  )
}
