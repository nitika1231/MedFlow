export const API_BASE_URL = 'http://localhost:8000'
export const MODEL_NAME = 'nvidia/llama-3_3-nemotron-super-49b-v1_5'

export type DemandLevel = 'Low' | 'Medium' | 'High'

export type LotStatus =
  | 'NORMAL'
  | 'AT RISK'
  | 'FLAGGED'
  | 'QUARANTINED'
  | 'PENDING APPROVAL'

export type InventoryLot = {
  id: string
  medicationName: string
  lotNumber: string
  location: 'Main Hospital' | 'Satellite Clinic' | 'Cancer Center' | string
  unitsRemaining: number
  expirationDate: string
  demandLevel: DemandLevel
  status: LotStatus
  unitValueUsd: number
}

export type NemoClawResult = 'PASS' | 'BLOCK' | 'APPROVAL REQUIRED'

export type AuditLogEntry = {
  id: string
  timestamp: string
  medicationName: string
  lotId: string
  proposedAction: string
  nemoClawResult: NemoClawResult
  blockReason: string | null
  toolCalled: string
  humanApprovalRequired: boolean
  modelUsed: string
}

export type MemoryPattern = {
  id: string
  medicationName: string
  location: string
  description: string
  observedRuns: number
  reorderAdjustment: string
  estimatedMonthlySavings: number
}

export type MemoryTimelineEntry = {
  id: string
  timestamp: string
  medicationName: string
  actionTaken: string
  unitsSaved: number
}

export type MemoryPatternsResponse = {
  patterns: Array<MemoryPattern>
  timeline: Array<MemoryTimelineEntry>
  isDemoFallback: boolean
}

export type SavingsHistoryPoint = {
  run: string
  dollarsSaved: number
}

export type RoiSummary = {
  totalUnitsPreventedThisRun: number
  totalUnitsPreventedAllTime: number
  dollarValueSavedThisRun: number
  dollarValueSavedAllTime: number
  savingsHistory: Array<SavingsHistoryPoint>
}

export type TraceTag = 'OBSERVE' | 'REASON' | 'POLICY_CHECK' | 'ACTION'

export type ReasoningMessage = {
  type: 'reasoning'
  content: string
  tag: TraceTag
  lot_id: string
}

export type ReasoningLot = {
  id: string
  medicationName: string
  lotNumber: string
}

const DAY_MS = 24 * 60 * 60 * 1000

export function dateDaysFromNow(days: number) {
  const date = new Date(Date.now() + days * DAY_MS)
  date.setHours(12, 0, 0, 0)
  return date.toISOString()
}

export function daysUntil(dateValue: string) {
  const expiration = new Date(dateValue)
  return Math.ceil((expiration.getTime() - Date.now()) / DAY_MS)
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

export const mockInventory: Array<InventoryLot> = [
  {
    id: 'CEF-4421',
    medicationName: 'Cefazolin',
    lotNumber: 'CEF-4421',
    location: 'Main Hospital',
    unitsRemaining: 40,
    expirationDate: dateDaysFromNow(8),
    demandLevel: 'High',
    status: 'AT RISK',
    unitValueUsd: 80,
  },
  {
    id: 'INS-8832',
    medicationName: 'Insulin (Humalog)',
    lotNumber: 'INS-8832',
    location: 'Main Hospital',
    unitsRemaining: 60,
    expirationDate: dateDaysFromNow(10),
    demandLevel: 'Medium',
    status: 'QUARANTINED',
    unitValueUsd: 70,
  },
  {
    id: 'VIN-2291',
    medicationName: 'Vincristine',
    lotNumber: 'VIN-2291',
    location: 'Cancer Center',
    unitsRemaining: 15,
    expirationDate: dateDaysFromNow(12),
    demandLevel: 'Low',
    status: 'PENDING APPROVAL',
    unitValueUsd: 520,
  },
  {
    id: 'AMX-5512',
    medicationName: 'Amoxicillin',
    lotNumber: 'AMX-5512',
    location: 'Satellite Clinic',
    unitsRemaining: 120,
    expirationDate: dateDaysFromNow(30),
    demandLevel: 'High',
    status: 'NORMAL',
    unitValueUsd: 12,
  },
  {
    id: 'MET-3301',
    medicationName: 'Metformin',
    lotNumber: 'MET-3301',
    location: 'Main Hospital',
    unitsRemaining: 200,
    expirationDate: dateDaysFromNow(45),
    demandLevel: 'Medium',
    status: 'NORMAL',
    unitValueUsd: 8,
  },
  {
    id: 'LIS-7743',
    medicationName: 'Lisinopril',
    lotNumber: 'LIS-7743',
    location: 'Satellite Clinic',
    unitsRemaining: 80,
    expirationDate: dateDaysFromNow(20),
    demandLevel: 'Low',
    status: 'NORMAL',
    unitValueUsd: 10,
  },
]

export const reasoningLots: Array<ReasoningLot> = mockInventory
  .slice(0, 3)
  .map((lot) => ({
    id: lot.id,
    medicationName: lot.medicationName,
    lotNumber: lot.lotNumber,
  }))

export const mockAuditLog: Array<AuditLogEntry> = [
  {
    id: 'audit-cef-4421',
    timestamp: dateDaysFromNow(0),
    medicationName: 'Cefazolin',
    lotId: 'CEF-4421',
    proposedAction: 'Transfer 24 units to Satellite Clinic',
    nemoClawResult: 'PASS',
    blockReason: null,
    toolCalled: 'transfer_inventory',
    humanApprovalRequired: false,
    modelUsed: MODEL_NAME,
  },
  {
    id: 'audit-ins-8832',
    timestamp: dateDaysFromNow(0),
    medicationName: 'Insulin (Humalog)',
    lotId: 'INS-8832',
    proposedAction: 'Quarantine lot pending cold-chain review',
    nemoClawResult: 'BLOCK',
    blockReason: 'Temperature excursion detected',
    toolCalled: 'quarantine_lot',
    humanApprovalRequired: false,
    modelUsed: MODEL_NAME,
  },
  {
    id: 'audit-vin-2291',
    timestamp: dateDaysFromNow(0),
    medicationName: 'Vincristine',
    lotId: 'VIN-2291',
    proposedAction: 'Create pharmacist approval request',
    nemoClawResult: 'APPROVAL REQUIRED',
    blockReason: 'Lot value exceeds autonomous action threshold',
    toolCalled: 'request_human_approval',
    humanApprovalRequired: true,
    modelUsed: MODEL_NAME,
  },
]

export const mockMemoryPattern: MemoryPattern = {
  id: 'pattern-cefazolin-main',
  medicationName: 'Cefazolin',
  location: 'Main Hospital',
  description:
    'Nemotron detected recurring Cefazolin overstock at Main Hospital with surplus expiring before local demand can consume it.',
  observedRuns: 4,
  reorderAdjustment: 'Reduce reorder point by 15% and bias surplus to Satellite Clinic',
  estimatedMonthlySavings: 3200,
}

export const mockMemoryTimeline: Array<MemoryTimelineEntry> = [
  {
    id: 'timeline-cef-1',
    timestamp: dateDaysFromNow(-6),
    medicationName: 'Cefazolin',
    actionTaken: 'Transferred 18 units before expiration',
    unitsSaved: 18,
  },
  {
    id: 'timeline-cef-2',
    timestamp: dateDaysFromNow(-3),
    medicationName: 'Insulin (Humalog)',
    actionTaken: 'Quarantined cold-chain excursion lot',
    unitsSaved: 60,
  },
  {
    id: 'timeline-cef-3',
    timestamp: dateDaysFromNow(0),
    medicationName: 'Vincristine',
    actionTaken: 'Created approval workflow for high-value lot',
    unitsSaved: 15,
  },
]

export const mockRoiSummary: RoiSummary = {
  totalUnitsPreventedThisRun: 99,
  totalUnitsPreventedAllTime: 842,
  dollarValueSavedThisRun: 15200,
  dollarValueSavedAllTime: 126400,
  savingsHistory: [
    { run: 'Run 01', dollarsSaved: 9400 },
    { run: 'Run 02', dollarsSaved: 11800 },
    { run: 'Run 03', dollarsSaved: 15200 },
  ],
}

export const mockReasoningMessages: Array<ReasoningMessage> = [
  {
    type: 'reasoning',
    lot_id: 'CEF-4421',
    tag: 'OBSERVE',
    content:
      'Cefazolin CEF-4421: 40 units at Main Hospital expire in 8 days. Satellite demand exceeds local supply.',
  },
  {
    type: 'reasoning',
    lot_id: 'CEF-4421',
    tag: 'REASON',
    content:
      'Waste risk is material and clinical demand is higher at Satellite Clinic. Transfer preserves inventory utility.',
  },
  {
    type: 'reasoning',
    lot_id: 'CEF-4421',
    tag: 'POLICY_CHECK',
    content:
      'PASS: non-controlled medication, safe handling window, destination demand verified.',
  },
  {
    type: 'reasoning',
    lot_id: 'CEF-4421',
    tag: 'ACTION',
    content: 'transfer_inventory approved for 24 units: Main Hospital -> Satellite Clinic.',
  },
  {
    type: 'reasoning',
    lot_id: 'INS-8832',
    tag: 'OBSERVE',
    content:
      'Insulin INS-8832: 60 units expire in 10 days. Temperature telemetry shows cold-chain excursion.',
  },
  {
    type: 'reasoning',
    lot_id: 'INS-8832',
    tag: 'REASON',
    content:
      'Expiration waste is secondary to patient safety. Lot should not move through dispensing channels.',
  },
  {
    type: 'reasoning',
    lot_id: 'INS-8832',
    tag: 'POLICY_CHECK',
    content:
      'BLOCK: temperature excursion requires quarantine and pharmacist review before any transfer.',
  },
  {
    type: 'reasoning',
    lot_id: 'INS-8832',
    tag: 'ACTION',
    content: 'quarantine_lot executed and cold-chain incident notification queued.',
  },
  {
    type: 'reasoning',
    lot_id: 'VIN-2291',
    tag: 'OBSERVE',
    content:
      'Vincristine VIN-2291: 15 units at Cancer Center expire in 12 days. Lot value exceeds $5,000.',
  },
  {
    type: 'reasoning',
    lot_id: 'VIN-2291',
    tag: 'REASON',
    content:
      'Medication is high-value oncology inventory. Autonomous movement requires pharmacist authorization.',
  },
  {
    type: 'reasoning',
    lot_id: 'VIN-2291',
    tag: 'POLICY_CHECK',
    content:
      'APPROVAL REQUIRED: value threshold exceeded; human approval gate must be created.',
  },
  {
    type: 'reasoning',
    lot_id: 'VIN-2291',
    tag: 'ACTION',
    content: 'request_human_approval created for oncology pharmacist review.',
  },
]

export async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }

  return response.json()
}

export async function postJson(path: string, body?: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }

  return response.json().catch(() => null)
}

export async function getInventory(): Promise<Array<InventoryLot>> {
  try {
    const data = await fetchJson('/api/inventory')
    const normalized = normalizeInventory(data)
    return normalized.length > 0 ? normalized : mockInventory
  } catch {
    return mockInventory
  }
}

export async function getAuditLog(): Promise<Array<AuditLogEntry>> {
  try {
    const data = await fetchJson('/api/audit-log')
    const normalized = normalizeAuditLog(data)
    return normalized.length > 0 ? normalized : mockAuditLog
  } catch {
    return mockAuditLog
  }
}

export async function getMemoryPatterns(): Promise<MemoryPatternsResponse> {
  try {
    const data = await fetchJson('/api/memory/patterns')
    const patterns = normalizePatterns(data)
    const timeline = normalizeTimeline(data)
    return {
      patterns,
      timeline,
      isDemoFallback: patterns.length === 0,
    }
  } catch {
    return {
      patterns: [mockMemoryPattern],
      timeline: mockMemoryTimeline,
      isDemoFallback: true,
    }
  }
}

export async function getRoiSummary(): Promise<RoiSummary> {
  try {
    const data = await fetchJson('/api/roi-summary')
    return normalizeRoiSummary(data) ?? mockRoiSummary
  } catch {
    return mockRoiSummary
  }
}

function normalizeInventory(data: unknown): Array<InventoryLot> {
  const rows = asArray(readProp(data, 'inventory') ?? readProp(data, 'lots') ?? data)
  return rows.map((row, index) => {
    const lotNumber = stringValue(
      readProp(row, 'lotNumber') ?? readProp(row, 'lot_number') ?? readProp(row, 'lot_id'),
      `LOT-${index + 1}`,
    )
    const medicationName = stringValue(
      readProp(row, 'medicationName') ??
        readProp(row, 'medication_name') ??
        readProp(row, 'medication'),
      'Medication',
    )
    const expirationDate = stringValue(
      readProp(row, 'expirationDate') ?? readProp(row, 'expiration_date'),
      dateDaysFromNow(30),
    )

    return {
      id: lotNumber,
      medicationName,
      lotNumber,
      location: stringValue(readProp(row, 'location') ?? readProp(row, 'location_name'), 'Main Hospital'),
      unitsRemaining: numberValue(
        readProp(row, 'unitsRemaining') ?? readProp(row, 'units_remaining') ?? readProp(row, 'quantity'),
        0,
      ),
      expirationDate,
      demandLevel: demandValue(readProp(row, 'demandLevel') ?? readProp(row, 'demand_level')),
      status: statusValue(readProp(row, 'status')),
      unitValueUsd: numberValue(
        readProp(row, 'unitValueUsd') ?? readProp(row, 'unit_value_usd') ?? readProp(row, 'unitValue'),
        0,
      ),
    }
  })
}

function normalizeAuditLog(data: unknown): Array<AuditLogEntry> {
  const rows = asArray(readProp(data, 'entries') ?? readProp(data, 'auditLog') ?? data)
  return rows.map((row, index) => ({
    id: stringValue(readProp(row, 'id'), `audit-${index}`),
    timestamp: stringValue(readProp(row, 'timestamp') ?? readProp(row, 'created_at'), new Date().toISOString()),
    medicationName: stringValue(
      readProp(row, 'medicationName') ?? readProp(row, 'medication_name') ?? readProp(row, 'medication'),
      'Medication',
    ),
    lotId: stringValue(readProp(row, 'lotId') ?? readProp(row, 'lot_id'), `LOT-${index}`),
    proposedAction: stringValue(
      readProp(row, 'proposedAction') ?? readProp(row, 'proposed_action') ?? readProp(row, 'action'),
      'Review lot',
    ),
    nemoClawResult: nemoClawValue(readProp(row, 'nemoClawResult') ?? readProp(row, 'nemoclaw_result')),
    blockReason: nullableString(readProp(row, 'blockReason') ?? readProp(row, 'block_reason')),
    toolCalled: stringValue(readProp(row, 'toolCalled') ?? readProp(row, 'tool_called'), 'no_tool'),
    humanApprovalRequired: booleanValue(
      readProp(row, 'humanApprovalRequired') ?? readProp(row, 'human_approval_required'),
      false,
    ),
    modelUsed: stringValue(readProp(row, 'modelUsed') ?? readProp(row, 'model_used'), MODEL_NAME),
  }))
}

function normalizePatterns(data: unknown): Array<MemoryPattern> {
  const rows = asArray(readProp(data, 'patterns') ?? data)
  return rows.map((row, index) => ({
    id: stringValue(readProp(row, 'id'), `pattern-${index}`),
    medicationName: stringValue(
      readProp(row, 'medicationName') ?? readProp(row, 'medication_name') ?? readProp(row, 'medication'),
      'Medication',
    ),
    location: stringValue(readProp(row, 'location') ?? readProp(row, 'location_id'), 'Main Hospital'),
    description: stringValue(
      readProp(row, 'description') ?? readProp(row, 'pattern_description') ?? readProp(row, 'latest_signal'),
      'Recurring waste pattern detected by Nemotron.',
    ),
    observedRuns: numberValue(readProp(row, 'observedRuns') ?? readProp(row, 'observed_runs'), 1),
    reorderAdjustment: stringValue(
      readProp(row, 'reorderAdjustment') ?? readProp(row, 'reorder_adjustment'),
      'Review reorder point',
    ),
    estimatedMonthlySavings: numberValue(
      readProp(row, 'estimatedMonthlySavings') ?? readProp(row, 'estimated_monthly_savings'),
      0,
    ),
  }))
}

function normalizeTimeline(data: unknown): Array<MemoryTimelineEntry> {
  const rows = asArray(readProp(data, 'timeline') ?? readProp(data, 'events'))
  return rows.map((row, index) => ({
    id: stringValue(readProp(row, 'id'), `timeline-${index}`),
    timestamp: stringValue(readProp(row, 'timestamp') ?? readProp(row, 'created_at'), new Date().toISOString()),
    medicationName: stringValue(
      readProp(row, 'medicationName') ?? readProp(row, 'medication_name') ?? readProp(row, 'medication'),
      'Medication',
    ),
    actionTaken: stringValue(readProp(row, 'actionTaken') ?? readProp(row, 'action_taken'), 'Action recorded'),
    unitsSaved: numberValue(readProp(row, 'unitsSaved') ?? readProp(row, 'units_saved'), 0),
  }))
}

function normalizeRoiSummary(data: unknown): RoiSummary | null {
  if (!isRecord(data)) {
    return null
  }

  const history = asArray(readProp(data, 'savingsHistory') ?? readProp(data, 'savings_history')).map(
    (row, index) => ({
      run: stringValue(readProp(row, 'run') ?? readProp(row, 'date'), `Run ${index + 1}`),
      dollarsSaved: numberValue(readProp(row, 'dollarsSaved') ?? readProp(row, 'dollars_saved'), 0),
    }),
  )

  return {
    totalUnitsPreventedThisRun: numberValue(
      readProp(data, 'totalUnitsPreventedThisRun') ?? readProp(data, 'total_units_prevented_this_run'),
      mockRoiSummary.totalUnitsPreventedThisRun,
    ),
    totalUnitsPreventedAllTime: numberValue(
      readProp(data, 'totalUnitsPreventedAllTime') ?? readProp(data, 'total_units_prevented_all_time'),
      mockRoiSummary.totalUnitsPreventedAllTime,
    ),
    dollarValueSavedThisRun: numberValue(
      readProp(data, 'dollarValueSavedThisRun') ?? readProp(data, 'dollar_value_saved_this_run'),
      mockRoiSummary.dollarValueSavedThisRun,
    ),
    dollarValueSavedAllTime: numberValue(
      readProp(data, 'dollarValueSavedAllTime') ?? readProp(data, 'dollar_value_saved_all_time'),
      mockRoiSummary.dollarValueSavedAllTime,
    ),
    savingsHistory: history.length >= 3 ? history : mockRoiSummary.savingsHistory,
  }
}

function readProp(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function nullableString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function demandValue(value: unknown): DemandLevel {
  if (value === 'High' || value === 'Medium' || value === 'Low') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.toLowerCase()
    if (normalized === 'high') return 'High'
    if (normalized === 'medium') return 'Medium'
    if (normalized === 'low') return 'Low'
  }
  return 'Medium'
}

function statusValue(value: unknown): LotStatus {
  if (
    value === 'NORMAL' ||
    value === 'AT RISK' ||
    value === 'FLAGGED' ||
    value === 'QUARANTINED' ||
    value === 'PENDING APPROVAL'
  ) {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.replaceAll('_', ' ').toUpperCase()
    if (
      normalized === 'NORMAL' ||
      normalized === 'AT RISK' ||
      normalized === 'FLAGGED' ||
      normalized === 'QUARANTINED' ||
      normalized === 'PENDING APPROVAL'
    ) {
      return normalized
    }
  }

  return 'NORMAL'
}

function nemoClawValue(value: unknown): NemoClawResult {
  if (value === 'PASS' || value === 'BLOCK' || value === 'APPROVAL REQUIRED') {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.replaceAll('_', ' ').toUpperCase()
    if (normalized === 'PASS' || normalized === 'ALLOW') return 'PASS'
    if (normalized === 'BLOCK') return 'BLOCK'
    if (normalized === 'APPROVAL REQUIRED' || normalized === 'ESCALATE') {
      return 'APPROVAL REQUIRED'
    }
  }

  return 'PASS'
}
