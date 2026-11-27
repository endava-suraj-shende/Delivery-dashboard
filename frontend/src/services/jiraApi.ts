import { api } from '@/services/api'
import type { Period } from '@/types'

export interface JiraBoard {
  owner_id?: string | null
  owner_name?: string | null
  board_code?: string | null
  can_edit?: boolean
  id: string
  url: string
  base_url: string
  board_id: number
  project_key: string | null
  label: string
  enabled: boolean
  email_env: string | null
  token_env: string | null
  email: string | null
  excel_board_names: string[]
  people: string[]
  credential_source: 'ui' | 'env' | 'default'
  board_name: string | null
  board_type: string | null
  project_name: string | null
  last_test: string | null
  last_test_ok: boolean | null
  last_error: string | null
  last_sync: string | null
  last_sync_issues: number
  has_custom_credentials: boolean
}

export interface UserMatch {
  employee: string
  account_id: string | null
  display_name: string | null
  email: string | null
  match: 'manual' | 'exact' | 'fuzzy' | 'none' | 'jira'
  score: number
}

export interface JiraStatus {
  is_admin?: boolean
  read_only?: boolean
  configured: boolean
  email: string | null
  boards: JiraBoard[]
  excel_projects: string[]
  uncovered_projects: string[]
  excel_board_names: string[]
  excel_tickets: number
  fetched_issues: number
  last_sync: string | null
  errors: { scope: string; error: string }[]
  auto_sync: boolean
  stale: boolean
  user_map: UserMatch[]
}

export interface ReconFlag {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
}

export interface ReconRow {
  activity_id: string | null
  file_id: string | null
  file_name: string | null
  source_row: number | null
  report_date: string | null
  employee: string | null
  project: string | null
  application: string | null
  excel_board: string | null
  ticket_id: string
  work_details: string | null
  excel_status_raw: string | null
  excel_status: string | null
  excel_dev_deployment: string | null
  excel_prod_required: string | null
  excel_release_status: string | null
  jira_found: boolean
  jira_status: string | null
  jira_status_category: string | null
  jira_assignee: string | null
  jira_assignee_email: string | null
  mapped_jira_user: string | null
  user_match: string | null
  jira_type: string | null
  jira_priority: string | null
  jira_sprint: string | null
  jira_updated: string | null
  jira_resolved: string | null
  jira_fix_versions: string[]
  jira_summary: string | null
  jira_url: string | null
  verdict: 'ok' | 'error' | 'warning' | 'info'
  flags: ReconFlag[]
}

export interface ReconSummary {
  compared: number
  matched: number
  errors: number
  warnings: number
  info: number
  not_found: number
  unmapped_board: number
  unverified: number
  missing_from_excel: number
  by_check: Record<string, number>
  last_sync: string | null
  configured: boolean
  stale: boolean
  errors_detail: { scope: string; error: string }[]
  error?: string
}

export interface Reconciliation {
  period?: Period
  summary: ReconSummary
  items: ReconRow[]
  by_employee: { employee: string; compared: number; ok: number; error: number; warning: number; info: number }[]
  checks: Record<string, { severity: string; description: string }>
}

export interface DiscoveredBoard {
  board_id: number
  name: string
  type: string
  project_key: string | null
  project_name: string | null
  url: string
  configured: boolean
  base_url: string
}

export interface JiraIssueLite {
  status: string | null
  category: string | null
  assignee: string | null
  updated: string | null
  sprint: string | null
  url: string
}

const q = (qs: string, extra?: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams(qs)
  Object.entries(extra ?? {}).forEach(([k, v]) => v !== undefined && p.set(k, String(v)))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const jiraLiveApi = {
  redeemBoardCode: (code: string) => api.post<{ board_id: string; label: string | null }>('/jira/connections/redeem-code', { code }).then((r) => r.data),
  status: () => api.get<JiraStatus>('/jira/connections').then((r) => r.data),
  boards: () => api.get<{ items: JiraBoard[] }>('/jira/connections/boards').then((r) => r.data.items),
  addBoard: (body: { url: string; label?: string; enabled?: boolean; email_env?: string; token_env?: string; email?: string; token?: string; excel_board_names?: string[]; people?: string[]; test?: boolean }) =>
    api.post<JiraBoard>('/jira/connections/boards', body).then((r) => r.data),
  updateBoard: (id: string, body: Partial<Pick<JiraBoard, 'url' | 'label' | 'enabled' | 'email_env' | 'token_env' | 'email' | 'excel_board_names' | 'project_key' | 'people'>> & { token?: string; clear_credentials?: boolean }) =>
    api.put<JiraBoard>(`/jira/connections/boards/${id}`, body).then((r) => r.data),
  deleteBoard: (id: string) => api.delete(`/jira/connections/boards/${id}`).then((r) => r.data),
  testBoard: (id: string) => api.post<{ board: JiraBoard; ok: boolean }>(`/jira/connections/boards/${id}/test`).then((r) => r.data),
  boardAssignees: (id: string) => api.get<{ board_id: string; assignees: string[]; selected: string[]; error?: string }>(`/jira/connections/boards/${id}/assignees`).then((r) => r.data),
  testUrl: (body: { url: string; email_env?: string; token_env?: string; email?: string; token?: string }) =>
    api.post<{ ok: boolean; board: JiraBoard; error?: string; active_sprints?: string[] }>('/jira/connections/test', body).then((r) => r.data),
  credentials: () => api.get<{ email: string | null; configured: boolean; source: 'ui' | 'env' | 'none'; token_masked: string | null }>('/jira/connections/credentials').then((r) => r.data),
  setCredentials: (email: string, token: string) => api.put<{ email: string | null; configured: boolean; source: string; token_masked: string | null }>('/jira/connections/credentials', { email, token }).then((r) => r.data),
  clearCredentials: () => api.delete('/jira/connections/credentials').then((r) => r.data),
  discover: (base_url?: string) => api.get<{ items: DiscoveredBoard[]; projects: string[]; sites: string[]; errors: { site: string; error: string }[] }>(`/jira/connections/discover${q('', { base_url })}`).then((r) => r.data),
  me: (base_url?: string) => api.get<{ site: string; display_name: string; email: string; account_id: string }>(`/jira/connections/me${q('', { base_url })}`).then((r) => r.data),
  sync: (force = false, board_id?: string) => api.post<JiraStatus>(`/jira/live/sync${q('', { force, board_id })}`).then((r) => r.data),
  reconciliation: (qs: string, includeMissing = true) => api.get<Reconciliation>(`/jira/live/reconciliation${q(qs, { include_missing: includeMissing })}`).then((r) => r.data),
  reconciliationFile: (fileId: string) => api.get<Reconciliation>(`/jira/live/reconciliation/file/${fileId}`).then((r) => r.data),
  issue: (key: string) => api.get<Record<string, unknown>>(`/jira/live/issues/${encodeURIComponent(key)}`).then((r) => r.data),
  lookup: () => api.get<{ items: Record<string, JiraIssueLite>; last_sync: string | null }>('/jira/live/lookup').then((r) => r.data),
  users: () => api.get<{ jira_users: { account_id: string; display_name: string; email: string | null; active: boolean }[]; mapping: UserMatch[] }>('/jira/live/users').then((r) => r.data),
  setUserMap: (body: { employee: string; account_id?: string | null; display_name?: string | null; email?: string | null }) =>
    api.put<{ mapping: UserMatch[] }>('/jira/live/user-map', body).then((r) => r.data),
}
