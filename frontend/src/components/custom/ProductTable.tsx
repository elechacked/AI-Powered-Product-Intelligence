import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { fetchProducts } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

  const filteredProducts = products?.items || []

  const columns: ColumnDef<any>[] = [
    {
      accessorKey: 'mfg_part_num',
      header: ({ column }) => {
        return (
          <Button
            variant='ghost'
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            SKU
            <ArrowUpDown className='ml-2 h-4 w-4' />
          </Button>
        )
      },
    },
    {
      accessorKey: 'part_desc',
      header: 'Description',
    },
    {
      accessorKey: 'commerce_ready',
      header: ({ column }) => {
        return (
          <Button
            variant='ghost'
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
            <Badge variant='destructive' className='bg-red-500/10 text-red-600 hover:bg-red-500/20 border-red-500/20'>
              Failed
            </Badge>
          )
        } else if (status === 'completed' && ready) {
          return (
            <Badge variant='outline' className='border-primary/20 bg-primary/10 text-primary'>
              Enriched
            </Badge>
          )
        } else if (status === 'not_found') {
          return (
            <Badge variant='outline' className='border-amber-500/20 bg-amber-500/10 text-amber-600'>
              No URLs Found
            </Badge>
          )
        } else if (status === 'completed' && !ready) {
          return (
            <Badge variant='outline' className='border-amber-500/20 bg-amber-500/10 text-amber-600'>
              Review Needed
            </Badge>
          )
        } else if (status === 'pending') {
          return (
            <Badge variant='outline' className='border-secondary bg-secondary text-secondary-foreground'>
              Pending
            </Badge>
          )
        } else {
          return (
            <Badge variant='outline' className='border-blue-500/20 bg-blue-500/10 text-blue-600 animate-pulse'>
              Working
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
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
            className='w-full justify-end'
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
                confidence={row.getValue('overall_confidence') || 0}
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
      header: () => <div className='text-right'>Actions</div>,
      cell: ({ row }) => {
        const product = row.original
        return (
          <div className='text-right'>
            <Button variant='ghost' size='sm' asChild>
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
    onSortingChange: setSorting,
    state: {
      sorting,
    },
    initialState: {
      pagination: {
        pageSize: 10,
      },
    },
  })

  if (isLoading)
    return (
      <div className='p-4 text-center text-muted-foreground'>
        Loading products...
      </div>
    )
  if (error)
    return (
      <div className='p-4 text-center text-destructive'>
        Error loading products
      </div>
    )

  return (
    <div className='space-y-4'>
      <div className='rounded-md border bg-card'>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
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
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
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
                  className='h-24 text-center'
                >
                  No products found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className='flex items-center justify-end space-x-2'>
        <Button
          variant='outline'
          size='sm'
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          <ChevronLeft className='h-4 w-4' />
          <span className='sr-only'>Previous</span>
        </Button>
        <div className='text-sm text-muted-foreground'>
          Page {table.getState().pagination.pageIndex + 1} of{' '}
          {table.getPageCount()}
        </div>
        <Button
          variant='outline'
          size='sm'
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          <ChevronRight className='h-4 w-4' />
          <span className='sr-only'>Next</span>
        </Button>
      </div>
    </div>
  )
}
