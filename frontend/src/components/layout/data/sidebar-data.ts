import {
  LayoutDashboard,
  UploadCloud,
  Download,
  Command,
  Box,
  FileText,
  Activity,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'Admin',
    email: 'admin@unilog.com',
    avatar: '/avatars/shadcn.jpg',
  },
  teams: [
    {
      name: 'Unilog AI',
      logo: Command,
      plan: 'Product Intelligence',
    },
  ],
  navGroups: [
    {
      title: 'Enrichment Pipeline',
      items: [
        {
          title: 'Dashboard',
          url: '/',
          icon: LayoutDashboard,
        },
        {
          title: 'Upload Data',
          url: '/upload',
          icon: UploadCloud,
        },
        {
          title: 'Export Data',
          url: '/export',
          icon: Download,
        },
      ],
    },
    {
      title: 'Catalog Management',
      items: [
        {
          title: 'Products',
          url: '/products',
          icon: Box,
        },
        {
          title: 'Categories',
          url: '/categories',
          icon: FileText,
        },
      ],
    },
    {
      title: 'System',
      items: [
        {
          title: 'AI Observability',
          url: '/logs',
          icon: Activity,
        },
      ],
    },
  ],
}
