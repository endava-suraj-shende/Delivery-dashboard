import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart3,
  Users,
  UsersRound,
  FolderKanban,
  Ticket,
  Rocket,
  ServerCog,
  FileOutput,
  FileSpreadsheet,
  SlidersHorizontal,
  Settings,
  Menu,
  Moon,
  Sun,
  RefreshCw,
  ChevronLeft,
  GitCompareArrows,
  Database,
  Plug,
  Zap,
  LogOut,
  UserCog,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HelpTip } from '@/components/ui/primitives'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { GlobalSearch } from '@/components/common/GlobalSearch'
import { useDataStatus } from '@/hooks/useData'
import { useFilters } from '@/hooks/useFilters'
import { useTheme } from '@/hooks/useTheme'
import { useSession } from '@/hooks/useSession'
import { rolesFor, SUPERUSER_ROUTES } from '@/App'
import { isSuper } from '@/hooks/useSession'
import { ROLE_LABEL } from '@/services/authApi'
import { excelApi, errorMessage } from '@/services/api'
import { cn, fmtDate } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Executive Dashboard', icon: BarChart3, end: true },
  { to: '/employees', label: 'Employee Performance', icon: Users },
  { to: '/team', label: 'Team Performance', icon: UsersRound },
  { to: '/sprints', label: 'Sprint Performance', icon: Zap },
  { to: '/projects', label: 'Project Analytics', icon: FolderKanban },
  { to: '/jira', label: 'Jira Analytics', icon: Ticket },
  { to: '/deployments/dev', label: 'Dev Deployment', icon: ServerCog },
  { to: '/deployments/production', label: 'Production Releases', icon: Rocket },
  { to: '/compare', label: 'Period Comparison', icon: GitCompareArrows },
  { to: '/reports', label: 'Report Center', icon: FileOutput },
  { to: '/excel', label: 'Excel Data Management', icon: FileSpreadsheet },
  { to: '/config/status', label: 'Status Configuration', icon: SlidersHorizontal },
  { to: '/config/jira', label: 'Jira Connections', icon: Plug },
  { to: '/settings', label: 'Application Settings', icon: Settings },
  { to: '/admin/users', label: 'User Management', icon: UserCog },
]

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { theme, toggle } = useTheme()
  const { data: status } = useDataStatus()
  const { queryString } = useFilters()
  const qc = useQueryClient()
  const { toast } = useToast()
  const loc = useLocation()
  const nav = useNavigate()
  const { user, signOut } = useSession()
  const visibleNav = NAV.filter((n) => { const r = rolesFor(n.to); if (r && !(user && r.includes(user.role))) return false; return !SUPERUSER_ROUTES.includes(n.to) || isSuper(user) })
  const isGuest = user?.role === 'guest'
  const canRefresh = isSuper(user) || user?.role === 'dm'

  const refresh = useMutation({
    mutationFn: excelApi.refresh,
    onSuccess: (s) => {
      qc.invalidateQueries()
      toast({ title: 'Data refreshed', description: `${s.report_count} reports | ${s.activity_count} activities | ${s.release_count} releases`, variant: 'success' })
    },
    onError: (e) => toast({ title: 'Refresh failed', description: errorMessage(e), variant: 'destructive' }),
  })

  const withQuery = (to: string) => (queryString ? `${to}?${queryString}` : to)

  const sidebar = (
    <aside className={cn('flex h-full flex-col bg-sidebar text-sidebar-foreground transition-all duration-200', collapsed ? 'w-[68px]' : 'w-64')}>
      <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">D</div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">Delivery Dashboard</p>
            <p className="truncate text-[10px] text-sidebar-foreground/60">Employee & Project Performance</p>
          </div>
        )}
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {visibleNav.map((n) => {
          const Icon = n.icon
          const link = (
            <NavLink
              key={n.to}
              to={withQuery(n.to)}
              end={n.end}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent', isActive && 'bg-primary/90 text-primary-foreground hover:bg-primary', collapsed && 'justify-center px-2')
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{n.label}</span>}
            </NavLink>
          )
          return collapsed ? (
            <HelpTip key={n.to} text={n.label}>
              {link}
            </HelpTip>
          ) : (
            link
          )
        })}
      </nav>
      <div className="border-t border-white/10 p-2">
        {!collapsed && status && user?.role !== 'employee' && user?.role !== 'guest' && (
          <div className="mb-2 rounded-md bg-white/5 p-2 text-[11px] leading-relaxed text-sidebar-foreground/80">
            <p className="flex items-center gap-1 font-medium text-sidebar-foreground">
              {status.source === 'excel' ? <Database className="h-3 w-3" /> : <Plug className="h-3 w-3" />} Source: {status.source === 'jira' ? 'Jira boards' : status.source === 'both' ? 'Jira + Excel' : 'Excel'}
            </p>
            {status.jira ? <p>{status.jira.boards.length} board(s) | {status.jira.issues} issues</p> : <p>{status.file_count} files</p>}
            <p>{status.activity_count} activities | {status.employee_count} employees | {status.project_count} projects</p>
            <p>Range: {fmtDate(status.date_min, { day: '2-digit', month: 'short' })} - {fmtDate(status.date_max, { day: '2-digit', month: 'short' })}</p>
            <p className="truncate">Refreshed {status.last_refresh ? new Date(status.last_refresh).toLocaleTimeString() : '-'}</p>
          </div>
        )}
        <Button variant="ghost" size="sm" className="hidden w-full justify-center text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground lg:flex" onClick={() => setCollapsed((c) => !c)}>
          <ChevronLeft className={cn('transition-transform', collapsed && 'rotate-180')} />
          {!collapsed && 'Collapse'}
        </Button>
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden lg:block no-print">{sidebar}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0">{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4 no-print">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          {canRefresh && <GlobalSearch />}
          <div className="ml-auto flex items-center gap-2">
            {status && user?.role !== 'employee' && user?.role !== 'guest' && (
              <HelpTip text={`Source: ${status.source_dir}\nLast refresh: ${status.last_refresh ? new Date(status.last_refresh).toLocaleString() : '-'}\nLoad time: ${status.load_duration_ms ?? '-'} ms`}>
                <div className="hidden items-center gap-2 md:flex">
                  <Badge variant={status.needs_refresh ? 'warning' : 'success'} className="gap-1 font-normal">
                    {status.source === 'excel' ? <FileSpreadsheet className="h-3 w-3" /> : <Plug className="h-3 w-3" />}
                    {status.source === 'excel'
                      ? <>{status.file_count} workbooks{status.uploads > 0 && ` (+${status.uploads} uploaded)`}</>
                      : <>{status.jira?.boards.length ?? 0} Jira board(s) | {status.jira?.issues ?? 0} issues{status.source === 'both' && ` + ${status.file_count - (status.jira?.boards.length ?? 0)} workbooks`}</>}
                  </Badge>
                  {status.needs_refresh && <span className="text-[11px] text-orange-600">{status.source === 'excel' ? 'Source changed - refresh' : 'Refresh due'}</span>}
                </div>
              </HelpTip>
            )}
            {canRefresh && (
              <Button variant="outline" size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                <RefreshCw className={cn(refresh.isPending && 'animate-spin')} /> Refresh data
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
            {user && (
              <HelpTip text={`${user.email}\n${isSuper(user) ? 'Superuser' : ROLE_LABEL[user.role]}`}>
                <div className="ml-1 flex items-center gap-2 rounded-full border py-1 pl-1 pr-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</span>
                  <span className="hidden max-w-[160px] flex-col leading-tight md:flex"><span className="truncate text-xs font-medium">{user.name}</span><span className="truncate text-[10px] text-muted-foreground">{isSuper(user) ? 'Superuser' : ROLE_LABEL[user.role]}</span></span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={async () => { await signOut(); nav('/welcome') }} aria-label="Sign out" title="Sign out"><LogOut className="h-3.5 w-3.5" /></Button>
                </div>
              </HelpTip>
            )}
          </div>
        </header>
        {isGuest && (
          <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-800 dark:text-amber-200 no-print">
            <Sparkles className="h-3.5 w-3.5" /> <b>Demo data.</b> You are exploring the dashboards with synthetic people and tickets. Guest access ends {user?.access_expires_at ? new Date(user.access_expires_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : 'soon'}.
          </div>
        )}
        <main key={loc.pathname} className="flex-1 overflow-y-auto p-4 md:p-6 print-full">
          <div className="mx-auto max-w-[1600px] space-y-5">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
