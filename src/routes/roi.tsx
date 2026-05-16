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
import { formatCurrency, MODEL_NAME } from '@/lib/medflow-data'
import { useMedFlow } from '@/lib/medflow-context'

export const Route = createFileRoute('/roi')({
  component: RoiDashboard,
})

function RoiDashboard() {
  const { roiSummary, dataSources } = useMedFlow()

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-4 gap-4">
        <RoiKpi
          title="Units prevented (this run)"
          value={roiSummary.totalUnitsPreventedThisRun.toLocaleString()}
          icon={<PackageCheck className="size-5 text-[#2f6b4f]" />}
        />
        <RoiKpi
          title="Units prevented (all time)"
          value={roiSummary.totalUnitsPreventedAllTime.toLocaleString()}
          icon={<Warehouse className="size-5 text-[#123c2f]" />}
        />
        <RoiKpi
          title="Dollar value saved (this run)"
          value={formatCurrency(roiSummary.dollarValueSavedThisRun)}
          icon={<DollarSign className="size-5 text-[#2f6b4f]" />}
        />
        <RoiKpi
          title="Dollar value saved (all time)"
          value={formatCurrency(roiSummary.dollarValueSavedAllTime)}
          icon={<TrendingUp className="size-5 text-[#123c2f]" />}
        />
      </section>

      <Card className="border-[#d7e5d2] bg-white/90 shadow-2xl shadow-[#123c2f]/10">
        <CardHeader className="border-b border-[#d7e5d2] pb-5">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="whitespace-nowrap text-lg text-[#123c2f]">
              Savings per agent run
            </CardTitle>
            <span className="whitespace-nowrap rounded-full border border-[#6f9d7a]/50 bg-[#edf4ea] px-3 py-1 text-xs font-semibold text-[#2f6b4f]">
              Source: {dataSources.roiSummary}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <div className="rounded-xl border border-[#d7e5d2] bg-[#f7faf5] px-4 py-3 text-sm text-[#123c2f]">
            ROI comes from <code>/api/roi-summary</code>, computed from backend
            observations plus executed tool calls. Dollars saved use the lot quantity and
            unit value captured during each agent run.
          </div>
          <div className="h-[24rem]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={roiSummary.savingsHistory} margin={{ top: 10, right: 18, left: 0, bottom: 6 }}>
                <CartesianGrid stroke="#d7e5d2" vertical={false} />
                <XAxis
                  dataKey="run"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: '#547765', fontSize: 12 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: '#547765', fontSize: 12 }}
                  tickFormatter={(value) => `$${Number(value) / 1000}k`}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(111,157,122,0.12)' }}
                  contentStyle={{
                    background: '#ffffff',
                    border: '1px solid #d7e5d2',
                    borderRadius: '12px',
                    color: '#123c2f',
                  }}
                  formatter={(value) => [formatCurrency(Number(value)), 'Saved']}
                />
                <Bar dataKey="dollarsSaved" fill="#2f6b4f" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="border-t border-[#d7e5d2] pt-3 text-xs text-[#6f8b78]">
            Powered by Nemotron reasoning and NemoClaw policy checks · {MODEL_NAME}
          </p>
        </CardContent>
      </Card>

      <section className="rounded-2xl border border-[#d7e5d2] border-l-4 border-l-[#2f6b4f] bg-white/90 p-8 shadow-2xl shadow-[#123c2f]/10">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#6f8b78]">
          Annualized projection
        </p>
        <div className="mt-4 flex items-end gap-5">
          <p className="text-6xl font-bold tracking-tight text-[#2f6b4f]">$380,000</p>
          <p className="pb-2 text-xl font-semibold text-[#123c2f]">
            projected annual waste prevention
          </p>
        </div>
        <p className="mt-3 text-lg text-[#547765]">
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
    <Card className="border-[#d7e5d2] bg-white/90 shadow-2xl shadow-[#123c2f]/10">
      <CardContent className="pt-0">
        <div className="flex items-start justify-between">
          <div>
            <p className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6f8b78]">
              {title}
            </p>
            <p className="mt-3 text-2xl font-bold text-[#123c2f]">{value}</p>
          </div>
          <div className="rounded-xl border border-[#d7e5d2] bg-[#edf4ea] p-3">{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}
