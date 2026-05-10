export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AgentInput {
  contactPhone: string
  incomingMessage: string
  history: ChatMessage[]
  tenantPrompt: string
  productName?: string
  productPrice?: number
  onLowCredits?: () => void   // callback cuando la API devuelve 402/sin saldo
}

export type AgentIntent = 'purchase' | 'voucher' | 'handoff' | 'general'

export interface AgentResponse {
  reply: string
  intent: AgentIntent
  confidence: number          // 0-1, umbral para handoff humano
}

export interface VoucherValidationResult {
  valid: boolean
  isVoucher: boolean          // true si la imagen parece un comprobante de pago
  amount: number | null
  reference: string | null
  bank: string | null
  date: string | null
  message: string
}

export interface TenantConfig {
  tenantId: string
  systemPrompt: string
  productName: string
  productPrice: number
  handoffThreshold: number    // confidence por debajo de este valor → handoff
}
