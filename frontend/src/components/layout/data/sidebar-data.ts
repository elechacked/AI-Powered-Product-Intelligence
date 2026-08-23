import {
  LayoutDashboard,
  UploadCloud,
  Download,
  Box,
  FileText,
  Activity,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'Data Operations',
    email: 'ops@unilog.com',
    avatar: '/avatars/01.png',
  },
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
