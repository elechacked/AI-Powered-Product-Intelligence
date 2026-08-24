import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import axios from 'axios'
import { API_BASE_URL } from '@/lib/constants'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'

export const Route = createFileRoute('/_layout/logs')({
  component: LogsPage,
})

function LogsPage() {
  const [selectedLog, setSelectedLog] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const { data: logs, isLoading } = useQuery({
    queryKey: ['llm_logs', debouncedSearch],
    queryFn: async () => {
      const url = new URL(`${API_BASE_URL}/api/stats/logs`)
      url.searchParams.set('limit', '100')
      if (debouncedSearch) {
        url.searchParams.set('search', debouncedSearch)
      }
      const res = await axios.get(url.toString())
      return res.data
    },
    refetchInterval: 5000,
  })

  return (
    <>
      <Header>
        <div className="ml-auto flex items-center space-x-4">
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className="flex flex-col gap-6 h-full pb-4">
          <div className="flex flex-row justify-between items-end">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">AI Observability Logs</h1>
              <p className="text-muted-foreground">
                Real-time audit trail of all prompts, models, token usage, and latency. Click a row to view full payload.
              </p>
            </div>
            <div className="relative w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-card shadow-sm"
              />
            </div>
          </div>

          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : logs?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                      No AI requests logged yet. Process a product to view logs.
                    </TableCell>
                  </TableRow>
                ) : (
                  logs?.map((log: any) => (
                    <TableRow 
                      key={log.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedLog(log)}
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(log.created_at).toLocaleTimeString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {log.agent_name || 'System'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className="font-mono text-[10px]">
                          {log.model_name}
                        </Badge>
                      </TableCell>
                      <TableCell className="truncate max-w-[150px]" title={log.product_sku ? `${log.product_sku} - ${log.product_brand}` : log.product_id}>
                        {log.product_sku ? (
                          <div className="flex flex-col">
                            <span className="font-medium text-sm">{log.product_sku}</span>
                            <span className="text-[10px] text-muted-foreground truncate">{log.product_brand}</span>
                          </div>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">{log.product_id}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {log.total_tokens?.toLocaleString() || 0}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {(log.latency_ms / 1000).toFixed(2)}s
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </Main>

      <Sheet open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <SheetContent className="sm:max-w-[700px] flex flex-col gap-4">
          <SheetHeader>
            <SheetTitle>Log Detail</SheetTitle>
            <SheetDescription>
              {selectedLog?.agent_name} using {selectedLog?.model_name}
            </SheetDescription>
          </SheetHeader>
          
          {selectedLog && (
            <>
              <div className="grid grid-cols-3 gap-4 border rounded-md p-4 bg-muted/20">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground">Prompt Tokens</div>
                  <div className="text-lg font-mono">{selectedLog.prompt_tokens?.toLocaleString() || 0}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground">Completion Tokens</div>
                  <div className="text-lg font-mono">{selectedLog.completion_tokens?.toLocaleString() || 0}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground">Latency</div>
                  <div className="text-lg font-mono">{(selectedLog.latency_ms / 1000).toFixed(2)}s</div>
                </div>
              </div>

              <Tabs defaultValue="response" className="flex-1 flex flex-col">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="response">Response</TabsTrigger>
                  <TabsTrigger value="user">User Prompt</TabsTrigger>
                  <TabsTrigger value="system">System Prompt</TabsTrigger>
                </TabsList>
                <TabsContent value="response" className="flex-1 mt-2">
                  <ScrollArea className="h-[calc(100vh-250px)] rounded-md border p-4 bg-muted/10">
                    <pre className="text-xs whitespace-pre-wrap font-mono">
                      {selectedLog.response_text}
                    </pre>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="user" className="flex-1 mt-2">
                  <ScrollArea className="h-[calc(100vh-250px)] rounded-md border p-4 bg-muted/10">
                    <pre className="text-xs whitespace-pre-wrap font-mono">
                      {selectedLog.user_prompt}
                    </pre>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="system" className="flex-1 mt-2">
                  <ScrollArea className="h-[calc(100vh-250px)] rounded-md border p-4 bg-muted/10">
                    <pre className="text-xs whitespace-pre-wrap font-mono">
                      {selectedLog.system_prompt || "No system prompt"}
                    </pre>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
