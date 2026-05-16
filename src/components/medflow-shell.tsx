import { Link, Outlet } from '@tanstack/react-router'
import { CheckCircle2, Play, X } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { MODEL_NAME } from '@/lib/medflow-data'
import { useMedFlow } from '@/lib/medflow-context'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', label: 'Inventory' },
  { to: '/reasoning', label: 'Agent Reasoning' },
  { to: '/audit', label: 'Audit Log' },
  { to: '/memory', label: 'Memory & Patterns' },
  { to: '/roi', label: 'ROI Dashboard' },
] as const

export function MedFlowShell() {
  const { agentStatus, isAgentRunning, runAgent, resetDemo, toasts, dismissToast } =
    useMedFlow()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,rgba(189,213,176,0.38),transparent_28rem),radial-gradient(circle_at_80%_12%,rgba(18,60,47,0.14),transparent_26rem)]" />
      <header className="sticky top-0 z-40 border-b border-[#d7e5d2]/30 bg-[#123c2f]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-[1440px] items-center gap-6 px-8">
          <Link to="/" className="text-2xl font-bold tracking-tight text-white">
            MedFlow
          </Link>

          <nav className="flex flex-1 items-center justify-center gap-2">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-full px-4 py-2 text-sm font-medium text-[#d7e5d2] transition hover:bg-white/10 hover:text-white"
                activeProps={{
                  className: 'bg-white text-[#0b2f25] ring-1 ring-[#d7e5d2]/60',
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <AgentStatusIndicator status={agentStatus} />
            <div
              className="max-w-[19rem] truncate rounded-md border border-[#d7e5d2]/40 bg-white/10 px-3 py-2 font-mono text-xs text-[#eef6ec]"
              title={MODEL_NAME}
            >
              {MODEL_NAME}
            </div>
            <Button
              onClick={runAgent}
              disabled={isAgentRunning}
              className={cn(
                'h-11 bg-[#d7e5d2] px-5 font-semibold text-[#123c2f] shadow-lg shadow-[#0f2f26]/25 hover:bg-white disabled:bg-[#d7e5d2]',
                isAgentRunning && 'animate-pulse',
              )}
            >
              <Play className="size-4" />
              {isAgentRunning ? 'Running...' : 'Run Agent'}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto min-h-[calc(100vh-8rem)] max-w-[1440px] px-8 py-8">
        <Outlet />
      </main>

      <footer className="mx-auto flex max-w-[1440px] items-center justify-end px-8 pb-8">
        <button
          type="button"
          onClick={resetDemo}
          className="text-xs font-medium text-[#547765] underline-offset-4 transition hover:text-[#123c2f] hover:underline"
        >
          Reset for demo
        </button>
      </footer>

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}

function AgentStatusIndicator({ status }: { status: 'idle' | 'running' | 'completed' }) {
  if (status === 'running') {
    return (
      <StatusShell>
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#b9d2ae] opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-[#b9d2ae]" />
        </span>
        Agent running
      </StatusShell>
    )
  }

  if (status === 'completed') {
    return (
      <StatusShell>
        <CheckCircle2 className="size-4 text-[#d7e5d2]" />
        Agent completed
      </StatusShell>
    )
  }

  return (
    <StatusShell>
      <span className="size-2.5 rounded-full bg-[#9fb79a]" />
      Agent idle
    </StatusShell>
  )
}

function StatusShell({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[#d7e5d2]/40 bg-white/10 px-3 py-2 text-xs font-semibold text-[#eef6ec]">
      {children}
    </div>
  )
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Array<{ id: string; message: string; tone: 'default' | 'success' | 'warning' | 'danger' }>
  onDismiss: (id: string) => void
}) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex w-[24rem] flex-col gap-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'animate-in fade-in slide-in-from-bottom-2 flex items-start justify-between gap-3 rounded-xl border bg-white/95 p-4 text-sm text-[#123c2f] shadow-2xl shadow-[#123c2f]/15 backdrop-blur',
            toast.tone === 'success' && 'border-[#6f9d7a]/50',
            toast.tone === 'warning' && 'border-amber-400/40',
            toast.tone === 'danger' && 'border-red-400/40',
            toast.tone === 'default' && 'border-[#d7e5d2]',
          )}
        >
          <p className="leading-5">{toast.message}</p>
          <button
            type="button"
            className="rounded-md p-0.5 text-[#6f8b78] transition hover:bg-[#edf4ea] hover:text-[#123c2f]"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
