import { UploadCloud } from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import { cn } from '@/lib/utils'

export const UploadDropzone = ({
  onDrop,
}: {
  onDrop?: (acceptedFiles: File[]) => void
}) => {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
    },
  })

  return (
    <div
      {...getRootProps()}
      className={cn(
        'flex h-64 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors',
        isDragActive
          ? 'border-primary bg-primary/10'
          : 'border-muted-foreground/25 bg-muted/25 hover:bg-muted/50'
      )}
    >
      <input {...getInputProps()} />
      <UploadCloud className='mb-4 h-10 w-10 text-muted-foreground' />
      <p className='mb-2 text-sm text-muted-foreground'>
        <span className='font-semibold text-primary'>Click to upload</span> or
        drag and drop
      </p>
      <p className='text-xs text-muted-foreground'>CSV (MAX. 50MB)</p>
    </div>
  )
}
