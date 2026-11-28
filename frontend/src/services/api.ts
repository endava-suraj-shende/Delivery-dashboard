import axios, { AxiosError } from 'axios'
import type {
  Activity,
  CompareData,
  DataQuality,
  DataStatus,
  Dimensions,
  EmployeeSummary,
  EmployeesList,
  EmployeesPerformance,
  IndividualPerformance,
  ExecutiveData,
  FileInfo,
  Overview,
  Paged,
  Period,
  ProjectRow,
  ProjectSummary,
  Release,
  ReportInfo,
  SearchResult,
  SprintDetail,
  SprintList,
  StatusConfig,
  TeamData,
  Ticket,
} from '@/types'

export const api = axios.create({ baseURL: '/api/v1', timeout: 120_000, withCredentials: true })

// Session expired or revoked: send the user back to the welcome page (except for auth probes themselves).
api.interceptors.response.use(undefined, (err: AxiosError) => {
  const url = err.config?.url ?? ''
  if (err.response?.status === 401 && !url.startsWith('/auth/') && !window.location.pathname.startsWith('/welcome')) {
    window.location.assign('/welcome')
  }
  return Promise.reject(err)
})

export interface ApiError {
  error: string
  message: string
  details?: Record<string, unknown>
}

export function errorMessage(err: unknown): string {
  const e = err as AxiosError<ApiError>
  if (e?.response?.data?.message) return e.response.data.message
  if (e?.message) return e.message
  return 'Unexpected error'
}

export function isNoData(err: unknown): boolean {
  const e = err as AxiosError<ApiError>
  return e?.response?.status === 409
}

const q = (qs: string, extra?: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams(qs)
  Object.entries(extra ?? {}).forEach(([k, v]) => v !== undefined && p.set(k, String(v)))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const excelApi = {
  status: () => api.get<DataStatus>('/excel/status').then((r) => r.data),
  refresh: () => api.post<DataStatus>('/excel/refresh').then((r) => r.data),
  files: () => api.get<{ items: FileInfo[]; status: DataStatus }>('/excel/files').then((r) => r.data),
  fileDetail: (id: string) => api.get<FileDetail>(`/excel/files/${id}`).then((r) => r.data),
  sheets: (id: string) => api.get<{ sheets: string[] }>(`/excel/sheets?file_id=${id}`).then((r) => r.data),
  preview: (id: string, sheet?: string, limit = 40) =>
    api.get<Preview>(`/excel/preview${q('', { file_id: id, sheet_name: sheet, limit })}`).then((r) => r.data),
  validate: (body: { file_id: string; sheet_name?: string; column_overrides?: Record<string, Record<string, string>> }) =>
    api.post<Validation>('/excel/validate', body).then((r) => r.data),
  upload: (file: File, replace = false) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<{ file_id: string; file_name: string; issues: unknown[]; status: DataStatus; jira: Record<string, unknown> | null }>(`/excel/upload?replace=${replace}`, fd).then((r) => r.data)
  },
  removeUpload: (id: string) => api.delete<DataStatus>(`/excel/uploads/${id}`).then((r) => r.data),
  clearUploads: () => api.delete<DataStatus>('/excel/uploads').then((r) => r.data),
  history: () => api.get<{ items: HistoryEntry[] }>('/excel/history').then((r) => r.data.items),
  my: () => api.get<MyUploads>('/excel/my').then((r) => r.data),
}

export interface MyUpload { id: string; file_id: string | null; file_name: string; size_bytes: number; employee: string | null; project: string | null; application: string | null; jira_board: string | null; report_date: string | null; layout: string | null; work_items: number; releases: number; issues: number; ok: boolean; uploaded_at: string | null }
export interface MyTicketRow { id: number; upload_id: string; file_name: string | null; source_row: number | null; ticket_id: string | null; ticket_link: string | null; application: string | null; work_details: string | null; work_type_raw: string | null; work_type: string | null; work_status_raw: string | null; work_status: string | null; prod_required: string | null; dev_deployment_raw: string | null; dev_deployment: string | null; prod_deployment: string | null; comments: string | null; report_date: string | null }
export interface MyUploads { uploads: MyUpload[]; tickets: MyTicketRow[] }

export const dataSourceApi = {
  get: () => api.get<DataStatus>('/data/source').then((r) => r.data),
  update: (body: { mode?: 'auto' | 'excel' | 'jira' | 'both'; lookback_days?: number; refresh_minutes?: number }) =>
    api.put<DataStatus>('/data/source', body).then((r) => r.data),
  reload: () => api.post<DataStatus>('/data/reload').then((r) => r.data),
}

export interface HistoryEntry {
  id: string
  timestamp: string
  reason: string
  source?: string
  jira_issues?: number
  files: number
  parsed: number
  failed: number
  duration_ms: number
  activities: number
  releases: number
  failures: { file: string; error: string }[]
}

export interface Preview {
  file_id: string
  file_name: string
  sheets: string[]
  sheet: string
  total_rows: number
  total_columns: number
  rows: (string | number | null)[][]
}

export interface Mapping {
  header_row: number
  headers: (string | null)[]
  fields: Record<string, { column_index: number; header: string | null }>
  unmapped_headers: string[]
}

export interface Validation {
  file_id: string
  file_name: string
  sheet_name: string | null
  layout: string
  valid: boolean
  errors: Record<string, unknown>[]
  warnings: Record<string, unknown>[]
  work_items: number
  releases: number
  work_mapping: Mapping | null
  release_mapping: Mapping | null
  canonical_fields: { work_items: string[]; releases: string[] }
  metadata: { employee: string | null; project: string | null; report_date: string | null }
}

export interface FileDetail {
  file: FileInfo
  metadata: Record<string, unknown> & { notes: string[] }
  work_mapping: Mapping | null
  release_mapping: Mapping | null
  issues: Record<string, unknown>[]
  work_items: Record<string, unknown>[]
  releases: Record<string, unknown>[]
  kt_items: Record<string, unknown>[]
}

export interface NarrativeFlag { code: string; severity: 'danger' | 'warning' | 'info'; text: string; value: number | string | null; link: { type: string; value: string } | null }
export interface Narrative {
  period: { label: string }
  scope: string
  headline: string
  paragraphs: { kind: 'headline' | 'delivery' | 'releases' | 'people' | 'risks' | 'next'; text: string }[]
  flags: NarrativeFlag[]
  facts: Record<string, number | string | null>
  generated_at: string
}

export interface Forecast {
  scope: string
  history: { weeks: number; days: number; completed: number; per_week: { week: string; completed: number }[]; avg_per_week: number; avg_per_day: number }
  remaining: number
  confidence: 'good' | 'fair' | 'low'
  runs: number
  generated_at: string
  completion: { percentiles: { p: number; days: number; date: string | null }[]; beyond_horizon_share: number } | null
  by_date: { date: string; days: number; percentiles: { p: number; completed: number }[]; probability_all_done: number | null; expected: number } | null
  note: string | null
}

export const dashboardApi = {
  executive: (qs: string) => api.get<ExecutiveData>(`/dashboard/executive${q(qs)}`).then((r) => r.data),
  narrative: (qs: string) => api.get<Narrative>(`/dashboard/narrative${q(qs)}`).then((r) => r.data),
  forecast: (qs: string, targetDate?: string | null, remaining?: number | null) =>
    api.get<Forecast>(`/dashboard/forecast${q(qs)}`, { params: { ...(targetDate ? { target_date: targetDate } : {}), ...(remaining != null ? { remaining } : {}) } }).then((r) => r.data),
  team: (qs: string) => api.get<TeamData>(`/dashboard/team${q(qs)}`).then((r) => r.data),
  activities: (qs: string, page = 1, pageSize = 100) =>
    api.get<Paged<Activity>>(`/dashboard/activities${q(qs, { page, page_size: pageSize })}`).then((r) => r.data),
  compare: (qs: string, a: [string, string], b: [string, string]) =>
    api.get<CompareData>(`/dashboard/compare${q(qs, { a_start: a[0], a_end: a[1], b_start: b[0], b_end: b[1] })}`).then((r) => r.data),
  quality: (qs: string, scope: 'period' | 'all' = 'period') => api.get<DataQuality>(`/dashboard/data-quality${q(qs, { scope })}`).then((r) => r.data),
}

// ---------------------------------------------------------------------------------------------- intelligence
export interface RiskModelStatus {
  trained: boolean
  reason: string | null
  samples: number
  positives: number
  tickets: number
  snapshot_ages: number[]
  auc: number | null
  accuracy: number | null
  brier: number | null
  trained_at: string | null
  data_version: number | null
  top_features: { feature: string; weight: number }[]
  method: string
  features: string[]
}
export interface IntelligenceStatus {
  model: RiskModelStatus
  llm: { enabled: boolean; provider: string | null; model: string | null; sends_ticket_text: boolean }
  capabilities: string[]
}
export type RiskBand = 'high' | 'medium' | 'low'
export interface RiskFactor { factor: string; value: number; impact: number }
export interface RiskItem {
  ticket_id: string
  employee: string | null
  project: string | null
  jira_board: string | null
  sprint: string | null
  work_status: string | null
  work_type: string | null
  due_date: string | null
  overdue: boolean
  ticket_link: string | null
  summary: string | null
  risk: number
  band: RiskBand
  factors: RiskFactor[]
  age_days: number
  days_blocked: number
}
export interface RiskSummary { open: number; high: number; medium: number; low: number; expected_slips?: number }
export interface RiskResponse {
  items: RiskItem[]
  summary: RiskSummary
  by_employee?: { employee: string; open: number; high: number; avg_risk: number }[]
  model: RiskModelStatus
}
export interface AnomalyItem {
  scope: string
  group_by: string
  metric: string
  metric_label: string
  week: string
  value: number
  baseline_median: number
  z: number
  baseline_min?: number
  baseline_max?: number
  baseline_weeks?: number
  history?: { week: string; value: number }[]
  meaning?: string
  direction: 'up' | 'down'
  severity: 'danger' | 'warning' | 'info'
  text: string
}
export interface AnomaliesResponse {
  weeks: number
  threshold: number
  items: AnomalyItem[]
  series: Record<string, { week: string; value: number }[]>
}
export interface Recommendation {
  kind: 'focus' | 'unblock' | 'rebalance' | 'due' | 'hygiene' | string
  priority: number
  title: string
  detail: string
  evidence: string[]
  effect: string | null
  tickets: string[]
  employees?: string[]
}
export interface RecommendationsResponse { items: Recommendation[]; risk_summary: RiskSummary; model: RiskModelStatus }
export interface AskResponse {
  question: string
  spec: { intent: string; parser: string; status: string[]; employee: string[]; project: string[]; jira_board: string[]; sprint: string[]; preset: string | null }
  filters: Period & Record<string, unknown>
  answer: string
  data: Record<string, unknown> | null
  links?: { label: string; url: string }[]
  grounding?: string
}

export const intelligenceApi = {
  status: () => api.get<IntelligenceStatus>('/intelligence/status').then((r) => r.data),
  risk: (qs: string, limit = 100) => api.get<RiskResponse>(`/intelligence/risk${q(qs, { limit })}`).then((r) => r.data),
  anomalies: (qs: string, groupBy: 'employee' | 'jira_board' = 'employee') =>
    api.get<AnomaliesResponse>(`/intelligence/anomalies${q(qs, { group_by: groupBy })}`).then((r) => r.data),
  recommendations: (qs: string) => api.get<RecommendationsResponse>(`/intelligence/recommendations${q(qs)}`).then((r) => r.data),
  ask: (qs: string, question: string) => api.post<AskResponse>(`/intelligence/ask${q(qs)}`, { question }).then((r) => r.data),
  retrain: () => api.post<RiskModelStatus>('/intelligence/retrain').then((r) => r.data),
}

export const employeeApi = {
  list: (qs: string) => api.get<EmployeesList>(`/employees${q(qs)}`).then((r) => r.data),
  performanceSummary: (qs: string) => api.get<EmployeesPerformance>(`/employees/performance${q(qs)}`).then((r) => r.data),
  summary: (name: string, qs: string) => api.get<EmployeeSummary>(`/employees/${encodeURIComponent(name)}/summary${q(qs)}`).then((r) => r.data),
  activities: (name: string, qs: string) =>
    api.get<Paged<Activity>>(`/employees/${encodeURIComponent(name)}/activities${q(qs, { page_size: 1000 })}`).then((r) => r.data),
  performance: (name: string, qs: string) => api.get<Performance>(`/employees/${encodeURIComponent(name)}/performance${q(qs)}`).then((r) => r.data),
  narrative: (name: string, qs: string) => api.get<Narrative>(`/employees/${encodeURIComponent(name)}/narrative${q(qs)}`).then((r) => r.data),
}

export interface Performance {
  employee: string
  current: { period: Period; kpis: Overview['kpis']; trend: Overview['charts']['trend'] }
  previous: { period: Period; kpis: Overview['kpis']; trend: Overview['charts']['trend'] }
  performance: IndividualPerformance
  tickets: Ticket[]
  releases: Release[]
}

export const projectApi = {
  list: (qs: string) => api.get<{ period: Period; items: ProjectRow[]; all: string[] }>(`/projects${q(qs)}`).then((r) => r.data),
  summary: (name: string, qs: string) => api.get<ProjectSummary>(`/projects/${encodeURIComponent(name)}/summary${q(qs)}`).then((r) => r.data),
}

export const sprintApi = {
  list: (qs: string) => api.get<SprintList>(`/sprints${q(qs)}`).then((r) => r.data),
  detail: (name: string, qs: string) => api.get<SprintDetail>(`/sprints/${encodeURIComponent(name)}${q(qs)}`).then((r) => r.data),
}

export const jiraApi = {
  summary: (qs: string) => api.get<Overview>(`/jira/summary${q(qs)}`).then((r) => r.data),
  tickets: (qs: string) => api.get<{ total: number; items: Ticket[] }>(`/jira/tickets${q(qs)}`).then((r) => r.data),
  ticket: (id: string) => api.get<{ ticket: Ticket; activities: Activity[]; releases: Release[] }>(`/jira/tickets/${encodeURIComponent(id)}`).then((r) => r.data),
}

export interface DevSummary {
  period: Period
  kpis: Overview['kpis']
  distribution: Overview['charts']['dev_deployment']
  by_employee: Overview['charts']['dev_by_employee']
  by_project: Overview['charts']['dev_by_project']
  by_application: Overview['charts']['dev_by_application']
  trend: Overview['charts']['trend']
  items: Activity[]
}

export interface ProdSummary {
  period: Period
  kpis: Overview['kpis']
  distribution: Overview['charts']['prod_deployment']
  prod_required: Overview['charts']['prod_required']
  by_employee: Overview['charts']['prod_by_employee']
  by_project: Overview['charts']['prod_by_project']
  by_application: Overview['charts']['prod_by_application']
  trend: Overview['charts']['release_trend']
  items: Release[]
}

export const deploymentApi = {
  dev: (qs: string) => api.get<DevSummary>(`/deployment/dev/summary${q(qs)}`).then((r) => r.data),
  prod: (qs: string) => api.get<ProdSummary>(`/deployment/production/summary${q(qs)}`).then((r) => r.data),
}

export const metaApi = {
  dimensions: (boards: string[] = []) => api.get<Dimensions>('/meta/dimensions', { params: { jira_board: boards }, paramsSerializer: { indexes: null } }).then((r) => r.data),
  search: (query: string) => api.get<SearchResult>(`/search?q=${encodeURIComponent(query)}`).then((r) => r.data),
  appConfig: () => api.get<AppConfig>('/config/app').then((r) => r.data),
}

export interface AppConfig {
  app_name: string
  version: string
  environment: string
  default_period_days: number
  max_upload_mb: number
  allowed_extensions: string[]
  data_dir_name: string
  authentication: string
  database: string
  jira_configured: boolean
  jira_email: string | null
  jira_boards: number
  jira_auto_sync: boolean
}

export const configApi = {
  get: () => api.get<StatusConfig>('/config/status').then((r) => r.data),
  update: (body: Partial<Pick<StatusConfig, 'mappings' | 'latest_status_rule' | 'count_blank_status_as'>>) =>
    api.put<StatusConfig>('/config/status', body).then((r) => r.data),
  addMapping: (dimension: string, category: string, value: string) =>
    api.post<StatusConfig>('/config/status/mapping', { dimension, category, value }).then((r) => r.data),
  reset: () => api.post<StatusConfig>('/config/status/reset').then((r) => r.data),
}

export interface ReportRequest {
  report_type: string
  format: 'pdf' | 'xlsx' | 'csv'
  target?: string | null
  filters: Record<string, unknown>
}

export const reportApi = {
  types: () => api.get<{ items: { key: string; label: string; requires_target: boolean }[]; formats: string[] }>('/reports/types').then((r) => r.data),
  generate: (body: ReportRequest) => api.post<ReportInfo>('/reports/generate', body).then((r) => r.data),
  list: () => api.get<{ items: ReportInfo[] }>('/reports').then((r) => r.data.items),
  downloadUrl: (id: string) => `/api/v1/reports/download/${id}`,
  schedules: () => api.get<{ items: ReportSchedule[]; cadences: string[]; presets: string[]; formats: string[]; email_enabled: boolean }>('/reports/schedules').then((r) => r.data),
  createSchedule: (body: ScheduleBody) => api.post<ReportSchedule>('/reports/schedules', body).then((r) => r.data),
  updateSchedule: (id: string, body: Partial<ScheduleBody>) => api.patch<ReportSchedule>(`/reports/schedules/${id}`, body).then((r) => r.data),
  deleteSchedule: (id: string) => api.delete(`/reports/schedules/${id}`).then((r) => r.data),
  sendScheduleNow: (id: string) => api.post<SchedulePreview>(`/reports/schedules/${id}/send-now`).then((r) => r.data),
  previewSchedule: (id: string) => api.post<SchedulePreview>(`/reports/schedules/${id}/preview`).then((r) => r.data),
}

export interface ScheduleBody {
  name: string
  recipients: string[]
  cadence: 'daily' | 'weekly' | 'fortnightly'
  weekday: number
  hour_utc: number
  preset: string
  format: 'pdf' | 'xlsx' | 'none'
  report_type: string
  include_narrative: boolean
  active: boolean
  filters: Record<string, string[]>
}
export interface ReportSchedule extends ScheduleBody {
  id: string
  owner_id: string
  owner: { id: string; name: string; email: string } | null
  last_run_at: string | null
  last_status: string | null
  next_run_at: string | null
  created_at: string
}
export interface SchedulePreview { sent: boolean; subject: string; paragraphs: string[]; flags: string[]; recipients: string[]; attachment: string | null; reason?: string }

export function filtersBodyFromQuery(qs: string): Record<string, unknown> {
  const p = new URLSearchParams(qs)
  const body: Record<string, unknown> = {}
  const s = p.get('start_date')
  const e = p.get('end_date')
  if (s) body.start_date = s
  if (e) body.end_date = e
  for (const key of ['employee', 'project', 'application', 'jira_board', 'sprint', 'status', 'work_type', 'dev_deployment', 'prod_deployment']) {
    const vals = p.getAll(key)
    if (vals.length) body[key] = vals
  }
  if (p.get('search')) body.search = p.get('search')
  return body
}

export interface SavedView {
  id: string
  owner_id: string
  name: string
  path: string
  query: string
  shared: boolean
  url: string
  mine: boolean
  owner: { name: string; email: string } | null
  created_at: string
  updated_at: string
}
export const viewsApi = {
  list: () => api.get<{ items: SavedView[] }>('/views').then((r) => r.data.items),
  create: (body: { name: string; path: string; query: string; shared: boolean }) => api.post<SavedView>('/views', body).then((r) => r.data),
  update: (id: string, body: Partial<{ name: string; shared: boolean; query: string }>) => api.patch<SavedView>(`/views/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/views/${id}`).then((r) => r.data),
}
