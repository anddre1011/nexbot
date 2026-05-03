import axios from 'axios'

const BASE = 'https://graph.facebook.com/v19.0'

export interface MetaCampaign {
  id:     string
  name:   string
  status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED'
  daily_budget?:    string
  lifetime_budget?: string
}

export interface MetaInsight {
  campaign_id:  string
  campaign_name: string
  impressions:  string
  clicks:       string
  spend:        string
  ctr:          string
  date_start:   string
  date_stop:    string
}

// Normaliza el account_id: acepta "123" o "act_123"
function actId(accountId: string) {
  return accountId.startsWith('act_') ? accountId : `act_${accountId}`
}

export async function fetchCampaigns(token: string, accountId: string): Promise<MetaCampaign[]> {
  const { data } = await axios.get(`${BASE}/${actId(accountId)}/campaigns`, {
    params: {
      fields:       'id,name,status,daily_budget,lifetime_budget',
      access_token: token,
      limit:        100,
    },
  })
  return data.data ?? []
}

export async function fetchInsights(
  token: string,
  accountId: string,
  datePreset: string = 'last_30d'
): Promise<MetaInsight[]> {
  const { data } = await axios.get(`${BASE}/${actId(accountId)}/insights`, {
    params: {
      fields:      'campaign_id,campaign_name,impressions,clicks,spend,ctr',
      date_preset: datePreset,
      level:       'campaign',
      access_token: token,
      limit:        100,
    },
  })
  return data.data ?? []
}

export async function updateCampaignStatus(
  token: string,
  campaignId: string,
  status: 'ACTIVE' | 'PAUSED'
): Promise<boolean> {
  const { data } = await axios.post(`${BASE}/${campaignId}`, null, {
    params: { status, access_token: token },
  })
  return data.success === true
}
