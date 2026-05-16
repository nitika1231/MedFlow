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
  const { inventory, runSequence, dataSources } = useMedFlow()
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
  const [traceSource, setTraceSource] = useState<'waiting' | 'live' | 'demo'>('waiting')
  const [attempt, setAttempt] = useState(0)
  const autoSelectTraceRef = useRef(true)
  const mockStartedRef = useRef(false)
  const messageReceivedRef = useRef(false)
  const socketConnectedRef = useRef(false)
  const streamEndRef = useRef<HTMLDivElement | null>(null)

  const appendMessage = useCallback((message: ReasoningMessage) => {
    messageReceivedRef.current = true
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
    if (autoSelectTraceRef.current) {
      setSelectedLotId(message.lot_id)
      autoSelectTraceRef.current = false
    }
    setLotStatuses((current) => ({
      ...current,
      [message.lot_id]: statusAfterMessage(message),
    }))
  }, [])

  useEffect(() => {
    setTraces({})
    setLotStatuses(createInitialStatuses(lots))
    setStreaming(true)
    setTraceSource('waiting')
    autoSelectTraceRef.current = true
    mockStartedRef.current = false
    messageReceivedRef.current = false
    setAttempt((current) => current + 1)
  }, [runSequence])

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
          setTraceSource('live')
          appendMessage(message)
        }
      }

      websocket.onclose = () => {
        if (closed) return
        socketConnectedRef.current = false
        setSocketConnected(false)
        reconnectTimer = window.setTimeout(() => {
          if (!mockStartedRef.current) {
            setAttempt((current) => current + 1)
          }
        }, 2_500)
      }

      websocket.onerror = () => {
        websocket?.close()
      }
    }

    connect()
    fallbackTimer = window.setTimeout(() => {
      if (!messageReceivedRef.current && !mockStartedRef.current) {
        mockStartedRef.current = true
        setTraceSource('demo')
        mockTimers = streamMockMessages(appendMessage, () => setStreaming(false))
      }
    }, 1_200)

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
    <div className="grid h-[calc(100vh-11rem)] grid-cols-[40%_60%] overflow-hidden rounded-2xl border border-[#d7e5d2] bg-white/90 shadow-2xl shadow-[#123c2f]/10">
      <aside className="overflow-y-auto border-r border-[#d7e5d2] bg-[#f7faf5]">
        <div className="sticky top-0 border-b border-[#d7e5d2] bg-white/95 p-5 backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="whitespace-nowrap text-lg font-semibold text-[#123c2f]">
                Medication lots
              </h1>
              <p className="mt-1 text-sm text-[#547765]">
                {traceSource === 'live'
                  ? 'Live trace from ws://localhost:8000/ws/agent-trace'
                  : traceSource === 'demo'
                    ? 'Demo trace preview; click Run Agent for live backend reasoning'
                    : socketConnected
                      ? 'Connected to backend trace stream; waiting for Run Agent'
                      : 'Backend WebSocket unavailable; preparing demo trace'}
              </p>
            </div>
            <Badge
              variant="outline"
              className={cn(
                'border-[#c7d8c2] bg-white text-[#547765]',
                socketConnected && 'border-[#6f9d7a]/50 text-[#2f6b4f]',
              )}
            >
              {traceSource === 'live'
                ? 'WebSocket live'
                : traceSource === 'demo'
                  ? 'Demo trace'
                  : socketConnected
                    ? 'Connected'
                    : 'Connecting'}
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
                  ? 'border-[#2f6b4f]/45 bg-[#edf4ea] shadow-lg shadow-[#123c2f]/10'
                  : 'border-[#d7e5d2] bg-white hover:border-[#b8cdb1] hover:bg-[#f0f6ed]',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-[#123c2f]">{lot.medicationName}</p>
                  <p className="mt-1 font-mono text-xs text-[#6f8b78]">{lot.lotNumber}</p>
                </div>
                <LotStatusIndicator status={lotStatuses[lot.id] ?? 'pending'} />
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-col bg-[#123c2f]">
        <div className="flex items-center justify-between border-b border-[#d7e5d2]/20 px-5 py-4">
          <div>
            <h2 className="font-mono text-sm font-semibold text-[#eef6ec]">
              {selectedLot?.medicationName} · {selectedLot?.lotNumber}
            </h2>
            <p className="mt-1 font-mono text-xs text-[#b8cdb1]">
              agent-trace://{selectedLotId} · inventory source: {dataSources.inventory}
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#d7e5d2]/30 bg-white/10 px-3 py-1.5 text-xs font-semibold text-[#eef6ec]">
            NemoClaw policy gate active
          </div>
        </div>

        <div className="border-b border-[#d7e5d2]/20 bg-white/5 px-5 py-3 text-sm text-[#eef6ec]">
          <span className="font-semibold text-[#d7e5d2]">How NemoClaw works:</span>{' '}
          it reads the Nemotron recommendation, then returns one policy decision:
          <span className="mx-1 rounded bg-[#d7e5d2]/15 px-1.5 text-[#d7e5d2]">PASS</span>
          for safe low-risk actions,
          <span className="mx-1 rounded bg-red-400/15 px-1.5 text-red-200">BLOCK</span>
          for safety/cold-chain/recall risk, or
          <span className="mx-1 rounded bg-amber-300/15 px-1.5 text-amber-200">
            APPROVAL REQUIRED
          </span>
          for high-value or controlled workflows.
        </div>

        <div className="flex-1 overflow-y-auto p-5 font-mono text-sm leading-6">
          {selectedTrace.length === 0 ? (
            <div className="text-[#b8cdb1]">
              Waiting for trace tokens for this lot
              {streaming ? <span className="terminal-cursor ml-1">█</span> : null}
            </div>
          ) : (
            selectedTrace.map((entry) => <TraceLine key={entry.id} entry={entry} />)
          )}
          {streaming ? <span className="terminal-cursor text-[#eef6ec]">█</span> : null}
          <div ref={streamEndRef} />
        </div>
        <p className="border-t border-[#d7e5d2]/20 px-5 py-3 text-xs text-[#b8cdb1]">
          Powered by Nemotron reasoning and NemoClaw policy checks · {MODEL_NAME}
        </p>
      </section>
    </div>
  )
}

function LotStatusIndicator({ status }: { status: LotProcessingStatus }) {
  if (status === 'pending') {
    return <span className="mt-1 size-2.5 rounded-full bg-[#9fb79a]" aria-label="Pending" />
  }

  if (status === 'processing') {
    return (
      <span className="relative mt-1 flex size-3" aria-label="Processing">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2f6b4f] opacity-75" />
        <span className="relative inline-flex size-3 rounded-full bg-[#2f6b4f]" />
      </span>
    )
  }

  if (status === 'blocked') {
    return <XCircle className="size-5 text-red-400" aria-label="Completed blocked" />
  }

  if (status === 'approval') {
    return <Clock3 className="size-5 text-amber-300" aria-label="Awaiting approval" />
  }

  return <CheckCircle2 className="size-5 text-[#2f6b4f]" aria-label="Completed action taken" />
}

function TraceLine({ entry }: { entry: TraceEntry }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-1 grid grid-cols-[9.5rem_1fr] gap-3 py-1">
      <span className={cn('font-semibold', tagClass(entry))}>[{tagLabels[entry.tag]}]</span>
      <span className="whitespace-pre-wrap text-[#eef6ec]">{entry.content}</span>
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
  if (entry.tag === 'OBSERVE') return 'text-[#b9d2ae]'
  if (entry.tag === 'POLICY_CHECK') return 'text-amber-300'
  if (entry.tag === 'ACTION') {
    const content = entry.content.toLowerCase()
    return content.includes('block') || content.includes('quarantine')
      ? 'text-red-400'
      : 'text-[#d7e5d2]'
  }
  return 'text-white'
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
