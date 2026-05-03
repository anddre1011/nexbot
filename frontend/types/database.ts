export type Plan = 'free' | 'starter' | 'pro' | 'enterprise'
export type ContactStatus = 'active' | 'blocked' | 'unsubscribed'
export type ConversationStatus = 'open' | 'closed' | 'bot' | 'human'
export type MessageDirection = 'inbound' | 'outbound'
export type MessageType = 'text' | 'image' | 'audio' | 'document' | 'template'
export type SaleStatus = 'pending' | 'confirmed' | 'rejected'

export interface Tenant {
  id: string
  user_id: string
  name: string
  whatsapp_number: string
  openai_key: string | null
  plan: Plan
  active: boolean
  created_at: string
}

export interface Contact {
  id: string
  tenant_id: string
  phone: string
  name: string | null
  status: ContactStatus
  last_message_at: string | null
  created_at: string
}

export interface Conversation {
  id: string
  tenant_id: string
  contact_id: string
  status: ConversationStatus
  campaign_id: string | null
  created_at: string
}

export interface Message {
  id: string
  conversation_id: string
  direction: MessageDirection
  type: MessageType
  content: string | null
  created_at: string
}

export interface Sale {
  id: string
  tenant_id: string
  contact_id: string
  product: string
  amount: number
  status: SaleStatus
  campaign_id: string | null
  created_at: string
}

export interface Campaign {
  id: string
  tenant_id: string
  name: string
  meta_ad_id: string | null
  created_at: string
}
