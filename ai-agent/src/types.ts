export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AgentInput {
  contactPhone: string
  incomingMessage: string
  history: ChatMessage[]
  tenantPrompt: string        // system prompt configurado por el tenant
  productName?: string
  productPrice?: number
}

export type AgentIntent = 'purchase' | 'voucher' | 'handoff' | 'general'

export interface AgentResponse {
  reply: string
  intent: AgentIntent
  confidence: number          // 0-1, umbral para handoff humano
}

export interface VoucherValidationResult {
  valid: boolean
  amount: number | null       // monto extraído del comprobante
  reference: string | null    // número de referencia / transacción
  bank: string | null
  date: string | null
  message: string             // mensaje legible para responder al contacto
}

export interface TenantConfig {
  tenantId: string
  systemPrompt: string
  productName: string
  productPrice: number
  handoffThreshold: number    // confidence por debajo de este valor → handoff
}
