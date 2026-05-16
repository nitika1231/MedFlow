import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/react-router'

import appCss from '@/styles.css?url'

type RouterContext = {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      {
        title: 'MedFlow — Autonomous Pharmacy Agent',
      },
      {
        name: 'description',
        content:
          'Autonomous expiration, recall, cold-chain, and waste prevention agent for hospital pharmacies.',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
  notFoundComponent: () => (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold text-brand">404</p>
      <h1 className="mt-3 text-3xl font-bold">Route not found</h1>
      <p className="mt-3 text-muted-foreground">
        MedFlow could not find the requested screen.
      </p>
    </main>
  ),
  errorComponent: ({ error }) => (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold text-danger">Runtime error</p>
      <h1 className="mt-3 text-3xl font-bold">The agent console hit an error</h1>
      <p className="mt-3 text-muted-foreground">{error.message}</p>
    </main>
  ),
})

function RootLayout() {
  const { queryClient } = Route.useRouteContext()

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
