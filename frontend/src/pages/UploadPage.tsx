import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { uploadFile } from '@/lib/api'
import { useBatchProgress } from '@/hooks/useBatchProgress'
import { BatchProgress } from '@/components/custom/BatchProgress'
import { UploadDropzone } from '@/components/custom/UploadDropzone'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

export function UploadPage() {
  const { progress, isPolling } = useBatchProgress()
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const handleDrop = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return
    try {
      setIsUploading(true)
      setError(null)
      await uploadFile(acceptedFiles[0])
      toast.success('Upload successful!', {
        description: 'The AI pipeline has started processing your file.',
      })
      navigate({ to: '/products' })
    } catch (err) {
      setError('Failed to upload file.')
      toast.error('Upload failed', {
        description: 'There was an error uploading your file.',
      })
    } finally {
      setIsUploading(false)
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
          <div>
            <h1 className='text-3xl font-bold tracking-tight'>Upload Data</h1>
            <p className='text-muted-foreground'>
              Upload a 6-column CSV file to start the enrichment pipeline.
            </p>
          </div>

          <div className='grid gap-6'>
            <div className='rounded-lg border bg-card p-6'>
              <UploadDropzone onDrop={handleDrop} />
              {isUploading && (
                <p className='mt-4 text-center text-sm text-muted-foreground'>
                  Uploading...
                </p>
              )}
              {error && (
                <p className='mt-4 text-center text-sm text-destructive'>
                  {error}
                </p>
              )}
            </div>

            {(isPolling || progress) && (
              <div className='rounded-lg border bg-card p-6'>
                <h2 className='mb-4 text-xl font-semibold'>Batch Progress</h2>
                <BatchProgress progress={progress} />
              </div>
            )}
          </div>
        </div>
      </Main>
    </>
  )
}
