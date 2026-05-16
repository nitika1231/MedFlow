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
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,rgba(16,185,129,0.16),transparent_28rem),radial-gradient(circle_at_80%_12%,rgba(59,130,246,0.14),transparent_26rem)]" />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/88 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-[1440px] items-center gap-6 px-8">
          <Link to="/" className="text-2xl font-bold tracking-tight text-white">
            MedFlow
          </Link>

          <nav className="flex flex-1 items-center justify-center gap-2">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-full px-4 py-2 text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-white"
                activeProps={{
                  className: 'bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/20',
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <AgentStatusIndicator status={agentStatus} />
            <div
              className="max-w-[19rem] truncate rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-300"
              title={MODEL_NAME}
            >
              {MODEL_NAME}
            </div>
            <Button
              onClick={runAgent}
              disabled={isAgentRunning}
              className={cn(
                'h-11 bg-emerald-500 px-5 font-semibold text-slate-950 shadow-lg shadow-emerald-950/30 hover:bg-emerald-400 disabled:bg-emerald-500',
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
          className="text-xs font-medium text-slate-500 underline-offset-4 transition hover:text-slate-300 hover:underline"
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
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400" />
        </span>
        Agent running
      </StatusShell>
    )
  }

  if (status === 'completed') {
    return (
      <StatusShell>
        <CheckCircle2 className="size-4 text-sky-400" />
        Agent completed
      </StatusShell>
    )
  }

  return (
    <StatusShell>
      <span className="size-2.5 rounded-full bg-slate-500" />
      Agent idle
    </StatusShell>
  )
}

function StatusShell({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300">
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
            'animate-in fade-in slide-in-from-bottom-2 flex items-start justify-between gap-3 rounded-xl border bg-slate-950/95 p-4 text-sm text-slate-100 shadow-2xl shadow-black/40 backdrop-blur',
            toast.tone === 'success' && 'border-emerald-400/35',
            toast.tone === 'warning' && 'border-amber-400/40',
            toast.tone === 'danger' && 'border-red-400/40',
            toast.tone === 'default' && 'border-slate-700',
          )}
        >
          <p className="leading-5">{toast.message}</p>
          <button
            type="button"
            className="rounded-md p-0.5 text-slate-500 transition hover:bg-white/10 hover:text-white"
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
