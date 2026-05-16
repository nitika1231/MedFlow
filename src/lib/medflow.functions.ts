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
