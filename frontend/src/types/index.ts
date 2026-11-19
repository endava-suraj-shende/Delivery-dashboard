export interface CategoryPoint {
  key: string
  label: string
  color: string
  value: number
}

export interface GroupedRow {
  name: string
  total: number
  [category: string]: string | number
}

export interface NamedValue {
  name: string
  value: number
}

export interface TrendPoint {
  date: string
  activities: number
  reports: number
  employees: number
  unique_tickets: number
  completed_tickets: number
  completed_activities: number
  in_progress_activities: number
  blocked_activities: number
  pending_activities: number
  development: number
  analysis: number
  testing: number
  deployment: number
  bug_fix: number
  dev_deployed: number
  dev_pending: number
  backlog: number
  releases: number
  released: number
}

export interface ReleaseTrendPoint {
  date: string
  total: number
  [k: string]: string | number
}

export interface KPIs {
  total_employees: number
  active_employees: number
  inactive_employees: number
  total_reports: number
  total_activities: number
  activities_with_ticket: number
  activities_without_ticket: number
  duplicate_activities: number
  total_tickets: number
  completed_tickets: number
  in_progress_tickets: number
  pending_tickets: number
  blocked_tickets: number
  on_hold_tickets: number
  analysis_tickets: number
  other_status_tickets: number
  remaining_tickets: number
  completion_rate: number | null
  tickets_changed_status: number
  ticket_status: Record<string, number>
  ticket_type: Record<string, number>
  activity_status: Record<string, number>
  activity_type: Record<string, number>
  development_activities: number
  analysis_activities: number
  testing_activities: number
  deployment_activities: number
  bugfix_activities: number
  dev_deployment: Record<string, number>
  dev_deployment_activities: number
  dev_deployed: number
  dev_pending: number
  prod_required: Record<string, number>
  prod_required_yes: number
  prod_deployment: Record<string, number>
  production_releases: number
  production_release_tickets: number
  production_released: number
  production_pending: number
  production_blocked: number
  production_success_rate: number | null
  projects: number
  applications: number
  jira_boards: number
}

export interface Period {
  start_date: string | null
  end_date: string | null
  label: string
  days: number
  report_dates: string[]
  report_count: number
}

export interface Insight {
  type: 'success' | 'info' | 'warning' | 'danger'
  title: string
  detail: string
  value: number | string | null
  link: { type: string; value: string } | null
}

export interface EmployeeRow {
  employee: string
  project: string | null
  application: string | null
  jira_board: string | null
  team_lead: string | null
  reports: number
  last_report_date: string | null
  total_activities: number
  unique_tickets: number
  completed: number
  in_progress: number
  pending: number
  blocked: number
  on_hold: number
  other_status: number
  code_review: number
  testing_tickets: number
  development_tickets: number
  ready_for_deployment: number
  analysis_tickets: number
  backlog: number
  reopened: number
  cancelled: number
  analysis: number
  development: number
  testing: number
  deployment: number
  bug_fix: number
  dev_deployed: number
  dev_pending: number
  production_releases: number
  production_released: number
  production_pending: number
  production_blocked: number
  production_status: string | null
  completion_rate: number | null
  due_tracked: number
  on_time: number
  late: number
  overdue: number
  carried_in: number
  new_in_period: number
  completed_carried: number
  completed_new: number
  completed_pct: number | null
  avg_cycle_days: number | null
  median_cycle_days: number | null
  team_avg_cycle_days: number | null
  score: number | null
  rating: RatingKey
  rating_label: string
  rating_color: string
  low_confidence: boolean
  completion_pct: number | null
  on_time_pct: number | null
  dev_deployment_pct: number | null
  prod_deployment_pct: number | null
  flow_health_pct: number | null
  weights_used: Record<string, number>
  risk_flags: string[]
  previous_score?: number | null
  previous_rating?: RatingKey | null
}

export type RatingKey = 'excellent' | 'good' | 'needs_improvement' | 'at_risk' | 'unrated' | 'no_activity'

export interface RatingBand {
  key: RatingKey
  label: string
  min: number | null
  color: string
  order: number
}

export interface TeamPerformance {
  score: number | null
  rating: RatingKey
  rating_label: string
  rating_color: string
  rated_employees: number
  inactive_employees: number
  tickets: number
  completed: number
  blocked: number
  overdue: number
  on_time: number
  late: number
  completion_pct: number | null
  on_time_pct: number | null
  dev_deployment_pct: number | null
  prod_deployment_pct: number | null
  distribution: CategoryPoint[]
  at_risk: string[]
  needs_improvement: string[]
  excellent: string[]
}

export interface EmployeesList {
  period: Period
  items: EmployeeRow[]
  inactive: string[]
  all: string[]
  team: TeamPerformance
  bands: RatingBand[]
  performance_rules: string[]
  source: 'excel' | 'jira' | 'both'
}

export interface EmployeesPerformance {
  period: Period
  previous_period: Period | null
  items: EmployeeRow[]
  inactive: string[]
  team: TeamPerformance
  previous_team: TeamPerformance | null
  bands: RatingBand[]
  performance_rules: string[]
  source: 'excel' | 'jira' | 'both'
}

export interface MetricRow {
  key: string
  label: string
  kind: 'count' | 'pct' | 'score'
  hint: string
  current: number | null
  previous: number | null
  delta: number | null
}

export interface IndividualPerformance {
  current: EmployeeRow | null
  previous: EmployeeRow | null
  metrics: MetricRow[]
  bands: RatingBand[]
  rules: string[]
}

export interface ProjectRow {
  project: string
  employees: number
  employee_names: string[]
  applications: string[]
  jira_boards: string[]
  total_activities: number
  unique_tickets: number
  completed: number
  in_progress: number
  pending: number
  blocked: number
  other_status: number
  analysis: number
  development: number
  testing: number
  deployment: number
  bug_fix: number
  dev_deployed: number
  dev_pending: number
  production_releases: number
  production_released: number
  production_pending: number
  production_blocked: number
  backlog: number
  completion_rate: number | null
}

export interface Charts {
  ticket_status: CategoryPoint[]
  activity_status: CategoryPoint[]
  work_type: CategoryPoint[]
  dev_deployment: CategoryPoint[]
  prod_deployment: CategoryPoint[]
  prod_required: CategoryPoint[]
  status_by_employee: GroupedRow[]
  status_by_project: GroupedRow[]
  status_by_application: GroupedRow[]
  status_by_board: GroupedRow[]
  type_by_employee: GroupedRow[]
  type_by_project: GroupedRow[]
  dev_by_employee: GroupedRow[]
  dev_by_project: GroupedRow[]
  dev_by_application: GroupedRow[]
  prod_by_employee: GroupedRow[]
  prod_by_project: GroupedRow[]
  prod_by_application: GroupedRow[]
  activities_by_employee: NamedValue[]
  activities_by_project: NamedValue[]
  activities_by_application: NamedValue[]
  trend: TrendPoint[]
  release_trend: ReleaseTrendPoint[]
  weekly_by_employee?: WeeklyByEmployee
}

export interface WeeklyCell {
  week: string
  worked: number
  activities: number
  new: number
  brand_new: number
  completed: number
  blocked: number
}

export interface WeeklyByEmployee {
  weeks: string[]
  employees: { employee: string; weeks: WeeklyCell[]; total_new: number; total_completed: number }[]
}

export interface Overview {
  period: Period
  filters: Record<string, unknown>
  kpis: KPIs
  previous_kpis: KPIs | null
  charts: Charts
  insights: Insight[]
  employees: EmployeeRow[]
  projects: ProjectRow[]
  calculation_rules: string[]
  latest_status_rule: string
  source: 'excel' | 'jira' | 'both'
}

export interface ExecutiveData extends Overview {
  data_quality: QualitySummary
  jira: { compared: number; matched: number; errors: number; warnings: number; not_found: number; missing_from_excel: number; last_sync: string | null; stale: boolean } | null
}

export interface SprintRow {
  id: number | null
  name: string
  state: 'active' | 'closed' | 'future' | null
  board: string | null
  board_id: number | null
  start_date: string | null
  end_date: string | null
  complete_date: string | null
  goal: string | null
  tickets: number
  completed: number
  in_progress: number
  pending: number
  blocked: number
  analysis: number
  cancelled: number
  other: number
  activities: number
  employees: number
  production_releases: number
  production_released: number
  committed_points: number
  completed_points: number
  estimated_tickets: number
  completed_share: number | null
  ticket_status: Record<string, number>
}

export interface SprintList {
  items: SprintRow[]
  active: string | null
  source: 'excel' | 'jira' | 'both'
  velocity: {
    unit: 'points' | 'tickets'
    items: { name: string; state: string | null; start_date: string | null; end_date: string | null; committed: number; completed: number; committed_tickets: number; completed_tickets: number; committed_points: number; completed_points: number }[]
    average_completed: number | null
    average_last3: number | null
    average_completed_tickets: number | null
    average_last3_tickets: number | null
    average_completed_points: number | null
    average_last3_points: number | null
    estimated_share: number
    closed_sprints: number
  }
}

export interface SprintDetail extends Overview {
  sprint: SprintRow
  previous_sprint: SprintRow | null
  tickets: Ticket[]
  releases: Release[]
}

export interface Activity {
  activity_id: string
  report_date: string | null
  employee: string | null
  project: string | null
  application: string | null
  jira_board: string | null
  ticket_id: string | null
  ticket_ids: string[]
  ticket_raw: string | null
  ticket_link: string | null
  work_details: string | null
  work_type: string
  work_type_raw: string | null
  work_status: string
  work_status_raw: string | null
  prod_required: string
  prod_required_raw: string | null
  dev_deployment: string
  dev_deployment_raw: string | null
  environment: string | null
  comments: string | null
  has_ticket: boolean
  is_duplicate: boolean
  file_name: string
  source_row: number
}

export interface Release {
  release_id: string
  release_date: string | null
  release_date_source: string
  report_date: string | null
  employee: string | null
  project: string | null
  application: string | null
  jira_board: string | null
  ticket_id: string | null
  ticket_ids: string[]
  ticket_raw: string | null
  release_details: string | null
  prod_deployment: string
  prod_deployment_raw: string | null
  comments: string | null
  file_name: string
  source_row: number
}

export interface Ticket {
  ticket_id: string
  work_status: string
  work_status_raw: string | null
  work_type: string
  work_type_raw: string | null
  dev_deployment: string
  dev_deployment_raw: string | null
  prod_required: string
  prod_required_raw: string | null
  prod_deployment: string
  prod_deployment_raw: string | null
  has_release: boolean
  release_date: string | null
  work_details: string | null
  ticket_link: string | null
  employee: string
  employees: string[]
  project: string
  application: string
  jira_board: string
  activity_count: number
  report_count: number
  first_seen: string | null
  last_seen: string | null
  completed_on: string | null
  blocked_since: string | null
  latest_report_date: string | null
  status_changed: boolean
  is_remaining: boolean
  status_history?: { date: string; status: string; status_raw: string | null; employee: string }[]
}

export interface Paged<T> {
  total: number
  page: number
  page_size: number
  filters: Record<string, unknown>
  items: T[]
}

export interface QualitySummary {
  total_issues: number
  errors: number
  warnings: number
  missing_employee: number
  missing_project: number
  missing_ticket: number
  missing_status: number
  invalid_dates: number
  duplicates: number
  incomplete_deployment: number
  unmapped_statuses: number
  activities_without_ticket: number
  files_with_errors: number
}

export interface Issue {
  issue_id: string
  file_id: string
  file_name: string
  employee: string | null
  severity: 'error' | 'warning' | 'info'
  category: string
  message: string
  sheet: string | null
  row: number | null
  field: string | null
  value: string | null
}

export interface DataQuality {
  summary: QualitySummary
  by_category: { category: string; severity: string; count: number }[]
  unmapped: Record<string, Record<string, number>>
  issues: Issue[]
}

export interface DataStatus {
  loaded: boolean
  loading: boolean
  source: 'excel' | 'jira' | 'both'
  configured_mode: 'auto' | 'excel' | 'jira' | 'both'
  jira_available: boolean
  lookback_days: number
  refresh_minutes: number
  modes: string[]
  jira: { boards: string[]; issues: number; activities: number; errors: { scope: string; error: string }[]; fields_resolved: Record<string, Record<string, string | null>>; loaded_at: string | null } | null
  source_dir: string
  upload_dir: string
  file_count: number
  report_count: number
  activity_count: number
  release_count: number
  employee_count: number
  project_count: number
  last_refresh: string | null
  load_duration_ms: number | null
  signature: string | null
  date_min: string | null
  date_max: string | null
  issues_count: number
  uploads: number
  needs_refresh: boolean
  version: number
}

export interface FileInfo {
  file_id: string
  file_name: string
  folder: string
  origin: 'folder' | 'upload'
  size_bytes: number
  modified_at: string | null
  sheet_name: string | null
  layout: string
  employee: string | null
  project: string | null
  application: string | null
  jira_board: string | null
  report_date: string | null
  report_date_source: string
  work_items: number
  releases: number
  kt_items: number
  issues: number
  ok: boolean
  notes: string[]
}

export interface Dimensions {
  employees: string[]
  projects: string[]
  applications: string[]
  jira_boards: string[]
  sprints: string[]
  team_leads: string[]
  work_status: CategoryPoint[]
  work_type: CategoryPoint[]
  dev_deployment: CategoryPoint[]
  prod_deployment: CategoryPoint[]
  prod_required: CategoryPoint[]
  report_dates: string[]
  date_min: string | null
  date_max: string | null
}

export interface CategoryMeta {
  label: string
  color: string
  order: number
  terminal?: boolean
}

export interface StatusConfig {
  mappings: Record<string, Record<string, string[]>>
  latest_status_rule: string
  count_blank_status_as: string
  categories: Record<string, Record<string, CategoryMeta>>
  latest_status_rules: Record<string, string>
  unmapped: Record<string, Record<string, number>>
}

export interface ReportInfo {
  report_id: string
  report_type: string
  format: string
  file_name: string
  size_bytes: number
  created_at: string
  target: string | null
  period: string | null
}

export interface SearchResult {
  employees: string[]
  projects: string[]
  applications: string[]
  jira_boards: string[]
  tickets: { ticket_id: string; employee: string; work_details: string | null }[]
  notes: { activity_id: string; employee: string; ticket_id: string | null; work_details: string | null; comments: string | null; report_date: string | null }[]
}

export interface EmployeeSummary extends Overview {
  employee: string
  profile: {
    file_id: string
    file_name: string
    report_date: string | null
    project: string | null
    application: string | null
    jira_board: string | null
    team_lead: string | null
    team_members: string | null
    notes: string[]
    work_items: number
    releases: number
    issues: number
  }[]
}

export interface ProjectSummary extends Overview {
  project: string
  tickets: Ticket[]
  releases: Release[]
}

export interface TeamData extends Overview {
  tickets: Ticket[]
  releases: Release[]
}

export interface CompareData {
  a: { period: Period; kpis: KPIs; trend: TrendPoint[]; employees: EmployeeRow[] }
  b: { period: Period; kpis: KPIs; trend: TrendPoint[]; employees: EmployeeRow[] }
  deltas: Record<string, { a: number | null; b: number | null; delta: number | null }>
}
