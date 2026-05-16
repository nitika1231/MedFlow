import { createFileRoute } from '@tanstack/react-router'
import { CheckCircle2, Clock3, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import {
  MODEL_NAME,
  mockReasoningMessages,
  reasoningLots,
  type ReasoningMessage,
  type TraceTag,
} from '@/lib/medflow-data'
import { useMedFlow } from '@/lib/medflow-context'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/reasoning')({
  component: AgentReasoning,
})

type LotProcessingStatus = 'pending' | 'processing' | 'action' | 'blocked' | 'approval'

type TraceEntry = ReasoningMessage & {
  id: string
  receivedAt: number
}

const tagLabels: Record<TraceTag, string> = {
  OBSERVE: 'OBSERVE',
  REASON: 'REASON',
  POLICY_CHECK: 'POLICY CHECK',
  ACTION: 'ACTION',
}

function AgentReasoning() {
  const { inventory, runSequence } = useMedFlow()
  const lots = useMemo(
    () =>
      mergeReasoningLots([
        ...inventory.map((lot) => ({
          id: lot.id,
          medicationName: lot.medicationName,
          lotNumber: lot.lotNumber,
        })),
        ...reasoningLots,
      ]),
    [inventory],
  )
  const [selectedLotId, setSelectedLotId] = useState(lots[0]?.id ?? '')
  const [traces, setTraces] = useState<Record<string, Array<TraceEntry>>>({})
  const [lotStatuses, setLotStatuses] = useState<Record<string, LotProcessingStatus>>(
    () => createInitialStatuses(lots),
  )
  const [socketConnected, setSocketConnected] = useState(false)
  const [streaming, setStreaming] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const mockStartedRef = useRef(false)
  const socketConnectedRef = useRef(false)
  const streamEndRef = useRef<HTMLDivElement | null>(null)

  const appendMessage = useCallback((message: ReasoningMessage) => {
    setTraces((current) => ({
      ...current,
      [message.lot_id]: [
        ...(current[message.lot_id] ?? []),
        {
          ...message,
          id: `${message.lot_id}-${message.tag}-${Date.now()}-${Math.random()}`,
          receivedAt: Date.now(),
        },
      ],
    }))
    setLotStatuses((current) => ({
      ...current,
      [message.lot_id]: statusAfterMessage(message),
    }))
  }, [])

  useEffect(() => {
    setTraces({})
    setLotStatuses(createInitialStatuses(lots))
    setSelectedLotId(lots[0]?.id ?? '')
    setStreaming(true)
    mockStartedRef.current = false
    setAttempt((current) => current + 1)
  }, [lots, runSequence])

  useEffect(() => {
    if (!lots.some((lot) => lot.id === selectedLotId)) {
      setSelectedLotId(lots[0]?.id ?? '')
    }
    setLotStatuses((current) => ({
      ...createInitialStatuses(lots),
      ...current,
    }))
  }, [lots, selectedLotId])

  useEffect(() => {
    let websocket: WebSocket | null = null
    let reconnectTimer = 0
    let fallbackTimer = 0
    let mockTimers: Array<number> = []
    let closed = false

    function connect() {
      websocket = new WebSocket('ws://localhost:8000/ws/agent-trace')

      websocket.onopen = () => {
        if (closed) return
        socketConnectedRef.current = true
        setSocketConnected(true)
        setStreaming(true)
      }

      websocket.onmessage = (event) => {
        const message = parseReasoningMessage(event.data)
        if (message) {
          appendMessage(message)
        }
      }

      websocket.onclose = () => {
        if (closed) return
        socketConnectedRef.current = false
        setSocketConnected(false)
        reconnectTimer = window.setTimeout(() => {
          setAttempt((current) => current + 1)
        }, 2_500)
      }

      websocket.onerror = () => {
        websocket?.close()
      }
    }

    connect()
    fallbackTimer = window.setTimeout(() => {
      if (!socketConnectedRef.current && !mockStartedRef.current) {
        mockStartedRef.current = true
        mockTimers = streamMockMessages(appendMessage, () => setStreaming(false))
      }
    }, 1_000)

    return () => {
      closed = true
      window.clearTimeout(reconnectTimer)
      window.clearTimeout(fallbackTimer)
      mockTimers.forEach((timer) => window.clearTimeout(timer))
      websocket?.close()
    }
  }, [appendMessage, attempt])

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [traces, selectedLotId])

  const selectedTrace = traces[selectedLotId] ?? []
  const selectedLot = useMemo(
    () => lots.find((lot) => lot.id === selectedLotId) ?? lots[0],
    [lots, selectedLotId],
  )

  return (
    <div className="grid h-[calc(100vh-11rem)] grid-cols-[40%_60%] overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/75 shadow-2xl shadow-black/30">
      <aside className="overflow-y-auto border-r border-slate-800 bg-slate-950/65">
        <div className="sticky top-0 border-b border-slate-800 bg-slate-950/95 p-5 backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-white">Medication lots</h1>
              <p className="mt-1 text-sm text-slate-500">
                Nemotron trace router · {socketConnected ? 'WebSocket live' : 'demo stream'}
              </p>
            </div>
            <Badge
              variant="outline"
              className={cn(
                'border-slate-700 bg-slate-900 text-slate-300',
                socketConnected && 'border-emerald-500/40 text-emerald-300',
              )}
            >
              {socketConnected ? 'connected' : 'mock'}
            </Badge>
          </div>
        </div>

        <div className="space-y-2 p-4">
          {lots.map((lot) => (
            <button
              key={lot.id}
              type="button"
              onClick={() => setSelectedLotId(lot.id)}
              className={cn(
                'w-full rounded-xl border p-4 text-left transition',
                selectedLotId === lot.id
                  ? 'border-emerald-400/45 bg-emerald-400/10 shadow-lg shadow-emerald-950/20'
                  : 'border-slate-800 bg-slate-900/45 hover:border-slate-700 hover:bg-slate-900',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-100">{lot.medicationName}</p>
                  <p className="mt-1 font-mono text-xs text-slate-500">{lot.lotNumber}</p>
                </div>
                <LotStatusIndicator status={lotStatuses[lot.id] ?? 'pending'} />
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-col bg-[#0d1117]">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <h2 className="font-mono text-sm font-semibold text-slate-200">
              {selectedLot?.medicationName} · {selectedLot?.lotNumber}
            </h2>
            <p className="mt-1 font-mono text-xs text-slate-500">agent-trace://{selectedLotId}</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 font-mono text-xs text-emerald-200">
            <span className="size-2 rounded-full bg-emerald-400" />
            Model: {MODEL_NAME}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 font-mono text-sm leading-6">
          {selectedTrace.length === 0 ? (
            <div className="text-slate-500">
              Waiting for trace tokens for this lot
              {streaming ? <span className="terminal-cursor ml-1">█</span> : null}
            </div>
          ) : (
            selectedTrace.map((entry) => <TraceLine key={entry.id} entry={entry} />)
          )}
          {streaming ? <span className="terminal-cursor text-slate-200">█</span> : null}
          <div ref={streamEndRef} />
        </div>
      </section>
    </div>
  )
}

function LotStatusIndicator({ status }: { status: LotProcessingStatus }) {
  if (status === 'pending') {
    return <span className="mt-1 size-2.5 rounded-full bg-slate-500" aria-label="Pending" />
  }

  if (status === 'processing') {
    return (
      <span className="relative mt-1 flex size-3" aria-label="Processing">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
        <span className="relative inline-flex size-3 rounded-full bg-sky-400" />
      </span>
    )
  }

  if (status === 'blocked') {
    return <XCircle className="size-5 text-red-400" aria-label="Completed blocked" />
  }

  if (status === 'approval') {
    return <Clock3 className="size-5 text-amber-300" aria-label="Awaiting approval" />
  }

  return <CheckCircle2 className="size-5 text-emerald-300" aria-label="Completed action taken" />
}

function TraceLine({ entry }: { entry: TraceEntry }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-1 grid grid-cols-[9.5rem_1fr] gap-3 py-1">
      <span className={cn('font-semibold', tagClass(entry))}>[{tagLabels[entry.tag]}]</span>
      <span className="whitespace-pre-wrap text-slate-300">{entry.content}</span>
    </div>
  )
}

function createInitialStatuses(lots: typeof reasoningLots) {
  return Object.fromEntries(lots.map((lot) => [lot.id, 'pending'])) as Record<
    string,
    LotProcessingStatus
  >
}

function mergeReasoningLots(lots: typeof reasoningLots) {
  const seen = new Set<string>()
  return lots.filter((lot) => {
    if (seen.has(lot.id)) {
      return false
    }
    seen.add(lot.id)
    return true
  })
}

function statusAfterMessage(message: ReasoningMessage): LotProcessingStatus {
  if (message.tag !== 'ACTION') {
    return 'processing'
  }

  const content = message.content.toLowerCase()
  if (content.includes('quarantine') || content.includes('block')) {
    return 'blocked'
  }
  if (content.includes('approval')) {
    return 'approval'
  }
  return 'action'
}

function tagClass(entry: TraceEntry) {
  if (entry.tag === 'OBSERVE') return 'text-blue-400'
  if (entry.tag === 'POLICY_CHECK') return 'text-amber-300'
  if (entry.tag === 'ACTION') {
    const content = entry.content.toLowerCase()
    return content.includes('block') || content.includes('quarantine')
      ? 'text-red-400'
      : 'text-emerald-300'
  }
  return 'text-slate-100'
}

function parseReasoningMessage(value: unknown): ReasoningMessage | null {
  try {
    const parsed = JSON.parse(String(value)) as Partial<ReasoningMessage>
    if (
      parsed.type === 'reasoning' &&
      typeof parsed.content === 'string' &&
      isTraceTag(parsed.tag) &&
      typeof parsed.lot_id === 'string'
    ) {
      return {
        type: 'reasoning',
        content: parsed.content,
        tag: parsed.tag,
        lot_id: parsed.lot_id,
      }
    }
  } catch {
    return null
  }

  return null
}

function isTraceTag(value: unknown): value is TraceTag {
  return value === 'OBSERVE' || value === 'REASON' || value === 'POLICY_CHECK' || value === 'ACTION'
}

function streamMockMessages(
  appendMessage: (message: ReasoningMessage) => void,
  onComplete: () => void,
): Array<number> {
  const timers = mockReasoningMessages.map((message, index) =>
    window.setTimeout(() => appendMessage(message), 520 + index * 720),
  )
  const completeTimer = window.setTimeout(onComplete, 520 + mockReasoningMessages.length * 720)
  timers.push(completeTimer)
  return timers
}
