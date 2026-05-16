import { createServerFn } from '@tanstack/react-start'

type TransferInventoryInput = {
  medication: string
  units: number
  destination: string
}

type QuarantineLotInput = {
  medication: string
}

type NotifyPharmacistInput = {
  message: string
}

type RequestHumanApprovalInput = {
  action: string
}

type UpdateReorderRecommendationInput = {
  medication: string
  percentage: number
}

export type ToolResult<TInput = unknown> = {
  tool: string
  input: TInput
  status:
    | 'success'
    | 'quarantined'
    | 'notified'
    | 'pending_approval'
    | 'updated'
  timestamp: string
  result: string
}

export type BackendHealth = {
  status: string
  nemotron_enabled: boolean
  database_path: string
  model_roles: Record<string, string>
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | Array<JsonValue>
  | { [key: string]: JsonValue }

export type BackendToolCall = {
  tool_name: string
  status: 'executed' | 'skipped' | 'failed' | string
  payload: Record<string, JsonValue>
  result: Record<string, JsonValue>
  error?: string | null
}

export type BackendEvaluation = {
  lot: {
    lot_id: string
    medication_name: string
    ndc: string
    location_id: string
    location_name: string
    quantity: number
    expiration_date: string
    demand_7d: number
    demand_30d: number
    recall_status: string
    unit_value_usd: number
    controlled_substance: boolean
  }
  recommendation: {
    risk_level: 'low' | 'medium' | 'high' | 'critical' | string
    recommended_action: string
    rationale: string
    safety_concern: boolean
    compliance_concern: boolean
    confidence: number
    model: string
  }
  policy: {
    status: 'allow' | 'block' | 'escalate' | string
    reason: string
    allowed_tools: Array<string>
    blocked_tools: Array<string>
    required_tools: Array<string>
  }
  tool_calls: Array<BackendToolCall>
}

export type BackendAgentRun = {
  run_id: string
  created_at: string
  source: string
  model_roles: Record<string, string>
  evaluations: Array<BackendEvaluation>
  recurring_waste_patterns: Array<Record<string, JsonValue>>
}

function toolResult<TInput>(
  tool: string,
  input: TInput,
  status: ToolResult['status'],
  result: string,
): ToolResult<TInput> {
  return {
    tool,
    input,
    status,
    timestamp: new Date().toISOString(),
    result,
  }
}

function backendBaseUrl() {
  return (
    process.env.BACKEND_API_URL ||
    process.env.VITE_BACKEND_API_URL ||
    'http://127.0.0.1:8000'
  ).replace(/\/$/, '')
}

async function fetchBackendJson<TResponse>(
  path: string,
  init?: RequestInit,
): Promise<TResponse> {
  const response = await fetch(`${backendBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Backend ${response.status} ${response.statusText}: ${body || path}`,
    )
  }

  return response.json() as Promise<TResponse>
}

export const getBackendHealth = createServerFn({ method: 'GET' }).handler(
  async () => fetchBackendJson<BackendHealth>('/health'),
)

export const runBackendAgent = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: { source?: string; use_live_source?: boolean } | undefined) =>
      input ?? {},
  )
  .handler(async ({ data }) =>
    fetchBackendJson<BackendAgentRun>('/agent/run', {
      method: 'POST',
      body: JSON.stringify({
        source: data.source ?? 'frontend-dashboard',
        use_live_source: data.use_live_source ?? true,
      }),
    }),
  )

export const transferInventory = createServerFn({ method: 'POST' })
  .inputValidator((input: TransferInventoryInput) => input)
  .handler(async ({ data }) =>
    toolResult(
      'transfer_inventory',
      data,
      'success',
      `Transferred ${data.units} units of ${data.medication} to ${data.destination}`,
    ),
  )

export const quarantineLot = createServerFn({ method: 'POST' })
  .inputValidator((input: QuarantineLotInput) => input)
  .handler(async ({ data }) =>
    toolResult(
      'quarantine_lot',
      data,
      'quarantined',
      `${data.medication} lot has been quarantined pending cold-chain review`,
    ),
  )

export const notifyPharmacist = createServerFn({ method: 'POST' })
  .inputValidator((input: NotifyPharmacistInput) => input)
  .handler(async ({ data }) =>
    toolResult(
      'notify_pharmacist',
      data,
      'notified',
      `Pharmacist notified: ${data.message}`,
    ),
  )

export const requestHumanApproval = createServerFn({ method: 'POST' })
  .inputValidator((input: RequestHumanApprovalInput) => input)
  .handler(async ({ data }) =>
    toolResult(
      'request_human_approval',
      data,
      'pending_approval',
      `Approval requested for action: ${data.action}`,
    ),
  )

export const updateReorderRecommendation = createServerFn({ method: 'POST' })
  .inputValidator((input: UpdateReorderRecommendationInput) => input)
  .handler(async ({ data }) =>
    toolResult(
      'update_reorder_rules',
      data,
      'updated',
      `Reorder recommendation adjusted by ${data.percentage}%`,
    ),
  )
