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
