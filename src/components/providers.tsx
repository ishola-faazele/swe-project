"use client"

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { Toaster } from '@/components/ui/toast'
import { ThemeProvider } from 'next-themes'

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
      },
    },
  }))

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        {/* Toaster wraps the tree so the shared `toast` manager exported from ui/toast renders
            notifications on every route. It renders no DOM of its own beyond the portal. */}
        <Toaster>{children}</Toaster>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
