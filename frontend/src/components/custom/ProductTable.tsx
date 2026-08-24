import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { ArrowUpDown, ChevronLeft, ChevronRight, Search, FileText, Loader2, X, RefreshCw } from 'lucide-react'
import { fetchProducts, retryProduct } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ConfidenceBadge } from './ConfidenceBadge'

export const ProductTable = ({
  category,
  filterConfidence,
  batchId,
  status,
  initialLimit = 20,
  hideControls = false,
}: {
  category?: string
  filterConfidence?: number
  batchId?: string
  status?: string
  initialLimit?: number
  hideControls?: boolean
}) => {
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(initialLimit)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [activeStatus, setActiveStatus] = useState<string | undefined>(status)
  const queryClient = useQueryClient()
  const [showRetryConfirm, setShowRetryConfirm] = useState(false)
  const [retryResult, setRetryResult] = useState<{ queued: number, skipped: number } | null>(null)

  const isRetryableStatus = activeStatus && !['completed', 'commerce_ready'].includes(activeStatus)

  const bulkRetryMutation = useMutation({
    mutationFn: async () => {
      if (!activeStatus) return null
      
      const data = await fetchProducts({ status: activeStatus, limit: 100000 })
      const products = data.items || []
      let queued = 0
      let skipped = 0
      
      for (let i = 0; i < products.length; i += 10) {
        const chunk = products.slice(i, i + 10)
        await Promise.all(chunk.map(async (p: any) => {
          if (p.job_status === 'pending' || p.job_status === 'processing') {
            skipped++
          } else {
            await retryProduct(p.id.toString())
            queued++
          }
        }))
      }
      return { queued, skipped }
    },
    onSuccess: (result) => {
      if (result) {
        setRetryResult(result)
        setShowRetryConfirm(false)
        queryClient.invalidateQueries({ queryKey: ['products'] })
        queryClient.invalidateQueries({ queryKey: ['stats'] })
      }
    }
  })

  useEffect(() => {
    setActiveStatus(status)
  }, [status])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    setPage(1)
  }, [limit, activeStatus])

  const {
    data: productsData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['products', category, activeStatus, batchId, filterConfidence, page, limit, debouncedSearch],
    queryFn: () => fetchProducts({ 
      category, 
      status: activeStatus,
      page,
      limit,
      search: debouncedSearch,
      batch_id: batchId,
      confidence_min: filterConfidence ? filterConfidence / 100 : undefined
    }),
    refetchInterval: (query) => {
      const items = query.state.data?.items || []
      const hasActive = items.some(
        (p: any) =>
          p.job_status === 'pending' ||
          p.job_status === 'processing' ||
          p.job_status === 'scraping' ||
          p.job_status === 'enriching'
      )
      return hasActive ? 3000 : false
    },
  })

  const filteredProducts = productsData?.items || []
  const totalPages = productsData?.pagination?.totalPages || 1
  const totalRecords = productsData?.pagination?.total || 0

  const columns: ColumnDef<any>[] = [
    {
      accessorKey: 'mfg_part_num',
      header: ({ column }) => {
        return (
          <Button
            variant='ghost'
            className='font-semibold -ml-4 hover:bg-muted/50'
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            SKU
            <ArrowUpDown className='ml-2 h-4 w-4' />
          </Button>
        )
      },
      cell: ({ row }) => (
        <span className="font-medium">{row.getValue('mfg_part_num')}</span>
      )
    },
    {
      accessorKey: 'part_desc',
      header: 'Description',
      cell: ({ row }) => (
        <div className="max-w-[400px] truncate" title={row.getValue('part_desc')}>
          {row.getValue('part_desc')}
        </div>
      )
    },
    {
      accessorKey: 'commerce_ready',
      header: ({ column }) => {
        return (
          <Button
            variant='ghost'
            className='font-semibold -ml-4 hover:bg-muted/50'
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Status
            <ArrowUpDown className='ml-2 h-4 w-4' />
          </Button>
        )
      },
      cell: ({ row }) => {
        const status = row.original.job_status || 'pending'
        const ready = row.getValue('commerce_ready')
        
        if (status === 'failed' || status.includes('error')) {
          return (
            <Badge variant='destructive' className='bg-red-500/10 text-red-600 hover:bg-red-500/20 border-red-500/20 shadow-sm'>
              Failed
            </Badge>
          )
        } else if (status === 'completed' && ready) {
          return (
            <Badge variant='outline' className='border-emerald-500/30 bg-emerald-500/10 text-emerald-600 shadow-sm'>
              Commerce Ready ✓
            </Badge>
          )
        } else if (status === 'not_found') {
          return (
            <Badge variant='outline' className='border-amber-500/30 bg-amber-500/10 text-amber-600 shadow-sm'>
              No URLs Found
            </Badge>
          )
        } else if (status === 'completed' && !ready) {
          return (
            <Badge variant='outline' className='border-amber-500/30 bg-amber-500/10 text-amber-600 shadow-sm'>
              Review Needed
            </Badge>
          )
        } else if (status === 'pending') {
          return (
            <Badge variant='outline' className='border-secondary bg-secondary text-secondary-foreground shadow-sm'>
              Pending
            </Badge>
          )
        } else {
          return (
            <Badge variant='outline' className='border-blue-500/30 bg-blue-500/10 text-blue-600 shadow-sm flex items-center w-fit'>
              <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Working...
            </Badge>
          )
        }
      },
    },
    {
      accessorKey: 'overall_confidence',
      header: ({ column }) => {
        return (
          <Button
            variant='ghost'
            className='w-full justify-end font-semibold -mr-4 hover:bg-muted/50'
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Confidence
            <ArrowUpDown className='ml-2 h-4 w-4' />
          </Button>
        )
      },
      cell: ({ row }) => {
        const jobStatus = row.original.job_status
        const isCompleted = jobStatus === 'completed' || row.original.commerce_ready

        return (
          <div className='flex justify-end'>
            {isCompleted ? (
              <ConfidenceBadge
                confidence={row.original.overall_confidence ?? row.original.confidence_scores?.overall_confidence ?? 0}
              />
            ) : (
              <span className="text-muted-foreground font-medium">--</span>
            )}
          </div>
        )
      },
    },
    {
      id: 'actions',
      header: () => <div className='text-right font-semibold'>Actions</div>,
      cell: ({ row }) => {
        const product = row.original
        return (
          <div className='text-right'>
            <Button variant='ghost' size='sm' asChild className='hover:bg-primary/10 hover:text-primary transition-colors'>
              <Link to='/products/$id' params={{ id: String(product.id) }}>
                View
              </Link>
            </Button>
          </div>
        )
      },
    },
  ]

  const table = useReactTable({
    data: filteredProducts,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: totalPages,
  })

  if (isLoading && !productsData)
    return (
      <div className='p-12 flex flex-col items-center justify-center text-muted-foreground space-y-4'>
        <div className="w-8 h-8 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
        <p>Loading products...</p>
      </div>
    )
  if (error)
    return (
      <div className='p-12 text-center text-destructive'>
        Error loading products. Please try again.
      </div>
    )

  return (
    <div className='space-y-4'>
      {!hideControls && (
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="relative w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by SKU..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9 bg-card shadow-sm pr-8"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput('')}
                  className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {activeStatus && (
              <Badge variant="secondary" className="flex items-center gap-1 cursor-pointer hover:bg-secondary/80" onClick={() => setActiveStatus(undefined)}>
                Status: {activeStatus.replace(/_/g, ' ')} <X className="h-3 w-3" />
              </Badge>
            )}
            {isRetryableStatus && (
              <Button 
                variant="outline" 
                size="sm" 
                className="shadow-sm" 
                onClick={() => setShowRetryConfirm(true)}
                disabled={bulkRetryMutation.isPending}
              >
                {bulkRetryMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Retry All {activeStatus?.replace(/_/g, ' ')} ({totalRecords})
              </Button>
            )}
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
              <p>Rows per page</p>
              <Select
                value={`${limit}`}
                onValueChange={(value) => {
                  setLimit(Number(value))
                }}
              >
                <SelectTrigger className="h-8 w-[70px]">
                  <SelectValue placeholder={limit} />
                </SelectTrigger>
                <SelectContent side="top">
                  {[10, 20, 50, 100].map((pageSize) => (
                    <SelectItem key={pageSize} value={`${pageSize}`}>
                      {pageSize}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{filteredProducts.length}</span> results out of <span className="font-medium text-foreground">{totalRecords}</span>
            </div>
          </div>
        </div>
      )}

      <div className='rounded-lg border bg-card shadow-sm overflow-hidden'>
        <Table>
          <TableHeader className="bg-muted/50">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent border-b-muted">
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id} className="h-12">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                  className="hover:bg-muted/40 transition-colors"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-3">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className='h-32 text-center text-muted-foreground'
                >
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <FileText className="h-8 w-8 text-muted-foreground/50" />
                    <p>No products found.</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {!hideControls && (
        <div className='flex items-center justify-between'>
          <div className='text-sm text-muted-foreground'>
            Page <span className="font-medium text-foreground">{page}</span> of{' '}
            <span className="font-medium text-foreground">{totalPages}</span>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant='outline'
              size='sm'
              onClick={() => setPage(old => Math.max(old - 1, 1))}
              disabled={page === 1}
              className="shadow-sm"
            >
              <ChevronLeft className='h-4 w-4 mr-1' />
              Previous
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setPage(old => (old < totalPages ? old + 1 : old))}
              disabled={page === totalPages || totalPages === 0}
              className="shadow-sm"
            >
              Next
              <ChevronRight className='h-4 w-4 ml-1' />
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={showRetryConfirm} onOpenChange={setShowRetryConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retry Pipeline</AlertDialogTitle>
            <AlertDialogDescription>
              Retry {totalRecords} products with status "{activeStatus?.replace(/_/g, ' ')}"?
              This will queue all eligible products matching the current status. Products already processing will be skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkRetryMutation.isPending}>Cancel</AlertDialogCancel>
            <Button 
              disabled={bulkRetryMutation.isPending} 
              onClick={(e) => {
                e.preventDefault()
                bulkRetryMutation.mutate()
              }}
            >
              {bulkRetryMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Retry {totalRecords} Products
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!retryResult} onOpenChange={() => setRetryResult(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retry Complete</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2 mt-2">
                <div><strong>Queued:</strong> {retryResult?.queued}</div>
                <div><strong>Skipped:</strong> {retryResult?.skipped} already processing</div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setRetryResult(null)}>Close</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
