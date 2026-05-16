import { createFileRoute } from '@tanstack/react-router'
import { Download, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

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
import { mockAuditLog, type AuditLogEntry, type NemoClawResult } from '@/lib/medflow-data'
import { useMedFlow } from '@/lib/medflow-context'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/audit')({
  component: AuditLog,
})

function AuditLog() {
  const { auditLog, agentStatus, runSequence } = useMedFlow()
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<Array<AuditLogEntry>>(auditLog)
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (agentStatus !== 'running') {
      setRows(auditLog)
      return
    }

    setRows([])
    setFreshIds(new Set())
    const timers = mockAuditLog.map((entry, index) =>
      window.setTimeout(() => {
        const liveEntry = {
          ...entry,
          id: `${entry.id}-run-${runSequence}`,
          timestamp: new Date().toISOString(),
        }
        setRows((current) => [liveEntry, ...current])
        setFreshIds((current) => new Set(current).add(liveEntry.id))
        window.setTimeout(() => {
          setFreshIds((current) => {
            const next = new Set(current)
            next.delete(liveEntry.id)
            return next
          })
        }, 2_000)
      }, 900 + index * 1_250),
    )

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [agentStatus, auditLog, runSequence])

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return rows
    }

    return rows.filter(
      (row) =>
        row.medicationName.toLowerCase().includes(query) ||
        row.nemoClawResult.toLowerCase().includes(query),
    )
  }, [rows, search])

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
    <Card className="border-slate-800 bg-slate-950/70 shadow-2xl shadow-black/20">
      <CardContent className="space-y-5 pt-0">
        <div className="flex items-center justify-between gap-4">
          <div className="relative w-[26rem]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search medication or NemoClaw result"
              className="h-10 w-full rounded-lg border border-slate-800 bg-slate-900 pl-9 pr-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/15"
            />
          </div>
          <div className="flex items-center gap-4">
            <p className="text-sm text-slate-400">Showing {filteredRows.length} entries</p>
            <Button
              type="button"
              variant="outline"
              onClick={exportCsv}
              className="border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
            >
              <Download className="size-4" />
              Export CSV
            </Button>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-transparent">
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
            {filteredRows.map((row) => (
              <TableRow
                key={row.id}
                className={cn(
                  'animate-in fade-in slide-in-from-top-2 border-slate-800/80 hover:bg-slate-900/70',
                  freshIds.has(row.id) && 'bg-emerald-500/10 transition-colors duration-[2000ms]',
                )}
              >
                <TableCell className="font-mono text-xs text-slate-300">
                  {formatTime(row.timestamp)}
                </TableCell>
                <TableCell className="font-semibold text-slate-100">{row.medicationName}</TableCell>
                <TableCell className="font-mono text-slate-300">{row.lotId}</TableCell>
                <TableCell className="max-w-[18rem] whitespace-normal text-slate-300">
                  {row.proposedAction}
                </TableCell>
                <TableCell>
                  <NemoClawBadge result={row.nemoClawResult} />
                </TableCell>
                <TableCell className="max-w-[15rem] whitespace-normal text-slate-500">
                  {row.blockReason || '-'}
                </TableCell>
                <TableCell className="font-mono text-xs text-slate-300">{row.toolCalled}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      row.humanApprovalRequired
                        ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                        : 'border-slate-600 bg-slate-800 text-slate-300',
                    )}
                  >
                    {row.humanApprovalRequired ? 'Yes' : 'No'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span
                    title={row.modelUsed}
                    className="block max-w-[12rem] truncate font-mono text-xs text-slate-400"
                  >
                    {row.modelUsed}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
        result === 'PASS' && 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
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
