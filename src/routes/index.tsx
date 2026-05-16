import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Database,
  FileSearch,
  PackageCheck,
  Play,
  ShieldAlert,
  Sparkles,
  Truck,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  notifyPharmacist,
  quarantineLot,
  requestHumanApproval,
  transferInventory,
  type ToolResult,
  updateReorderRecommendation,
} from '@/lib/medflow.functions'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({
  component: MedFlowDashboard,
})

type RiskVariant = 'success' | 'warning' | 'danger' | 'default'

type MedicationLot = {
  medication: string
  location: string
  expiresInDays: number
  demand: string
  value: string
  risk: string
  riskVariant: RiskVariant
}

type StepKind = 'info' | 'success' | 'danger' | 'warning' | 'tool' | 'muted'

type AgentStep = {
  label: string
  detail: string
  kind: StepKind
}

type AuditRow = {
  medication: string
  reasoning: string
  recommendation: string
  policy: string
  tools: string
  finalStatus: string
  variant: RiskVariant
}

const medicationLots: Array<MedicationLot> = [
  {
    medication: 'Cefazolin 1g vial',
    location: 'Main Hospital Pharmacy',
    expiresInDays: 9,
    demand: '18 units/week, overstocked by 3x',
    value: '$3,200 at risk',
    risk: 'Expiration Waste',
    riskVariant: 'warning',
  },
  {
    medication: 'Insulin glargine pen',
    location: 'Reno West Clinic',
    expiresInDays: 62,
    demand: 'Cold-chain excursion detected',
    value: '$3,412 lot value',
    risk: 'Cold-Chain Risk',
    riskVariant: 'danger',
  },
  {
    medication: 'Oncology Med 20mg',
    location: 'North Oncology Satellite',
    expiresInDays: 21,
    demand: 'High-value controlled workflow',
    value: '$18,900 lot value',
    risk: 'Approval Required',
    riskVariant: 'default',
  },
]

const agentSteps: Array<AgentStep> = [
  {
    label: 'Loaded pharmacy inventory feed',
    detail: '3 medication lots with inventory, expiration, value, and demand signals.',
    kind: 'info',
  },
  {
    label: 'Pulled temperature telemetry',
    detail: 'Insulin lot includes a 12.4 C cold-chain excursion.',
    kind: 'danger',
  },
  {
    label: 'Checked recall status',
    detail: 'No FDA recall hit for Cefazolin or Oncology Med; insulin requires safety review.',
    kind: 'success',
  },
  {
    label: 'NanoOmni reviewed evidence',
    detail: 'Label and temperature evidence converted into structured lot facts.',
    kind: 'info',
  },
  {
    label: 'Nemotron triage ranked lot risk',
    detail: 'Expiration waste, cold-chain safety, and high-value approval paths detected.',
    kind: 'tool',
  },
  {
    label: 'Nemotron compliance pass completed',
    detail: 'Controlled/high-value medication requires pharmacist authorization.',
    kind: 'warning',
  },
  {
    label: 'NemoClaw policy allowed Cefazolin transfer',
    detail: 'Safe, low-risk inventory action can prevent near-term waste.',
    kind: 'success',
  },
  {
    label: 'OpenClaw tool queued transfer_inventory',
    detail: '24 Cefazolin units routed to North Oncology Satellite.',
    kind: 'tool',
  },
  {
    label: 'NemoClaw blocked insulin transfer',
    detail: 'Temperature excursion blocks autonomous dispensing or transfer.',
    kind: 'danger',
  },
  {
    label: 'OpenClaw tool queued quarantine_lot',
    detail: 'Insulin lot isolated pending cold-chain review.',
    kind: 'tool',
  },
  {
    label: 'OpenClaw tool queued notify_pharmacist',
    detail: 'Pharmacist receives cold-chain incident summary.',
    kind: 'tool',
  },
  {
    label: 'NemoClaw escalated Oncology Med',
    detail: 'High-value medication requires human approval before action.',
    kind: 'warning',
  },
  {
    label: 'OpenClaw tool queued request_human_approval',
    detail: 'Approval requested for transfer or reorder intervention.',
    kind: 'tool',
  },
  {
    label: 'Memory layer detected recurring pattern',
    detail: 'Main Hospital overstocked Cefazolin 3x in recent audit history.',
    kind: 'muted',
  },
  {
    label: 'OpenClaw tool staged reorder update',
    detail: 'Recommended reducing Cefazolin reorder point by 15%.',
    kind: 'tool',
  },
  {
    label: 'Audit package finalized',
    detail: 'Observations, recommendations, policy decisions, and tools stored.',
    kind: 'success',
  },
]

const auditRows: Array<AuditRow> = [
  {
    medication: 'Cefazolin 1g vial',
    reasoning: 'Near expiry and local demand cannot consume current stock.',
    recommendation: 'Transfer 24 units to higher-demand satellite.',
    policy: 'Allowed: safe, low-risk waste prevention.',
    tools: 'transfer_inventory, update_reorder_rules',
    finalStatus: 'Transferred + reorder recommendation staged',
    variant: 'success',
  },
  {
    medication: 'Insulin glargine pen',
    reasoning: 'Temperature logger screenshot showed cold-chain excursion.',
    recommendation: 'Quarantine and notify pharmacist.',
    policy: 'Blocked: safety/compliance concern.',
    tools: 'quarantine_lot, notify_pharmacist',
    finalStatus: 'Quarantined pending cold-chain review',
    variant: 'danger',
  },
  {
    medication: 'Oncology Med 20mg',
    reasoning: 'High-value medication with controlled approval workflow.',
    recommendation: 'Request human approval before transfer.',
    policy: 'Escalated: approval required.',
    tools: 'request_human_approval',
    finalStatus: 'Pending pharmacist authorization',
    variant: 'warning',
  },
]

function MedFlowDashboard() {
  const lotsQuery = useQuery({
    queryKey: ['medflow-lots'],
    queryFn: async () => medicationLots,
    initialData: medicationLots,
  })
  const transferInventoryFn = useServerFn(transferInventory)
  const quarantineLotFn = useServerFn(quarantineLot)
  const notifyPharmacistFn = useServerFn(notifyPharmacist)
  const requestHumanApprovalFn = useServerFn(requestHumanApproval)
  const updateReorderRecommendationFn = useServerFn(updateReorderRecommendation)
  const [running, setRunning] = useState(false)
  const [visibleSteps, setVisibleSteps] = useState(0)
  const [done, setDone] = useState(false)
  const [toolResults, setToolResults] = useState<Array<ToolResult>>([])
  const toolCallsStarted = useRef(false)

  useEffect(() => {
    if (!running || visibleSteps >= agentSteps.length) {
      if (running && visibleSteps >= agentSteps.length) {
        setDone(true)
        setRunning(false)
      }
      return
    }

    const timer = window.setTimeout(() => {
      setVisibleSteps((current) => current + 1)
    }, 520)

    return () => window.clearTimeout(timer)
  }, [running, visibleSteps])

  useEffect(() => {
    if (!done || toolCallsStarted.current) {
      return
    }

    toolCallsStarted.current = true
    Promise.all([
      transferInventoryFn({
        data: {
          medication: 'Cefazolin 1g vial',
          units: 24,
          destination: 'North Oncology Satellite',
        },
      }),
      quarantineLotFn({ data: { medication: 'Insulin glargine pen' } }),
      notifyPharmacistFn({
        data: {
          message:
            'Insulin glargine pen lot quarantined after 12.4 C temperature excursion.',
        },
      }),
      requestHumanApprovalFn({
        data: {
          action: 'Approve Oncology Med transfer or reorder intervention.',
        },
      }),
      updateReorderRecommendationFn({
        data: {
          medication: 'Cefazolin 1g vial',
          percentage: -15,
        },
      }),
    ]).then((results) => setToolResults(results as Array<ToolResult>))
  }, [
    done,
    notifyPharmacistFn,
    quarantineLotFn,
    requestHumanApprovalFn,
    transferInventoryFn,
    updateReorderRecommendationFn,
  ])

  function runAgent() {
    toolCallsStarted.current = false
    setToolResults([])
    setDone(false)
    setVisibleSteps(0)
    setRunning(true)
  }

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col justify-between gap-5 rounded-3xl border bg-card/80 p-6 shadow-sm backdrop-blur md:flex-row md:items-center">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-brand/10 px-3 py-1 text-sm font-medium text-brand">
              <Sparkles className="size-4" />
              NVIDIA Nemotron + NanoOmni + OpenClaw
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-foreground md:text-5xl">
              MedFlow
            </h1>
            <p className="mt-3 max-w-3xl text-lg text-muted-foreground">
              Autonomous expiration and recall prevention agent for hospital
              pharmacies.
            </p>
          </div>
          <Button size="lg" onClick={runAgent} disabled={running}>
            {running ? <Clock3 className="animate-spin" /> : <Play />}
            {running ? 'Agent Running...' : 'Run MedFlow Agent'}
          </Button>
        </header>

        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <PackageCheck className="size-5 text-brand" />
                Medication Lots
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Medication</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead>Demand / Signal</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lotsQuery.data.map((lot) => (
                    <TableRow key={lot.medication}>
                      <TableCell className="font-medium">{lot.medication}</TableCell>
                      <TableCell>{lot.location}</TableCell>
                      <TableCell>{lot.expiresInDays} days</TableCell>
                      <TableCell className="max-w-[16rem] whitespace-normal text-muted-foreground">
                        {lot.demand}
                      </TableCell>
                      <TableCell>{lot.value}</TableCell>
                      <TableCell>
                        <RiskBadge variant={lot.riskVariant}>{lot.risk}</RiskBadge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <AgentLogCard
            running={running}
            done={done}
            visibleSteps={visibleSteps}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <AuditCard toolResults={toolResults} done={done} />
          <MemoryCard done={done} />
        </section>
      </div>
    </main>
  )
}

function AgentLogCard({
  running,
  done,
  visibleSteps,
}: {
  running: boolean
  done: boolean
  visibleSteps: number
}) {
  const visible = agentSteps.slice(0, visibleSteps)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <BrainCircuit className="size-5 text-brand" />
          Agent Log
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {!running && !done && visible.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Click the run button to watch MedFlow reason, apply policy, and
              execute tools.
            </div>
          ) : null}
          {visible.map((step, index) => (
            <AgentStepRow key={`${step.label}-${index}`} step={step} index={index} />
          ))}
          {done ? (
            <div className="flex items-center gap-3 rounded-lg border bg-success/10 p-3 text-sm font-medium text-success">
              <CheckCircle2 className="size-5" />
              Agent run complete. Tool call results are available in the audit log.
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function AgentStepRow({ step, index }: { step: AgentStep; index: number }) {
  const Icon = stepIcon(step.kind)

  return (
    <div
      className={cn(
        'animate-in fade-in slide-in-from-bottom-2 flex gap-3 rounded-lg border p-3',
        stepTone(step.kind),
      )}
    >
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-background/70">
        <Icon className="size-4" />
      </div>
      <div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">
            {String(index + 1).padStart(2, '0')}
          </span>
          <p className="font-medium">{step.label}</p>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{step.detail}</p>
      </div>
    </div>
  )
}

function AuditCard({
  toolResults,
  done,
}: {
  toolResults: Array<ToolResult>
  done: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <ClipboardCheck className="size-5 text-brand" />
          Audit Log
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          {auditRows.map((row) => (
            <AuditRow key={row.medication} row={row} />
          ))}
        </div>

        <div className="rounded-xl border bg-muted/30 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Tool Call Results</h3>
            <Badge variant={done ? 'success' : 'muted'}>
              {done ? `${toolResults.length}/5 complete` : 'waiting'}
            </Badge>
          </div>
          {toolResults.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Server function results appear here after the agent completes.
            </p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {toolResults.map((result) => (
                <div
                  key={`${result.tool}-${result.timestamp}`}
                  className="rounded-lg border bg-card p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <code className="text-xs font-semibold">{result.tool}</code>
                    <StatusBadge status={result.status} />
                  </div>
                  <pre className="overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function AuditRow({ row }: { row: AuditRow }) {
  return (
    <div className="grid gap-3 rounded-xl border p-4 md:grid-cols-[13rem_1fr]">
      <div>
        <p className="font-semibold">{row.medication}</p>
        <RiskBadge variant={row.variant}>{row.finalStatus}</RiskBadge>
      </div>
      <div className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
        <AuditField label="Reasoning" value={row.reasoning} />
        <AuditField label="Recommendation" value={row.recommendation} />
        <AuditField label="Policy" value={row.policy} />
        <AuditField label="Tool calls" value={row.tools} />
      </div>
    </div>
  )
}

function AuditField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
        {label}
      </p>
      <p>{value}</p>
    </div>
  )
}

function MemoryCard({ done }: { done: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Database className="size-5 text-brand" />
          Memory
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border bg-warning/10 p-4">
          <div className="flex items-center gap-2 font-semibold text-warning-foreground">
            <AlertTriangle className="size-5" />
            Pattern detected
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Main Hospital overstocked Cefazolin 3x across recent audit runs.
          </p>
        </div>
        <div className="rounded-xl border bg-brand/10 p-4">
          <div className="flex items-center gap-2 font-semibold text-brand">
            <FileSearch className="size-5" />
            Recommendation
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Reduce Cefazolin reorder point by 15% and route surplus to
            high-demand satellite pharmacies.
          </p>
        </div>
        <div className="rounded-xl border bg-success/10 p-4">
          <div className="flex items-center gap-2 font-semibold text-success">
            <CheckCircle2 className="size-5" />
            Estimated savings
          </div>
          <p className="mt-2 text-3xl font-bold">$3,200/month</p>
          <p className="text-sm text-muted-foreground">
            {done
              ? 'Projected after transfer and reorder update.'
              : 'Projection will lock after the agent run completes.'}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function RiskBadge({
  variant,
  children,
}: {
  variant: RiskVariant
  children: ReactNode
}) {
  if (variant === 'success') {
    return <Badge variant="success">{children}</Badge>
  }
  if (variant === 'warning') {
    return <Badge variant="warning">{children}</Badge>
  }
  if (variant === 'danger') {
    return <Badge variant="danger">{children}</Badge>
  }
  return <Badge>{children}</Badge>
}

function StatusBadge({ status }: { status: ToolResult['status'] }) {
  const variant =
    status === 'success' || status === 'updated'
      ? 'success'
      : status === 'pending_approval'
        ? 'warning'
        : status === 'quarantined'
          ? 'danger'
          : 'default'

  return <Badge variant={variant}>{status}</Badge>
}

function stepTone(kind: StepKind) {
  return {
    info: 'bg-card text-foreground',
    success: 'border-success/30 bg-success/10 text-success',
    danger: 'border-danger/30 bg-danger/10 text-danger',
    warning: 'border-warning/40 bg-warning/10 text-warning-foreground',
    tool: 'border-brand/30 bg-brand/10 text-brand',
    muted: 'bg-muted/60 text-muted-foreground',
  }[kind]
}

function stepIcon(kind: StepKind) {
  return {
    info: Clock3,
    success: CheckCircle2,
    danger: ShieldAlert,
    warning: AlertTriangle,
    tool: Truck,
    muted: Database,
  }[kind]
}
