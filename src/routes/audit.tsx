import { createFileRoute } from '@tanstack/react-router'
import { Download, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MODEL_NAME, type AuditLogEntry, type NemoClawResult } from '@/lib/medflow-data'
import { useMedFlow } from '@/lib/medflow-context'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/audit')({
  component: AuditLog,
})

function AuditLog() {
  const { auditLog, dataSources } = useMedFlow()
  const [search, setSearch] = useState('')
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())
  const previousIdsRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    const currentIds = new Set(auditLog.map((row) => row.id))
    const previousIds = previousIdsRef.current
    previousIdsRef.current = currentIds

    if (!previousIds) {
      return
    }

    const newIds = auditLog
      .map((row) => row.id)
      .filter((id) => !previousIds.has(id))

    if (newIds.length === 0) {
      return
    }

    setFreshIds((current) => {
      const next = new Set(current)
      newIds.forEach((id) => next.add(id))
      return next
    })

    const timers = newIds.map((id) =>
      window.setTimeout(() => {
        setFreshIds((current) => {
          const next = new Set(current)
          next.delete(id)
          return next
        })
      }, 2_000),
    )

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [auditLog])

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return auditLog
    }

    return auditLog.filter(
      (row) =>
        row.medicationName.toLowerCase().includes(query) ||
        row.nemoClawResult.toLowerCase().includes(query),
    )
  }, [auditLog, search])

  const sourceDescription =
    dataSources.auditLog === 'Backend API'
      ? 'Live rows from GET /api/audit-log. This reflects the latest recorded backend agent run.'
      : 'Demo fallback rows are shown because GET /api/audit-log is not reachable.'

  function exportCsv() {
    const csv = toCsv(filteredRows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `medflow-audit-log-${Date.now()}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card className="border-[#d7e5d2] bg-white/90 shadow-2xl shadow-[#123c2f]/10">
      <CardContent className="space-y-5 pt-0">
        <div className="flex items-center justify-between gap-4">
          <div className="relative w-[26rem]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#6f8b78]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search medication or NemoClaw result"
              className="h-10 w-full rounded-lg border border-[#d7e5d2] bg-white pl-9 pr-3 text-sm text-[#123c2f] outline-none transition placeholder:text-[#9aaf9a] focus:border-[#2f6b4f]/60 focus:ring-2 focus:ring-[#6f9d7a]/20"
            />
          </div>
          <div className="flex items-center gap-4">
            <p className="text-sm text-[#547765]">Showing {filteredRows.length} entries</p>
            <Button
              type="button"
              variant="outline"
              onClick={exportCsv}
              className="border-[#2f6b4f] bg-white text-[#123c2f] hover:bg-[#edf4ea]"
            >
              <Download className="size-4" />
              Export CSV
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-[#d7e5d2] bg-[#f7faf5] px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6f8b78]">
              Audit data source and NemoClaw meaning
            </p>
            <p className="mt-1 text-sm text-[#123c2f]">{sourceDescription}</p>
            <p className="mt-1 text-sm text-[#547765]">
              NemoClaw is the policy gate: PASS allows an autonomous tool call, BLOCK
              prevents unsafe action and records the reason, APPROVAL REQUIRED creates a
              human pharmacist review step.
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'border-[#c7d8c2] bg-white text-[#547765]',
              dataSources.auditLog === 'Backend API' &&
                'border-[#6f9d7a]/50 bg-[#edf4ea] text-[#2f6b4f]',
            )}
          >
            {dataSources.auditLog}
          </Badge>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="border-[#d7e5d2] hover:bg-transparent">
              <TableHead>Timestamp</TableHead>
              <TableHead>Medication</TableHead>
              <TableHead>Lot ID</TableHead>
              <TableHead>Proposed action</TableHead>
              <TableHead>NemoClaw result</TableHead>
              <TableHead>Block reason</TableHead>
              <TableHead>Tool called</TableHead>
              <TableHead>Human approval</TableHead>
              <TableHead>Model used</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow className="border-[#d7e5d2]/80 hover:bg-transparent">
                <TableCell colSpan={9} className="py-10 text-center text-[#547765]">
                  No audit rows yet. Run the agent to create backend audit entries.
                </TableCell>
              </TableRow>
            ) : null}
            {filteredRows.map((row) => (
              <TableRow
                key={row.id}
                className={cn(
                  'animate-in fade-in slide-in-from-top-2 border-[#d7e5d2]/80 hover:bg-[#f0f6ed]',
                  freshIds.has(row.id) && 'bg-[#d7e5d2]/60 transition-colors duration-[2000ms]',
                )}
              >
                <TableCell className="font-mono text-xs text-[#547765]">
                  {formatTime(row.timestamp)}
                </TableCell>
                <TableCell className="font-semibold text-[#123c2f]">{row.medicationName}</TableCell>
                <TableCell className="font-mono text-[#3f5f4e]">{row.lotId}</TableCell>
                <TableCell className="max-w-[18rem] whitespace-normal text-[#3f5f4e]">
                  {row.proposedAction}
                </TableCell>
                <TableCell>
                  <NemoClawBadge result={row.nemoClawResult} />
                </TableCell>
                <TableCell className="max-w-[15rem] whitespace-normal text-[#6f8b78]">
                  {row.blockReason || '-'}
                </TableCell>
                <TableCell className="font-mono text-xs text-[#3f5f4e]">{row.toolCalled}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      row.humanApprovalRequired
                        ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                        : 'border-[#c7d8c2] bg-[#f7faf5] text-[#547765]',
                    )}
                  >
                    {row.humanApprovalRequired ? 'Yes' : 'No'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span
                    title={row.modelUsed}
                    className="block max-w-[12rem] truncate font-mono text-xs text-[#547765]"
                  >
                    {row.modelUsed}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="border-t border-[#d7e5d2] pt-3 text-xs text-[#6f8b78]">
          Powered by Nemotron reasoning and NemoClaw policy checks · {MODEL_NAME}
        </p>
      </CardContent>
    </Card>
  )
}

function NemoClawBadge({ result }: { result: NemoClawResult }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'font-mono',
        result === 'PASS' && 'border-[#6f9d7a]/50 bg-[#edf4ea] text-[#2f6b4f]',
        result === 'BLOCK' && 'border-red-500/40 bg-red-500/15 text-red-300',
        result === 'APPROVAL REQUIRED' && 'border-amber-500/40 bg-amber-500/15 text-amber-300',
      )}
    >
      {result}
    </Badge>
  )
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function toCsv(rows: Array<AuditLogEntry>) {
  const headers = [
    'Timestamp',
    'Medication',
    'Lot ID',
    'Proposed action',
    'NemoClaw result',
    'Block reason',
    'Tool called',
    'Human approval required',
    'Model used',
  ]
  const values = rows.map((row) => [
    formatTime(row.timestamp),
    row.medicationName,
    row.lotId,
    row.proposedAction,
    row.nemoClawResult,
    row.blockReason ?? '',
    row.toolCalled,
    row.humanApprovalRequired ? 'Yes' : 'No',
    row.modelUsed,
  ])

  return [headers, ...values].map((line) => line.map(csvCell).join(',')).join('\n')
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}
