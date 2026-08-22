import { useQuery } from '@tanstack/react-query'
import { AlertCircle } from 'lucide-react'
import { fetchStats } from '@/lib/api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ProductTable } from '@/components/custom/ProductTable'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

export function Dashboard() {
  const {
    data: stats,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['stats'],
    queryFn: fetchStats,
  })

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
          <div className='p-6'>
            <Alert variant='destructive'>
              <AlertCircle className='h-4 w-4' />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>
                Failed to load dashboard statistics. Please try again later.
              </AlertDescription>
            </Alert>
          </div>
        ) : (
          <div className='flex flex-col gap-6'>
            <div>
              <h1 className='text-3xl font-bold tracking-tight'>Dashboard</h1>
              <p className='text-muted-foreground'>
                Overview of the AI product enrichment pipeline.
              </p>
            </div>

            <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
              <Card>
                <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                  <CardTitle className='text-sm font-medium'>
                    Total Products
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <Skeleton className='h-8 w-20' />
                  ) : (
                    <div className='text-2xl font-bold'>
                      {stats?.total || 0}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                  <CardTitle className='text-sm font-medium'>
                    Enriched
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <Skeleton className='h-8 w-20' />
                  ) : (
                    <div className='text-2xl font-bold'>
                      {stats?.enriched || 0}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                  <CardTitle className='text-sm font-medium'>Failed</CardTitle>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <Skeleton className='h-8 w-20' />
                  ) : (
                    <div className='text-2xl font-bold'>
                      {stats?.failed || 0}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                  <CardTitle className='text-sm font-medium'>
                    Commerce Ready
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <Skeleton className='h-8 w-20' />
                  ) : (
                    <div className='text-2xl font-bold'>
                      {stats?.commerceReady || 0}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className='mt-4'>
              <h2 className='mb-4 text-xl font-semibold tracking-tight'>
                Recent Products
              </h2>
              {isLoading ? (
                <Skeleton className='h-[300px] w-full' />
              ) : (
                <ProductTable />
              )}
            </div>
          </div>
        )}
      </Main>
    </>
  )
}
