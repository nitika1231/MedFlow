import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  getAuditLog,
  getInventory,
  getMemoryPatterns,
  getRoiSummary,
  mockAuditLog,
  mockInventory,
  mockMemoryPattern,
  mockMemoryTimeline,
  mockRoiSummary,
  postJson,
  type AuditLogEntry,
  type InventoryLot,
  type MemoryPatternsResponse,
  type RoiSummary,
} from '@/lib/medflow-data'

type AgentStatus = 'idle' | 'running' | 'completed'

type ToastTone = 'default' | 'success' | 'warning' | 'danger'

type ToastMessage = {
  id: string
  message: string
  tone: ToastTone
}

type MedFlowContextValue = {
  agentStatus: AgentStatus
  runSequence: number
  isAgentRunning: boolean
  inventory: Array<InventoryLot>
  auditLog: Array<AuditLogEntry>
  memory: MemoryPatternsResponse
  roiSummary: RoiSummary
  toasts: Array<ToastMessage>
  runAgent: () => void
  resetDemo: () => void
  dismissToast: (id: string) => void
  pushToast: (message: string, tone?: ToastTone) => void
}

const MedFlowContext = createContext<MedFlowContextValue | null>(null)

const defaultMemory: MemoryPatternsResponse = {
  patterns: [mockMemoryPattern],
  timeline: mockMemoryTimeline,
  isDemoFallback: true,
}

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export function MedFlowProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle')
  const [runSequence, setRunSequence] = useState(0)
  const [toasts, setToasts] = useState<Array<ToastMessage>>([])
  const runTimersRef = useRef<Array<number>>([])
  const agentStatusRef = useRef<AgentStatus>('idle')

  const isAgentRunning = agentStatus === 'running'
  agentStatusRef.current = agentStatus

  const inventoryQuery = useQuery({
    queryKey: ['medflow', 'inventory'],
    queryFn: getInventory,
    initialData: mockInventory,
    refetchInterval: isAgentRunning ? 3_000 : false,
  })

  const auditLogQuery = useQuery({
    queryKey: ['medflow', 'audit-log'],
    queryFn: getAuditLog,
    initialData: mockAuditLog,
    refetchInterval: isAgentRunning ? 3_000 : false,
  })

  const memoryQuery = useQuery({
    queryKey: ['medflow', 'memory-patterns'],
    queryFn: getMemoryPatterns,
    initialData: defaultMemory,
  })

  const roiSummaryQuery = useQuery({
    queryKey: ['medflow', 'roi-summary'],
    queryFn: getRoiSummary,
    initialData: mockRoiSummary,
    refetchInterval: isAgentRunning ? 3_000 : false,
  })

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const pushToast = useCallback(
    (message: string, tone: ToastTone = 'default') => {
      const id = createId('toast')
      setToasts((current) => [...current, { id, message, tone }])
      window.setTimeout(() => dismissToast(id), 4_000)
    },
    [dismissToast],
  )

  const clearRunTimers = useCallback(() => {
    runTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    runTimersRef.current = []
  }, [])

  const scheduleRunToasts = useCallback(() => {
    clearRunTimers()
    const schedule = (delay: number, message: string, tone: ToastTone) => {
      const timer = window.setTimeout(() => pushToast(message, tone), delay)
      runTimersRef.current.push(timer)
    }

    pushToast('Agent started — monitoring 6 lots', 'default')
    schedule(2_000, '✓ Transfer approved — Cefazolin → Satellite Clinic', 'success')
    schedule(3_600, '⚠ Lot quarantined — Insulin INS-8832', 'danger')
    schedule(5_200, '⏳ Human approval required — Vincristine VIN-2291', 'warning')
  }, [clearRunTimers, pushToast])

  const runAgent = useCallback(() => {
    if (agentStatusRef.current === 'running') {
      return
    }

    setAgentStatus('running')
    setRunSequence((current) => current + 1)
    scheduleRunToasts()

    void (async () => {
      await queryClient.invalidateQueries({ queryKey: ['medflow', 'inventory'] })
      await Promise.allSettled([
        postJson('/api/run-agent', { source: 'frontend-dashboard' }),
        wait(6_600),
      ])
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ['medflow', 'inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['medflow', 'audit-log'] }),
        queryClient.invalidateQueries({ queryKey: ['medflow', 'roi-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['medflow', 'memory-patterns'] }),
      ])
      setAgentStatus('completed')
      pushToast('Agent run complete — 3 actions taken', 'success')
    })()
  }, [queryClient, pushToast, scheduleRunToasts])

  const resetDemo = useCallback(() => {
    clearRunTimers()
    setAgentStatus('idle')
    setRunSequence((current) => current + 1)
    setToasts([])
    queryClient.setQueryData(['medflow', 'inventory'], mockInventory)
    queryClient.setQueryData(['medflow', 'audit-log'], mockAuditLog)
    queryClient.setQueryData(['medflow', 'memory-patterns'], defaultMemory)
    queryClient.setQueryData(['medflow', 'roi-summary'], mockRoiSummary)
  }, [clearRunTimers, queryClient])

  const value = useMemo<MedFlowContextValue>(
    () => ({
      agentStatus,
      runSequence,
      isAgentRunning,
      inventory: inventoryQuery.data,
      auditLog: auditLogQuery.data,
      memory: memoryQuery.data,
      roiSummary: roiSummaryQuery.data,
      toasts,
      runAgent,
      resetDemo,
      dismissToast,
      pushToast,
    }),
    [
      agentStatus,
      auditLogQuery.data,
      dismissToast,
      inventoryQuery.data,
      isAgentRunning,
      memoryQuery.data,
      pushToast,
      resetDemo,
      roiSummaryQuery.data,
      runAgent,
      runSequence,
      toasts,
    ],
  )

  return <MedFlowContext.Provider value={value}>{children}</MedFlowContext.Provider>
}

export function useMedFlow() {
  const context = useContext(MedFlowContext)
  if (!context) {
    throw new Error('useMedFlow must be used inside MedFlowProvider')
  }

  return context
}
