import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { fetchProducts } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

export const Route = createFileRoute('/_layout/taxonomy')({
  component: TaxonomyPage,
})

function TaxonomyPage() {
  const {
    data: products,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['products'],
    queryFn: () => fetchProducts(),
  })

  // Extract unique attributes from all products
  const getUniqueAttributes = () => {
    if (!products || !Array.isArray(products)) return []
    const attrSet = new Set<string>()
    products.forEach((p: any) => {
      if (p.enriched && p.enriched.attributes) {
        Object.keys(p.enriched.attributes).forEach((attr) => {
          if (
            attr !== 'source_url' &&
            attr !== 'source_snippet' &&
            attr !== 'confidence' &&
            attr !== 'reasoning'
          ) {
            attrSet.add(attr)
          }
        })
      }
    })
    return Array.from(attrSet).sort()
  }

  const attributes = getUniqueAttributes()

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
            <h1 className='text-3xl font-bold tracking-tight'>
              Taxonomy & Attributes
            </h1>
            <p className='text-muted-foreground'>
              Dynamic attributes extracted across all products.
            </p>
          </div>

          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-[50px]'>#</TableHead>
                  <TableHead>Attribute Name</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className='h-4 w-4' />
                      </TableCell>
                      <TableCell>
                        <Skeleton className='h-4 w-48' />
                      </TableCell>
                      <TableCell>
                        <Skeleton className='h-4 w-16' />
                      </TableCell>
                    </TableRow>
                  ))
                ) : isError ? (
                  <TableRow>
                    <TableCell colSpan={3} className='h-24 text-center'>
                      Failed to load taxonomy data.
                    </TableCell>
                  </TableRow>
                ) : attributes.length > 0 ? (
                  attributes.map((attr, i) => (
                    <TableRow key={i}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell className='font-medium'>{attr}</TableCell>
                      <TableCell>
                        <span className='inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200'>
                          Active
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className='h-24 text-center'>
                      No attributes found. Upload and process products to
                      generate taxonomy.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </Main>
    </>
  )
}
