import { createFileRoute } from '@tanstack/react-router'
import { BrainCircuit, Database, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency, mockMemoryPattern, type MemoryPattern } from '@/lib/medflow-data'
import { useMedFlow } from '@/lib/medflow-context'

export const Route = createFileRoute('/memory')({
  component: MemoryAndPatterns,
})

function MemoryAndPatterns() {
  const { memory } = useMedFlow()
  const hasLivePatterns = memory.patterns.length > 0
  const patternCards = hasLivePatterns ? memory.patterns : [mockMemoryPattern]

  return (
    <div className="space-y-6">
      {!hasLivePatterns ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/45 p-10 text-center">
          <Database className="mx-auto size-10 text-slate-600" />
          <p className="mt-4 text-lg font-semibold text-slate-200">
            Run the agent at least twice to detect recurring waste patterns.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Demo preview is shown below so the memory surface is visible offline.
          </p>
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-4">
        {patternCards.map((pattern) => (
          <PatternCard key={pattern.id} pattern={pattern} />
        ))}
      </section>

      <Card className="border-slate-800 bg-slate-950/70 shadow-2xl shadow-black/20">
        <CardHeader className="border-b border-slate-800 pb-5">
          <CardTitle className="flex items-center gap-2 text-lg text-white">
            <BrainCircuit className="size-5 text-emerald-300" />
            Memory timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {memory.timeline.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              No memory events recorded yet.
            </div>
          ) : (
            <div className="relative space-y-0">
              <div className="absolute left-[11.45rem] top-3 h-[calc(100%-1.5rem)] w-px bg-slate-800" />
              {memory.timeline.map((entry) => (
                <div
                  key={entry.id}
                  className="relative grid grid-cols-[10rem_1fr] gap-10 py-4"
                >
                  <div className="text-right">
                    <p className="font-mono text-xs text-slate-400">
                      {formatTimelineTime(entry.timestamp)}
                    </p>
                  </div>
                  <div className="relative rounded-xl border border-slate-800 bg-slate-900/55 p-4">
                    <span className="absolute -left-[2.85rem] top-5 size-3 rounded-full border border-emerald-300 bg-slate-950 shadow-[0_0_0_5px_rgba(15,23,42,1)]" />
                    <p className="font-semibold text-slate-100">{entry.medicationName}</p>
                    <p className="mt-1 text-sm text-slate-400">
                      {entry.actionTaken} · {entry.unitsSaved} units saved
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function PatternCard({ pattern }: { pattern: MemoryPattern }) {
  return (
    <Card className="border-slate-800 bg-slate-950/70 shadow-2xl shadow-black/20">
      <CardHeader className="border-b border-slate-800 pb-4">
        <div className="flex items-start justify-between gap-4">
          <CardTitle className="text-base text-white">
            {pattern.medicationName} · {pattern.location}
          </CardTitle>
          <Badge
            variant="outline"
            className="border-sky-500/35 bg-sky-500/10 text-sky-300"
          >
            Observed {pattern.observedRuns} runs
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-0">
        <p className="text-sm leading-6 text-slate-400">{pattern.description}</p>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            <Sparkles className="size-4 text-emerald-300" />
            Recommended reorder adjustment
          </div>
          <p className="mt-2 text-sm text-slate-200">{pattern.reorderAdjustment}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Estimated monthly savings
          </p>
          <p className="mt-2 text-3xl font-bold text-emerald-300">
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
