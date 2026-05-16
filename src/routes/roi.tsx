import { createFileRoute } from '@tanstack/react-router'
import { DollarSign, PackageCheck, TrendingUp, Warehouse } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/medflow-data'
import { useMedFlow } from '@/lib/medflow-context'

export const Route = createFileRoute('/roi')({
  component: RoiDashboard,
})

function RoiDashboard() {
  const { roiSummary } = useMedFlow()

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-4 gap-4">
        <RoiKpi
          title="Units prevented (this run)"
          value={roiSummary.totalUnitsPreventedThisRun.toLocaleString()}
          icon={<PackageCheck className="size-5 text-emerald-300" />}
        />
        <RoiKpi
          title="Units prevented (all time)"
          value={roiSummary.totalUnitsPreventedAllTime.toLocaleString()}
          icon={<Warehouse className="size-5 text-sky-300" />}
        />
        <RoiKpi
          title="Dollar value saved (this run)"
          value={formatCurrency(roiSummary.dollarValueSavedThisRun)}
          icon={<DollarSign className="size-5 text-emerald-300" />}
        />
        <RoiKpi
          title="Dollar value saved (all time)"
          value={formatCurrency(roiSummary.dollarValueSavedAllTime)}
          icon={<TrendingUp className="size-5 text-sky-300" />}
        />
      </section>

      <Card className="border-slate-800 bg-slate-950/70 shadow-2xl shadow-black/20">
        <CardHeader className="border-b border-slate-800 pb-5">
          <CardTitle className="text-lg text-white">Savings per agent run</CardTitle>
        </CardHeader>
        <CardContent className="h-[24rem] pt-6">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={roiSummary.savingsHistory} margin={{ top: 10, right: 18, left: 0, bottom: 6 }}>
              <CartesianGrid stroke="#1f2937" vertical={false} />
              <XAxis
                dataKey="run"
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#94a3b8', fontSize: 12 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#94a3b8', fontSize: 12 }}
                tickFormatter={(value) => `$${Number(value) / 1000}k`}
              />
              <Tooltip
                cursor={{ fill: 'rgba(16,185,129,0.08)' }}
                contentStyle={{
                  background: '#020617',
                  border: '1px solid #1e293b',
                  borderRadius: '12px',
                  color: '#e2e8f0',
                }}
                formatter={(value) => [formatCurrency(Number(value)), 'Saved']}
              />
              <Bar dataKey="dollarsSaved" fill="#34d399" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <section className="rounded-2xl border border-slate-800 border-l-4 border-l-emerald-400 bg-slate-950/80 p-8 shadow-2xl shadow-black/20">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
          Annualized projection
        </p>
        <div className="mt-4 flex items-end gap-5">
          <p className="text-6xl font-bold tracking-tight text-emerald-300">$380,000</p>
          <p className="pb-2 text-xl font-semibold text-slate-200">
            projected annual waste prevention
          </p>
        </div>
        <p className="mt-3 text-lg text-slate-400">
          Across a 500-bed hospital, MedFlow projects $380,000 in annual waste prevention.
        </p>
      </section>
    </div>
  )
}

function RoiKpi({
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
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {title}
            </p>
            <p className="mt-3 text-2xl font-bold text-white">{value}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}
