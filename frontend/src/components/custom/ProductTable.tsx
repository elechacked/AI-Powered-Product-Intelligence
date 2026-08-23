import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { ArrowUpDown, ChevronLeft, ChevronRight, Search, FileText, Loader2 } from 'lucide-react'
import { fetchProducts } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfidenceBadge } from './ConfidenceBadge'

export const ProductTable = ({
  category,
  filterConfidence,
  batchId,
}: {
  category?: string
  filterConfidence?: number
  batchId?: string
}) => {
  const {
    data: products,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['products', category, batchId, filterConfidence],
    queryFn: () => fetchProducts({ 
      category, 
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

  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')

  const filteredProducts = products?.items || []

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
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: 'auto',
    state: {
      sorting,
      globalFilter,
    },
    initialState: {
      pagination: {
        pageSize: 10,
      },
    },
  })

  if (isLoading)
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
      <div className="flex items-center justify-between">
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by SKU or Description..."
            value={globalFilter ?? ''}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-9 bg-card shadow-sm"
          />
        </div>
        <div className="text-sm text-muted-foreground">
          Showing <span className="font-medium text-foreground">{table.getFilteredRowModel().rows.length}</span> results
        </div>
      </div>

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
                    <p>No products found matching your search.</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className='flex items-center justify-between'>
        <div className='text-sm text-muted-foreground'>
          Page <span className="font-medium text-foreground">{table.getState().pagination.pageIndex + 1}</span> of{' '}
          <span className="font-medium text-foreground">{table.getPageCount()}</span>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant='outline'
            size='sm'
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="shadow-sm"
          >
            <ChevronLeft className='h-4 w-4 mr-1' />
            Previous
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="shadow-sm"
          >
            Next
            <ChevronRight className='h-4 w-4 ml-1' />
          </Button>
        </div>
      </div>
    </div>
  )
}
