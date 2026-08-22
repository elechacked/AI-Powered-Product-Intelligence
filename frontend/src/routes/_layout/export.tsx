import { createFileRoute } from '@tanstack/react-router'
import { ExportPage } from '@/pages/ExportPage'

export const Route = createFileRoute('/_layout/export')({
  component: ExportPage,
})
