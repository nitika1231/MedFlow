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
import { useEffect, useState } from 'react'

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
  type BackendAgentRun,
  getBackendHealth,
  runBackendAgent,
  type ToolResult,
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

type DashboardToolResult = Omit<ToolResult, 'status'> & {
  status: ToolResult['status'] | 'executed' | 'skipped' | 'failed' | string
  raw?: unknown
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
  const getBackendHealthFn = useServerFn(getBackendHealth)
  const runBackendAgentFn = useServerFn(runBackendAgent)
  const lotsQuery = useQuery({
    queryKey: ['medflow-lots'],
    queryFn: async () => medicationLots,
    initialData: medicationLots,
  })
  const backendHealthQuery = useQuery({
    queryKey: ['backend-health'],
    queryFn: () => getBackendHealthFn(),
    retry: false,
    refetchInterval: 15_000,
  })
  const [running, setRunning] = useState(false)
  const [visibleSteps, setVisibleSteps] = useState(0)
  const [done, setDone] = useState(false)
  const [toolResults, setToolResults] = useState<Array<DashboardToolResult>>([])
  const [backendRun, setBackendRun] = useState<BackendAgentRun | null>(null)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [backendPending, setBackendPending] = useState(false)
  const displayedLots = backendRun
    ? backendRun.evaluations.map(evaluationToMedicationLot)
    : lotsQuery.data
  const displayedAuditRows = backendRun
    ? backendRun.evaluations.map(evaluationToAuditRow)
    : auditRows

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

  function runAgent() {
    setToolResults([])
    setBackendRun(null)
    setBackendError(null)
    setBackendPending(true)
    setDone(false)
    setVisibleSteps(0)
    setRunning(true)
    runBackendAgentFn({
      data: {
        source: 'frontend-dashboard',
        use_live_source: true,
      },
    })
      .then((run) => {
        setBackendRun(run)
        setToolResults(flattenBackendToolResults(run))
      })
      .catch((error: unknown) => {
        setBackendError(
          error instanceof Error
            ? error.message
            : 'Could not reach the MedFlow backend.',
        )
      })
      .finally(() => {
        setBackendPending(false)
      })
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
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <BackendStatusBadge
                connected={backendHealthQuery.isSuccess}
                loading={backendHealthQuery.isLoading}
              />
              {backendHealthQuery.data ? (
                <span className="text-muted-foreground">
                  FastAPI backend live · Nemotron{' '}
                  {backendHealthQuery.data.nemotron_enabled ? 'enabled' : 'mocked'}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Start the backend on port 8000 before running the real agent.
                </span>
              )}
            </div>
          </div>
          <Button size="lg" onClick={runAgent} disabled={running || backendPending}>
            {running ? <Clock3 className="animate-spin" /> : <Play />}
            {running || backendPending ? 'Agent Running...' : 'Run MedFlow Agent'}
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
                  {displayedLots.map((lot) => (
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
            backendPending={backendPending}
            backendError={backendError}
            backendRun={backendRun}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <AuditCard
            rows={displayedAuditRows}
            toolResults={toolResults}
            done={done}
            backendPending={backendPending}
            backendError={backendError}
            backendRun={backendRun}
          />
          <MemoryCard done={done} backendRun={backendRun} />
        </section>
      </div>
    </main>
  )
}

function AgentLogCard({
  running,
  done,
  visibleSteps,
  backendPending,
  backendError,
  backendRun,
}: {
  running: boolean
  done: boolean
  visibleSteps: number
  backendPending: boolean
  backendError: string | null
  backendRun: BackendAgentRun | null
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
          {backendPending ? (
            <div className="flex items-center gap-3 rounded-lg border bg-brand/10 p-3 text-sm font-medium text-brand">
              <Clock3 className="size-5 animate-spin" />
              Calling FastAPI backend /agent/run...
            </div>
          ) : null}
          {backendRun ? (
            <div className="rounded-lg border bg-success/10 p-3 text-sm text-success">
              <p className="font-semibold">Backend run received</p>
              <p className="mt-1 font-mono text-xs">{backendRun.run_id}</p>
            </div>
          ) : null}
          {backendError ? (
            <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              <p className="font-semibold">Backend call failed</p>
              <p className="mt-1 text-xs">{backendError}</p>
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
  rows,
  toolResults,
  done,
  backendPending,
  backendError,
  backendRun,
}: {
  rows: Array<AuditRow>
  toolResults: Array<DashboardToolResult>
  done: boolean
  backendPending: boolean
  backendError: string | null
  backendRun: BackendAgentRun | null
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
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 p-3 text-sm">
          <Badge variant={backendRun ? 'success' : backendError ? 'danger' : 'muted'}>
            {backendRun
              ? 'connected to FastAPI'
              : backendPending
                ? 'calling backend'
                : backendError
                  ? 'backend error'
                  : 'demo data'}
          </Badge>
          <span className="text-muted-foreground">
            {backendRun
              ? `Run ${backendRun.run_id} returned ${backendRun.evaluations.length} evaluations.`
              : 'Audit rows will switch from demo data to backend output after a successful run.'}
          </span>
        </div>
        <div className="space-y-3">
          {rows.map((row) => (
            <AuditRow key={row.medication} row={row} />
          ))}
        </div>

        <div className="rounded-xl border bg-muted/30 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Tool Call Results</h3>
            <Badge variant={done ? 'success' : 'muted'}>
              {backendRun
                ? `${toolResults.length} backend calls`
                : done
                  ? `${toolResults.length}/5 complete`
                  : 'waiting'}
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

function MemoryCard({
  done,
  backendRun,
}: {
  done: boolean
  backendRun: BackendAgentRun | null
}) {
  const pattern = backendRun?.recurring_waste_patterns[0]
  const patternText = pattern
    ? `${String(pattern.medication_name ?? 'Medication')} at ${String(
        pattern.location_id ?? 'unknown location',
      )} triggered ${String(pattern.latest_signal ?? 'a recurring waste signal')}.`
    : 'Main Hospital overstocked Cefazolin 3x across recent audit runs.'

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
            {patternText}
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
            {backendRun
              ? `Based on backend run ${backendRun.run_id}.`
              : done
                ? 'Projected after transfer and reorder update.'
                : 'Projection will lock after the agent run completes.'}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function BackendStatusBadge({
  connected,
  loading,
}: {
  connected: boolean
  loading: boolean
}) {
  if (loading) {
    return <Badge variant="muted">checking backend</Badge>
  }

  return connected ? (
    <Badge variant="success">backend connected</Badge>
  ) : (
    <Badge variant="danger">backend offline</Badge>
  )
}

function evaluationToMedicationLot(evaluation: BackendAgentRun['evaluations'][number]) {
  const { lot, recommendation, policy } = evaluation
  return {
    medication: lot.medication_name,
    location: lot.location_name || lot.location_id,
    expiresInDays: daysUntil(lot.expiration_date),
    demand: `${lot.demand_30d} units/30d · ${humanize(recommendation.recommended_action)}`,
    value: formatMoney(lot.quantity * lot.unit_value_usd),
    risk: `${humanize(recommendation.risk_level)} · ${humanize(policy.status)}`,
    riskVariant: riskVariantForPolicy(policy.status, recommendation.risk_level),
  } satisfies MedicationLot
}

function evaluationToAuditRow(evaluation: BackendAgentRun['evaluations'][number]) {
  const { lot, recommendation, policy, tool_calls } = evaluation
  return {
    medication: lot.medication_name,
    reasoning: recommendation.rationale,
    recommendation: humanize(recommendation.recommended_action),
    policy: `${humanize(policy.status)}: ${policy.reason}`,
    tools: tool_calls.map((tool) => tool.tool_name).join(', ') || 'No tool call',
    finalStatus:
      tool_calls.map((tool) => `${humanize(tool.tool_name)} ${tool.status}`).join('; ') ||
      humanize(policy.status),
    variant: riskVariantForPolicy(policy.status, recommendation.risk_level),
  } satisfies AuditRow
}

function flattenBackendToolResults(run: BackendAgentRun): Array<DashboardToolResult> {
  return run.evaluations.flatMap((evaluation) =>
    evaluation.tool_calls.map((call) => ({
      tool: call.tool_name,
      input: call.payload,
      status: backendToolStatus(call.status, call.tool_name),
      timestamp: run.created_at,
      result: call.error ?? toolCallResultText(call.result),
      raw: {
        lot_id: evaluation.lot.lot_id,
        medication_name: evaluation.lot.medication_name,
        ...call,
      },
    })),
  )
}

function backendToolStatus(status: string, toolName: string) {
  if (status === 'failed') {
    return 'failed'
  }
  if (status === 'skipped') {
    return 'skipped'
  }
  if (toolName === 'quarantine_lot') {
    return 'quarantined'
  }
  if (toolName === 'notify_pharmacist') {
    return 'notified'
  }
  if (toolName === 'request_human_approval') {
    return 'pending_approval'
  }
  if (toolName === 'update_reorder_rules') {
    return 'updated'
  }
  return status === 'executed' ? 'success' : status
}

function toolCallResultText(result: Record<string, unknown>) {
  const status = result.status ? String(result.status) : 'completed'
  const id = Object.entries(result).find(([key]) => key.endsWith('_id'))?.[1]
  return id ? `${status} (${String(id)})` : status
}

function riskVariantForPolicy(policyStatus: string, riskLevel: string): RiskVariant {
  if (policyStatus === 'block' || riskLevel === 'critical') {
    return 'danger'
  }
  if (policyStatus === 'escalate' || riskLevel === 'high') {
    return 'warning'
  }
  if (policyStatus === 'allow' || riskLevel === 'low') {
    return 'success'
  }
  return 'default'
}

function daysUntil(value: string) {
  const expiration = new Date(`${value}T00:00:00`)
  const now = new Date()
  return Math.ceil(
    (expiration.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  )
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function humanize(value: string) {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
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

function StatusBadge({ status }: { status: DashboardToolResult['status'] }) {
  const variant =
    status === 'success' || status === 'updated' || status === 'executed'
      ? 'success'
      : status === 'pending_approval'
        ? 'warning'
        : status === 'quarantined' || status === 'failed'
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
