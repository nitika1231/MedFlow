import { createFileRoute } from '@tanstack/react-router'
import { BrainCircuit, Database, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  formatCurrency,
  mockMemoryPattern,
  MODEL_NAME,
  type MemoryPattern,
} from '@/lib/medflow-data'
import { useMedFlow } from '@/lib/medflow-context'

export const Route = createFileRoute('/memory')({
  component: MemoryAndPatterns,
})

function MemoryAndPatterns() {
  const { memory, dataSources } = useMedFlow()
  const hasLivePatterns = memory.patterns.length > 0
  const patternCards = hasLivePatterns ? memory.patterns : [mockMemoryPattern]

  return (
    <div className="space-y-6">
      {!hasLivePatterns ? (
        <div className="rounded-2xl border border-dashed border-[#b8cdb1] bg-white/70 p-10 text-center">
          <Database className="mx-auto size-10 text-[#6f8b78]" />
          <p className="mt-4 text-lg font-semibold text-[#123c2f]">
            Run the agent at least twice to detect recurring waste patterns.
          </p>
          <p className="mt-2 text-sm text-[#547765]">
            Demo preview is shown below so the memory surface is visible offline.
          </p>
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-4">
        {patternCards.map((pattern) => (
          <PatternCard key={pattern.id} pattern={pattern} />
        ))}
      </section>

      <Card className="border-[#d7e5d2] bg-white/90 shadow-2xl shadow-[#123c2f]/10">
        <CardHeader className="border-b border-[#d7e5d2] pb-5">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 whitespace-nowrap text-lg text-[#123c2f]">
              <BrainCircuit className="size-5 text-[#2f6b4f]" />
              Memory timeline
            </CardTitle>
            <span className="whitespace-nowrap rounded-full border border-[#6f9d7a]/50 bg-[#edf4ea] px-3 py-1 text-xs font-semibold text-[#2f6b4f]">
              Source: {dataSources.memory}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="rounded-xl border border-[#d7e5d2] bg-[#f7faf5] px-4 py-3 text-sm text-[#123c2f]">
            Memory patterns come from <code>/api/memory/patterns</code>. The backend
            increments observed runs when similar expiration, block, or approval
            signals recur across agent runs.
          </div>
          {memory.timeline.length === 0 ? (
            <div className="py-12 text-center text-sm text-[#547765]">
              No memory events recorded yet.
            </div>
          ) : (
            <div className="relative space-y-0">
              <div className="absolute left-[11.45rem] top-3 h-[calc(100%-1.5rem)] w-px bg-[#b8cdb1]" />
              {memory.timeline.map((entry) => (
                <div
                  key={entry.id}
                  className="relative grid grid-cols-[10rem_1fr] gap-10 py-4"
                >
                  <div className="text-right">
                    <p className="font-mono text-xs text-[#547765]">
                      {formatTimelineTime(entry.timestamp)}
                    </p>
                  </div>
                  <div className="relative rounded-xl border border-[#d7e5d2] bg-[#f7faf5] p-4">
                    <span className="absolute -left-[2.85rem] top-5 size-3 rounded-full border border-[#2f6b4f] bg-white shadow-[0_0_0_5px_rgba(248,252,247,1)]" />
                    <p className="font-semibold text-[#123c2f]">{entry.medicationName}</p>
                    <p className="mt-1 text-sm text-[#547765]">
                      {entry.actionTaken} · {entry.unitsSaved} units saved
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="border-t border-[#d7e5d2] pt-3 text-xs text-[#6f8b78]">
            Powered by Nemotron reasoning and NemoClaw policy checks · {MODEL_NAME}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function PatternCard({ pattern }: { pattern: MemoryPattern }) {
  return (
    <Card className="border-[#d7e5d2] bg-white/90 shadow-2xl shadow-[#123c2f]/10">
      <CardHeader className="border-b border-[#d7e5d2] pb-4">
        <div className="flex items-start justify-between gap-4">
          <CardTitle className="truncate text-base text-[#123c2f]">
            {pattern.medicationName} · {pattern.location}
          </CardTitle>
          <Badge
            variant="outline"
            className="border-[#6f9d7a]/50 bg-[#edf4ea] text-[#2f6b4f]"
          >
            Observed {pattern.observedRuns} runs
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-0">
        <p className="text-sm leading-6 text-[#547765]">{pattern.description}</p>
        <div className="rounded-xl border border-[#d7e5d2] bg-[#f7faf5] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#6f8b78]">
            <Sparkles className="size-4 text-[#2f6b4f]" />
            Recommended reorder adjustment
          </div>
          <p className="mt-2 text-sm text-[#123c2f]">{pattern.reorderAdjustment}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6f8b78]">
            Estimated monthly savings
          </p>
          <p className="mt-2 text-3xl font-bold text-[#2f6b4f]">
            {formatCurrency(pattern.estimatedMonthlySavings)}/mo
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function formatTimelineTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
