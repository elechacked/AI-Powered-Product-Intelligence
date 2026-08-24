import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
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
              <Link to="/products" className="block transition-transform hover:scale-105">
                <Card className="h-full">
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
              </Link>
              <Link to="/products" search={{ status: 'enriched' }} className="block transition-transform hover:scale-105">
                <Card className="h-full">
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
              </Link>
              <Link to="/products" search={{ status: 'failed' }} className="block transition-transform hover:scale-105">
                <Card className="h-full">
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
              </Link>
              <Link to="/products" search={{ status: 'commerce_ready' }} className="block transition-transform hover:scale-105">
                <Card className="h-full">
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
              </Link>
            </div>

            <div className='mt-6'>
              <h2 className='mb-4 text-xl font-semibold tracking-tight'>
                Pipeline Status Breakdown
              </h2>
              {isLoading ? (
                <Skeleton className='h-24 w-full' />
              ) : stats?.statusBreakdown?.length ? (
                <div className='grid gap-4 md:grid-cols-3 lg:grid-cols-4'>
                  {stats.statusBreakdown.map((item: any) => (
                    <Link
                      key={item.status}
                      to="/products"
                      search={{ status: item.status }}
                      className="block transition-transform hover:scale-105"
                    >
                      <Card className="h-full hover:bg-muted/50 cursor-pointer">
                        <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                          <CardTitle className='text-sm font-medium capitalize'>
                            {item.status.replace(/_/g, ' ')}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className='text-2xl font-bold'>
                            {item.count}
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground">No pipeline statuses found.</div>
              )}
            </div>

            <div className='mt-6'>
              <h2 className='mb-4 text-xl font-semibold tracking-tight'>
                Recent Products
              </h2>
              {isLoading ? (
                <Skeleton className='h-[300px] w-full' />
              ) : (
                <ProductTable initialLimit={10} hideControls />
              )}
            </div>
          </div>
        )}
      </Main>
    </>
  )
}
