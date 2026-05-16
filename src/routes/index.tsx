import { createFileRoute } from '@tanstack/react-router'
import { AlertTriangle, Boxes, DollarSign } from 'lucide-react'
import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  daysUntil,
  formatCurrency,
  type DemandLevel,
  type InventoryLot,
  type LotStatus,
} from '@/lib/medflow-data'
import { useMedFlow } from '@/lib/medflow-context'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({
  component: InventoryMonitor,
})

function InventoryMonitor() {
  const { inventory } = useMedFlow()
  const atRiskLots = inventory.filter((lot) => daysUntil(lot.expirationDate) <= 14)
  const wasteValueAtRisk = atRiskLots.reduce(
    (total, lot) => total + lot.unitsRemaining * lot.unitValueUsd,
    0,
  )

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-3 gap-4">
        <KpiCard
          title="Total lots monitored"
          value={inventory.length.toLocaleString()}
          icon={<Boxes className="size-5 text-sky-300" />}
        />
        <KpiCard
          title="Lots at risk"
          value={atRiskLots.length.toLocaleString()}
          icon={<AlertTriangle className="size-5 text-amber-300" />}
        />
        <KpiCard
          title="Estimated waste value at risk"
          value={formatCurrency(wasteValueAtRisk)}
          icon={<DollarSign className="size-5 text-emerald-300" />}
        />
      </section>

      <Card className="border-slate-800 bg-slate-950/70 shadow-2xl shadow-black/20">
        <CardHeader className="border-b border-slate-800 pb-5">
          <CardTitle className="text-lg text-white">Inventory Monitor</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead>Medication name</TableHead>
                <TableHead>Lot number</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Units remaining</TableHead>
                <TableHead>Expiration date</TableHead>
                <TableHead>Demand level</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventory.map((lot) => (
                <TableRow key={lot.id} className="border-slate-800/80 hover:bg-slate-900/70">
                  <TableCell className="font-semibold text-slate-100">
                    {lot.medicationName}
                  </TableCell>
                  <TableCell className="font-mono text-slate-300">{lot.lotNumber}</TableCell>
                  <TableCell className="text-slate-300">{lot.location}</TableCell>
                  <TableCell className="text-right font-mono text-slate-100">
                    {lot.unitsRemaining.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <ExpirationBadge lot={lot} />
                  </TableCell>
                  <TableCell>
                    <DemandBadge demand={lot.demandLevel} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={lot.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function KpiCard({
  title,
  value,
  icon,
}: {
  title: string
  value: string
  icon: ReactNode
}) {
  return (
    <Card className="border-slate-800 bg-slate-950/70 shadow-2xl shadow-black/20">
      <CardContent className="pt-0">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
              {title}
            </p>
            <p className="mt-3 text-3xl font-bold text-white">{value}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function ExpirationBadge({ lot }: { lot: InventoryLot }) {
  const days = daysUntil(lot.expirationDate)
  const date = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).format(new Date(lot.expirationDate))

  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-2 border font-mono',
        days < 7 && 'border-red-500/40 bg-red-500/15 text-red-300',
        days >= 7 && days <= 14 && 'border-amber-500/40 bg-amber-500/15 text-amber-300',
        days > 14 && 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
      )}
    >
      {date}
      <span className="text-[10px] opacity-80">{days}d</span>
    </Badge>
  )
}

function DemandBadge({ demand }: { demand: DemandLevel }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        demand === 'Low' && 'border-slate-600 bg-slate-800 text-slate-300',
        demand === 'Medium' && 'border-amber-500/40 bg-amber-500/15 text-amber-300',
        demand === 'High' && 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
      )}
    >
      {demand}
    </Badge>
  )
}

function StatusBadge({ status }: { status: LotStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'font-mono',
        status === 'NORMAL' && 'border-slate-600 bg-slate-800 text-slate-300',
        status === 'AT RISK' && 'border-amber-500/40 bg-amber-500/15 text-amber-300',
        status === 'FLAGGED' && 'border-orange-500/40 bg-orange-500/15 text-orange-300',
        status === 'QUARANTINED' && 'border-red-500/40 bg-red-500/15 text-red-300',
        status === 'PENDING APPROVAL' && 'border-sky-500/40 bg-sky-500/15 text-sky-300',
      )}
    >
      {status}
    </Badge>
  )
}
