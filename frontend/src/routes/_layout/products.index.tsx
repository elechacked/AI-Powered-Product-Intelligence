import { createFileRoute } from '@tanstack/react-router'
import { ProductTable } from '@/components/custom/ProductTable'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

type ProductsSearch = {
  category?: string
}

export const Route = createFileRoute('/_layout/products/')({
  component: ProductsPage,
  validateSearch: (search: Record<string, unknown>): ProductsSearch => {
    return {
      category: search.category as string | undefined,
    }
  },
})

function ProductsPage() {
  const { category } = Route.useSearch()
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
            <h1 className='text-3xl font-bold tracking-tight'>Products</h1>
            <p className='text-muted-foreground'>
              Manage and view all enriched products.
            </p>
          </div>
          <ProductTable category={category} />
        </div>
      </Main>
    </>
  )
}
