import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppLayout } from '@/layouts/AppLayout'
import { FilterProvider } from '@/hooks/useFilters'
import { ThemeProvider } from '@/hooks/useTheme'
import { homeFor, SessionProvider, useSession } from '@/hooks/useSession'
import type { Role } from '@/services/authApi'
import { ToastProvider } from '@/components/ui/toast'
import { TooltipProvider } from '@/components/ui/primitives'
import { LoadingState } from '@/components/common/States'

const ExecutivePage = lazy(() => import('@/modules/executive/ExecutivePage'))
const EmployeesPage = lazy(() => import('@/modules/employees/EmployeesPage'))
const EmployeeDetailPage = lazy(() => import('@/modules/employees/EmployeeDetailPage'))
const TeamPage = lazy(() => import('@/modules/teams/TeamPage'))
const SprintsPage = lazy(() => import('@/modules/sprints/SprintsPage'))
const ProjectsPage = lazy(() => import('@/modules/projects/ProjectPages').then((m) => ({ default: m.ProjectsPage })))
const ProjectDetailPage = lazy(() => import('@/modules/projects/ProjectPages').then((m) => ({ default: m.ProjectDetailPage })))
const JiraPage = lazy(() => import('@/modules/jira/JiraPage'))
const DevDeploymentPage = lazy(() => import('@/modules/deployments/DeploymentPages').then((m) => ({ default: m.DevDeploymentPage })))
const ProductionPage = lazy(() => import('@/modules/deployments/DeploymentPages').then((m) => ({ default: m.ProductionPage })))
const ReportsPage = lazy(() => import('@/modules/reports/ReportsPage'))
const ExcelPage = lazy(() => import('@/modules/excel/ExcelPage'))
const StatusConfigPage = lazy(() => import('@/modules/config/StatusConfigPage'))
const JiraConnectionsPage = lazy(() => import('@/modules/config/JiraConnectionsPage'))
const ComparePage = lazy(() => import('@/modules/config/MiscPages').then((m) => ({ default: m.ComparePage })))
const WelcomePage = lazy(() => import('@/modules/welcome/WelcomePage'))
const DemoPage = lazy(() => import('@/modules/welcome/DemoPage'))
const SettingsPage = lazy(() => import('@/modules/config/MiscPages').then((m) => ({ default: m.SettingsPage })))
const UsersAdminPage = lazy(() => import('@/modules/admin/UsersAdminPage'))
const VerifyEmailPage = lazy(() => import('@/modules/auth/AuthPages').then((m) => ({ default: m.VerifyEmailPage })))
const ResetPasswordPage = lazy(() => import('@/modules/auth/AuthPages').then((m) => ({ default: m.ResetPasswordPage })))
const ChangePasswordPage = lazy(() => import('@/modules/auth/AuthPages').then((m) => ({ default: m.ChangePasswordPage })))
const PendingApprovalPage = lazy(() => import('@/modules/auth/AuthPages').then((m) => ({ default: m.PendingApprovalPage })))

/** Which roles may open each route. Anything not listed is open to every active user. */
const V: Role[] = ['admin', 'dm', 'guest']  // dashboard viewers (guests see demo data)
export const ROUTE_ROLES: Record<string, Role[]> = {
  '/': V, '/employees': V, '/team': V, '/sprints': V, '/projects': V, '/jira': V, '/deployments/dev': V,
  '/deployments/production': V, '/compare': V, '/reports': ['admin', 'dm'],
  '/excel': ['admin', 'dm', 'employee'], '/config/jira': ['admin', 'dm'],
  '/config/status': ['admin'], '/settings': ['admin'], '/admin/users': ['admin'],
}

export function rolesFor(pathname: string): Role[] | undefined {
  const keys = Object.keys(ROUTE_ROLES).sort((a, b) => b.length - a.length)
  const hit = keys.find((k) => (k === '/' ? pathname === '/' : pathname === k || pathname.startsWith(k + '/')))
  return hit ? ROUTE_ROLES[hit] : undefined
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
})

function RequireSession() {
  const { user, ready } = useSession()
  const loc = useLocation()
  if (!ready) return <LoadingState />
  if (!user) return <Navigate to="/welcome" replace state={{ from: loc.pathname + loc.search }} />
  return <Outlet />
}

/** Signed in, e-mail verified, approved and not on a temporary password. */
function RequireActive() {
  const { user } = useSession()
  const loc = useLocation()
  if (!user) return <Navigate to="/welcome" replace />
  if (user.must_change_password && loc.pathname !== '/change-password') return <Navigate to="/change-password" replace />
  if (user.status !== 'active' || user.access_expired) return <Navigate to="/pending" replace />
  const allowed = rolesFor(loc.pathname)
  if (allowed && !allowed.includes(user.role)) return <Navigate to={homeFor(user)} replace />
  return <Outlet />
}

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingState />}>{children}</Suspense>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <ToastProvider>
            <BrowserRouter>
              <SessionProvider>
              <FilterProvider>
                <Routes>
                  <Route path="welcome" element={<Suspense fallback={<LoadingState />}><WelcomePage /></Suspense>} />
                  <Route path="demo" element={<Suspense fallback={<LoadingState />}><DemoPage /></Suspense>} />
                  <Route path="verify-email" element={<Lazy><VerifyEmailPage /></Lazy>} />
                  <Route path="reset-password" element={<Lazy><ResetPasswordPage /></Lazy>} />
                  <Route element={<RequireSession />}>
                  <Route path="pending" element={<Lazy><PendingApprovalPage /></Lazy>} />
                  <Route path="change-password" element={<Lazy><ChangePasswordPage /></Lazy>} />
                  <Route element={<RequireActive />}>
                  <Route element={<AppLayout />}>
                    <Route
                      index
                      element={
                        <Suspense fallback={<LoadingState />}>
                          <ExecutivePage />
                        </Suspense>
                      }
                    />
                    <Route path="employees" element={<Suspense fallback={<LoadingState />}><EmployeesPage /></Suspense>} />
                    <Route path="employees/:name" element={<Suspense fallback={<LoadingState />}><EmployeeDetailPage /></Suspense>} />
                    <Route path="team" element={<Suspense fallback={<LoadingState />}><TeamPage /></Suspense>} />
                    <Route path="sprints" element={<Suspense fallback={<LoadingState />}><SprintsPage /></Suspense>} />
                    <Route path="projects" element={<Suspense fallback={<LoadingState />}><ProjectsPage /></Suspense>} />
                    <Route path="projects/:name" element={<Suspense fallback={<LoadingState />}><ProjectDetailPage /></Suspense>} />
                    <Route path="jira" element={<Suspense fallback={<LoadingState />}><JiraPage /></Suspense>} />
                    <Route path="deployments/dev" element={<Suspense fallback={<LoadingState />}><DevDeploymentPage /></Suspense>} />
                    <Route path="deployments/production" element={<Suspense fallback={<LoadingState />}><ProductionPage /></Suspense>} />
                    <Route path="compare" element={<Suspense fallback={<LoadingState />}><ComparePage /></Suspense>} />
                    <Route path="reports" element={<Suspense fallback={<LoadingState />}><ReportsPage /></Suspense>} />
                    <Route path="excel" element={<Suspense fallback={<LoadingState />}><ExcelPage /></Suspense>} />
                    <Route path="config/status" element={<Suspense fallback={<LoadingState />}><StatusConfigPage /></Suspense>} />
                    <Route path="config/jira" element={<Suspense fallback={<LoadingState />}><JiraConnectionsPage /></Suspense>} />
                    <Route path="settings" element={<Suspense fallback={<LoadingState />}><SettingsPage /></Suspense>} />
                    <Route path="admin/users" element={<Lazy><UsersAdminPage /></Lazy>} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                  </Route>
                  </Route>
                </Routes>
              </FilterProvider>
              </SessionProvider>
            </BrowserRouter>
          </ToastProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
