import { api } from '@/services/api'

export type Role = 'employee' | 'dm' | 'admin' | 'guest'
export type AccountStatus = 'pending_verification' | 'pending_approval' | 'active' | 'rejected' | 'disabled'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: Role
  requested_role: Role
  status: AccountStatus
  must_change_password: boolean
  email_verified_at: string | null
  approved_at: string | null
  rejection_reason: string | null
  last_login_at: string | null
  created_at: string | null
  access_expires_at: string | null
  access_expired: boolean
  board_ids: string[]
}

export interface AuthOptions {
  roles: { key: Role; label: string }[]
  allowed_domains: string[]
  email_enabled: boolean
  password_rules: string
  code_roles: Role[]
  guest_days: number
}

export interface MailResult {
  email_sent: boolean
  debug_link?: string
}

export const ROLE_LABEL: Record<Role, string> = { employee: 'Employee', dm: 'Delivery manager', admin: 'Admin', guest: 'Guest' }
export const ROLE_HELP: Record<Role, string> = {
  employee: 'Upload your bi-weekly workbooks and check they were received. Needs the auth code from your lead.',
  dm: 'Dashboards and reports for your boards. Needs the auth code from the administrator.',
  admin: 'Full access. Requires e-mail verification and superuser approval.',
  guest: 'Explore the dashboards on demo data for 5 days. Requires a guest auth code and e-mail verification.',
}
export const STATUS_LABEL: Record<AccountStatus, string> = {
  pending_verification: 'E-mail not verified',
  pending_approval: 'Waiting for approval',
  active: 'Active',
  rejected: 'Rejected',
  disabled: 'Disabled',
}

export const authApi = {
  options: () => api.get<AuthOptions>('/auth/options').then((r) => r.data),
  me: () => api.get<{ user: AuthUser | null }>('/auth/me').then((r) => r.data.user),
  signup: (body: { name: string; email: string; password: string; confirm_password: string; requested_role: Role; auth_code?: string }) =>
    api.post<{ status: AccountStatus; email: string; activated?: boolean } & MailResult>('/auth/signup', body).then((r) => r.data),
  resendVerification: (email: string) => api.post<MailResult>('/auth/resend-verification', { email }).then((r) => r.data),
  verifyEmail: (token: string) => api.post<{ status: AccountStatus; email: string; role: Role }>('/auth/verify-email', { token }).then((r) => r.data),
  login: (email: string, password: string) => api.post<{ user: AuthUser }>('/auth/login', { email, password }).then((r) => r.data.user),
  logout: () => api.post('/auth/logout').then(() => undefined),
  forgotPassword: (email: string) => api.post<MailResult>('/auth/forgot-password', { email }).then((r) => r.data),
  resetPassword: (token: string, password: string, confirm_password: string) =>
    api.post<{ ok: boolean; email: string }>('/auth/reset-password', { token, password, confirm_password }).then((r) => r.data),
  changePassword: (current_password: string, password: string, confirm_password: string) =>
    api.post<{ ok: boolean; user: AuthUser }>('/auth/change-password', { current_password, password, confirm_password }).then((r) => r.data.user),
}

export interface AuthCode { id: string; code: string; role: Role; board_id: string | null; board_label?: string | null; label: string | null; active: boolean; max_uses: number | null; uses: number; usable: boolean; expires_at: string | null; created_at: string | null }
export interface AccessRule { id: string; kind: 'domain' | 'email'; value: string; note: string | null; created_at: string | null }
export interface AuditEntry { id: number; action: string; target: string | null; detail: Record<string, unknown> | null; actor: string | null; created_at: string }

export const adminApi = {
  users: (status?: AccountStatus | '', q?: string) =>
    api.get<{ items: AuthUser[]; counts: Record<string, number> }>('/admin/users', { params: { status: status || undefined, q: q || undefined } }).then((r) => r.data),
  approve: (id: string, role?: Role) => api.post<AuthUser>(`/admin/users/${id}/approve`, { role }).then((r) => r.data),
  reject: (id: string, reason?: string) => api.post<AuthUser>(`/admin/users/${id}/reject`, { reason }).then((r) => r.data),
  setRole: (id: string, role: Role) => api.post<AuthUser>(`/admin/users/${id}/role`, { role }).then((r) => r.data),
  disable: (id: string) => api.post<AuthUser>(`/admin/users/${id}/disable`).then((r) => r.data),
  enable: (id: string) => api.post<AuthUser>(`/admin/users/${id}/enable`).then((r) => r.data),
  temporaryPassword: (id: string) => api.post<{ temporary_password: string; email_sent: boolean; user: AuthUser }>(`/admin/users/${id}/temporary-password`).then((r) => r.data),
  remove: (id: string) => api.delete(`/admin/users/${id}`).then(() => undefined),
  policy: () => api.get<{ domains: AccessRule[]; emails: AccessRule[]; defaults: string[] }>('/admin/access-policy').then((r) => r.data),
  addRule: (kind: 'domain' | 'email', value: string, note?: string) => api.post<AccessRule>('/admin/access-policy', { kind, value, note }).then((r) => r.data),
  removeRule: (id: string) => api.delete(`/admin/access-policy/${id}`).then(() => undefined),
  extend: (id: string, body: { days?: number; until?: string }) => api.post<AuthUser>(`/admin/users/${id}/extend`, body).then((r) => r.data),
  setBoards: (id: string, board_ids: string[]) => api.put<AuthUser>(`/admin/users/${id}/boards`, { board_ids }).then((r) => r.data),
  codes: () => api.get<{ items: AuthCode[]; boards: { id: string; label: string }[] }>('/admin/codes').then((r) => r.data),
  createCode: (body: { role: Role; label?: string; board_id?: string; expires_days?: number; max_uses?: number; code?: string }) => api.post<AuthCode>('/admin/codes', body).then((r) => r.data),
  revokeCode: (id: string) => api.post<AuthCode>(`/admin/codes/${id}/revoke`).then((r) => r.data),
  enableCode: (id: string) => api.post<AuthCode>(`/admin/codes/${id}/enable`).then((r) => r.data),
  deleteCode: (id: string) => api.delete(`/admin/codes/${id}`).then(() => undefined),
  audit: (limit = 100) => api.get<{ items: AuditEntry[] }>('/admin/audit', { params: { limit } }).then((r) => r.data.items),
}
