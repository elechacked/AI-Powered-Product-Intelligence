import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { fetchCategories, fetchAttributeSources } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ChevronRight, ChevronDown, Folder, FolderOpen, Tag } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export const Route = createFileRoute('/_layout/categories')({
  component: CategoriesPage,
})

interface Category {
  id: number
  name: string
  parent_id: number | null
  classpath: string
  required_attributes: any[]
}

interface TreeNode extends Category {
  children: TreeNode[]
}

function buildTree(categories: Category[]): TreeNode[] {
  const map = new Map<number, TreeNode>()
  const roots: TreeNode[] = []

  categories.forEach((cat) => {
    map.set(cat.id, { ...cat, children: [] })
  })

  categories.forEach((cat) => {
    const node = map.get(cat.id)!
    if (cat.parent_id === null) {
      roots.push(node)
    } else {
      const parent = map.get(cat.parent_id)
      if (parent) {
        parent.children.push(node)
      } else {
        roots.push(node)
      }
    }
  })

  return roots
}

function CategoryNode({
  node,
  selectedId,
  onSelect,
}: {
  node: TreeNode
  selectedId: number | null
  onSelect: (node: TreeNode) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const isSelected = selectedId === node.id
  const hasChildren = node.children.length > 0

  return (
    <div className="select-none">
      <div
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted/50 ${
          isSelected ? 'bg-muted text-primary font-medium' : 'text-foreground'
        }`}
        onClick={() => {
          if (hasChildren) setIsOpen(!isOpen)
          onSelect(node)
        }}
      >
        <span
          className="w-4 h-4 flex items-center justify-center shrink-0 text-muted-foreground"
          onClick={(e) => {
            e.stopPropagation()
            if (hasChildren) setIsOpen(!isOpen)
          }}
        >
          {hasChildren ? (
            isOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )
          ) : (
            <span className="w-4" />
          )}
        </span>
        {hasChildren ? (
          isOpen ? (
            <FolderOpen className="h-4 w-4 text-blue-500 shrink-0" />
          ) : (
            <Folder className="h-4 w-4 text-blue-500 shrink-0" />
          )
        ) : (
          <Tag className="h-4 w-4 text-emerald-500 shrink-0" />
        )}
        <span className="truncate">{node.name}</span>
        {node.required_attributes.length > 0 && (
          <Badge variant="secondary" className="ml-auto text-xs px-1.5 py-0">
            {node.required_attributes.length} attributes
          </Badge>
        )}
      </div>

      {isOpen && hasChildren && (
        <div className="pl-6 border-l ml-4 mt-1 border-border flex flex-col gap-1">
          {node.children.map((child) => (
            <CategoryNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AttributeSourcesDialog({ nodeId, attrName, open, onOpenChange }: { nodeId: number, attrName: string, open: boolean, onOpenChange: (open: boolean) => void }) {
  const { data: sources, isLoading } = useQuery({
    queryKey: ['attribute-sources', nodeId, attrName],
    queryFn: () => fetchAttributeSources(nodeId, attrName),
    enabled: open && !!nodeId && !!attrName,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Sources for Attribute: {attrName}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto pr-2 mt-4 space-y-4">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : sources && sources.length > 0 ? (
            sources.map((s: any, idx: number) => (
              <div key={idx} className="border rounded-md p-4 bg-muted/30">
                <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                  <div>
                    <span className="text-muted-foreground font-semibold">Product Name:</span>{' '}
                    <span className="font-medium">{s.product_name || 'Unknown'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground font-semibold">Source Name:</span>{' '}
                    <span className="font-medium">{s.source_name || 'Unknown'}</span>
                  </div>
                </div>
                
                {s.product_url && (
                  <div className="mb-2 text-sm truncate">
                    <span className="text-muted-foreground font-semibold">Product URL:</span>{' '}
                    <a href={s.product_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">
                      {s.product_url}
                    </a>
                  </div>
                )}
                
                {s.source_url && (
                  <div className="mb-2 text-sm truncate">
                    <span className="text-muted-foreground font-semibold">Extracted from Source URL:</span>{' '}
                    <a href={s.source_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">
                      {s.source_url}
                    </a>
                  </div>
                )}

                {s.reasoning && (
                  <div className="mt-3">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Reasoning</div>
                    <div className="text-sm bg-background p-2 rounded border">
                      {s.reasoning}
                    </div>
                  </div>
                )}
                
                {s.source_snippet && (
                  <div className="mt-3">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Source Snippet</div>
                    <div className="text-xs font-mono bg-background p-2 rounded border-l-2 border-primary overflow-x-auto whitespace-pre">
                      "{s.source_snippet}"
                    </div>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="text-muted-foreground text-center py-8">
              No specific source tracking found for this attribute.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CategoriesPage() {
  const {
    data: categories = [],
    isLoading,
    isError,
  } = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: fetchCategories,
  })

  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null)
  const [selectedAttr, setSelectedAttr] = useState<string | null>(null)

  const tree = useMemo(() => {
    if (!categories.length) return []
    return buildTree(categories)
  }, [categories])

  return (
    <>
      <Header>
        <Search />
        <div className="ml-auto flex items-center space-x-4">
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className="flex flex-col gap-6 h-full pb-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Categories</h1>
            <p className="text-muted-foreground">
              Hierarchical view of product categories and their observed attributes.
            </p>
          </div>

          <div className="flex gap-6 h-full flex-1 min-h-[500px]">
            {/* Left side: Tree */}
            <div className="w-1/3 min-w-[300px] border rounded-md p-4 overflow-y-auto bg-card">
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-6 w-2/3 ml-6" />
                  <Skeleton className="h-6 w-1/2 ml-12" />
                  <Skeleton className="h-6 w-5/6" />
                </div>
              ) : isError ? (
                <div className="text-destructive">Failed to load categories.</div>
              ) : tree.length > 0 ? (
                <div className="flex flex-col gap-1">
                  {tree.map((node) => (
                    <CategoryNode
                      key={node.id}
                      node={node}
                      selectedId={selectedNode?.id || null}
                      onSelect={setSelectedNode}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground text-center py-8">
                  No categories found.
                </div>
              )}
            </div>

            {/* Right side: Details */}
            <div className="flex-1 border rounded-md p-6 bg-card overflow-y-auto">
              {selectedNode ? (
                <div>
                  <h2 className="text-2xl font-semibold mb-2">{selectedNode.name}</h2>
                  <div className="text-sm text-muted-foreground mb-6 font-mono bg-muted p-2 rounded inline-block">
                    {selectedNode.classpath}
                  </div>

                  <h3 className="text-lg font-medium mb-4">Observed Attributes</h3>
                  {selectedNode.required_attributes?.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {selectedNode.required_attributes.map((attr, idx) => {
                        const isString = typeof attr === 'string'
                        const name = isString ? attr : attr.name
                        const type = isString ? null : attr.type
                        const lov = isString ? null : attr.lov

                        return (
                          <div 
                            key={idx} 
                            className="border rounded-md p-4 bg-background cursor-pointer hover:bg-muted/50 hover:border-primary transition-colors"
                            onClick={() => setSelectedAttr(name)}
                          >
                            <div className="font-medium text-sm mb-1">
                              {name}
                            </div>
                            {type && (
                              <div className="text-xs text-muted-foreground mb-2">
                                Type: <span className="font-mono">{type}</span>
                              </div>
                            )}
                            {lov && lov.length > 0 && (
                              <div className="mt-3">
                                <div className="text-xs font-medium text-muted-foreground mb-1.5">
                                  Allowed Values:
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {lov.map((val: string, vidx: number) => (
                                    <Badge key={vidx} variant="outline" className="text-xs">
                                      {val}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="text-muted-foreground">
                      No observed attributes found for this category.
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  Select a category to view its required attributes.
                </div>
              )}
            </div>
          </div>
        </div>
      </Main>
      
      {selectedNode && selectedAttr && (
        <AttributeSourcesDialog 
          nodeId={selectedNode.id} 
          attrName={selectedAttr} 
          open={!!selectedAttr} 
          onOpenChange={(open) => !open && setSelectedAttr(null)} 
        />
      )}
    </>
  )
}
