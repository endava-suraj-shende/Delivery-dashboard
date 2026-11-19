import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ServerCog, CheckCircle2, Activity, Hourglass, AlertOctagon, XCircle, MinusCircle, HelpCircle, Rocket, Ticket } from 'lucide-react'
import { KpiCard, KpiGrid } from '@/components/common/KpiCard'
import { ChartCard, DonutChart, StackedBarChart, TrendBarChart, DEV_SERIES, PROD_SERIES } from '@/components/charts'
import { GlobalFilterBar, PageHeader, PrintButton } from '@/components/common/PageHeader'
import { ErrorState, LoadingState } from '@/components/common/States'
import { ActivitiesTable, ReleasesTable, TicketDialog } from '@/components/common/Tables'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useFilters } from '@/hooks/useFilters'
import { deploymentApi } from '@/services/api'
import { cn, colorFor } from '@/lib/utils'
import { FEATURES } from '@/lib/features'

const hex = (c: string) => colorFor(c)

export function DevDeploymentPage() {
  const { queryString, toggleValue, filters } = useFilters()
  const nav = useNavigate()
  const [ticket, setTicket] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['deploy', 'dev', queryString], queryFn: () => deploymentApi.dev(queryString), placeholderData: (p) => p })
  const d = q.data
  const dd = d?.kpis.dev_deployment
  const qs = queryString ? `?${queryString}` : ''
  return (
    <>
      <PageHeader title="Dev Deployment" description="Development deployment activity tracked from the 'Dev Deployment Status' column of every work item." breadcrumbs={[{ label: 'Dev Deployment' }]} period={d?.period} actions={<PrintButton />} />
      <GlobalFilterBar showStatus={false} />
      {q.isLoading && <LoadingState />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && dd && (
        <>
          <KpiGrid cols={6}>
            <KpiCard label="Deployment activities" value={d.kpis.dev_deployment_activities} icon={<ServerCog className="h-4 w-4" />} tone="teal" compact hint="Activity rows where Dev Deployment is not 'Not Applicable' / unknown." />
            <KpiCard label="Successfully deployed" value={dd.deployed} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" compact onClick={() => toggleValue('dev_deployment', 'deployed')} active={filters.dev_deployment.includes('deployed')} />
            <KpiCard label="In progress" value={dd.in_progress} icon={<Activity className="h-4 w-4" />} tone="blue" compact onClick={() => toggleValue('dev_deployment', 'in_progress')} />
            <KpiCard label="Pending" value={dd.pending} icon={<Hourglass className="h-4 w-4" />} tone="orange" compact onClick={() => toggleValue('dev_deployment', 'pending')} active={filters.dev_deployment.includes('pending')} />
            <KpiCard label="Blocked" value={dd.blocked} icon={<AlertOctagon className="h-4 w-4" />} tone="red" compact onClick={() => toggleValue('dev_deployment', 'blocked')} />
            <KpiCard label="Failed" value={dd.failed} icon={<XCircle className="h-4 w-4" />} tone="red" compact onClick={() => toggleValue('dev_deployment', 'failed')} />
            <KpiCard label="Not required" value={dd.not_required} icon={<MinusCircle className="h-4 w-4" />} tone="grey" compact onClick={() => toggleValue('dev_deployment', 'not_required')} />
            <KpiCard label="Unknown / unmapped" value={dd.other} icon={<HelpCircle className="h-4 w-4" />} tone="grey" compact onClick={() => toggleValue('dev_deployment', 'other')} />
          </KpiGrid>
          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard title="Dev deployment status distribution">
              <DonutChart data={d.distribution} onSelect={(k) => toggleValue('dev_deployment', k)} selected={filters.dev_deployment} centerLabel="activities" />
            </ChartCard>
            <ChartCard title="Dev deployment by employee" className="lg:col-span-2">
              <StackedBarChart data={d.by_employee} series={DEV_SERIES} onSelect={(n) => nav(`/employees/${encodeURIComponent(n)}${qs}`)} max={30} />
            </ChartCard>
          </div>
          <div className={cn('grid gap-4', FEATURES.applications ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}>
            <ChartCard title="Dev deployment by project">
              <StackedBarChart data={d.by_project} series={DEV_SERIES} onSelect={(n) => nav(`/projects/${encodeURIComponent(n)}${qs}`)} />
            </ChartCard>
            {FEATURES.applications && (
              <ChartCard title="Application-wise deployment summary">
                <StackedBarChart data={d.by_application} series={DEV_SERIES} onSelect={(n) => toggleValue('application', n)} />
              </ChartCard>
            )}
            <ChartCard title="Daily dev deployment trend">
              <TrendBarChart data={d.trend} series={[{ key: 'dev_deployed', label: 'Deployed', color: hex('green') }, { key: 'dev_pending', label: 'Pending', color: hex('orange') }]} />
            </ChartCard>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Dev deployment detail ({d.items.length})</CardTitle>
              <CardDescription>Filter by employee, project, application, date and deployment status using the global filters or column filters.</CardDescription>
            </CardHeader>
            <CardContent>
              <ActivitiesTable items={d.items} onTicket={setTicket} pageSize={50} />
            </CardContent>
          </Card>
        </>
      )}
      <TicketDialog ticketId={ticket} onClose={() => setTicket(null)} />
    </>
  )
}

export function ProductionPage() {
  const { queryString, toggleValue, filters } = useFilters()
  const nav = useNavigate()
  const [ticket, setTicket] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['deploy', 'prod', queryString], queryFn: () => deploymentApi.prod(queryString), placeholderData: (p) => p })
  const d = q.data
  const pd = d?.kpis.prod_deployment
  const qs = queryString ? `?${queryString}` : ''
  return (
    <>
      <PageHeader
        title="Production Releases"
        description="Production deployment & release tracking from the 'Production Deployment Summary' table of each report. Treated independently from dev deployment and Jira status."
        breadcrumbs={[{ label: 'Production Releases' }]}
        period={d?.period}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => nav(`/reports?type=prod_deployment${queryString ? `&${queryString}` : ''}`)}>
              Production report
            </Button>
            <PrintButton />
          </>
        }
      />
      <GlobalFilterBar showStatus={false} />
      {q.isLoading && <LoadingState />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && pd && (
        <>
          <KpiGrid cols={6}>
            <KpiCard label="Release activities" value={d.kpis.production_releases} icon={<Rocket className="h-4 w-4" />} tone="purple" compact hint="Rows in Production Deployment Summary tables dated inside the period." />
            <KpiCard label="Release tickets" value={d.kpis.production_release_tickets} icon={<Ticket className="h-4 w-4" />} tone="blue" compact hint="Distinct Jira ids referenced by release rows." />
            <KpiCard label="Successfully released" value={pd.released} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" compact onClick={() => toggleValue('prod_deployment', 'released')} active={filters.prod_deployment.includes('released')} />
            <KpiCard label="Release in progress" value={pd.in_progress} icon={<Activity className="h-4 w-4" />} tone="blue" compact onClick={() => toggleValue('prod_deployment', 'in_progress')} />
            <KpiCard label="Release pending" value={pd.pending} icon={<Hourglass className="h-4 w-4" />} tone="orange" compact onClick={() => toggleValue('prod_deployment', 'pending')} active={filters.prod_deployment.includes('pending')} />
            <KpiCard label="Not yet released" value={pd.not_released} tone="orange" compact onClick={() => toggleValue('prod_deployment', 'not_released')} />
            <KpiCard label="Blocked" value={pd.blocked} icon={<AlertOctagon className="h-4 w-4" />} tone="red" compact onClick={() => toggleValue('prod_deployment', 'blocked')} />
            <KpiCard label="Failed" value={pd.failed} icon={<XCircle className="h-4 w-4" />} tone="red" compact onClick={() => toggleValue('prod_deployment', 'failed')} />
            <KpiCard label="Not required" value={pd.not_required} icon={<MinusCircle className="h-4 w-4" />} tone="grey" compact onClick={() => toggleValue('prod_deployment', 'not_required')} />
            <KpiCard label="Unknown / unmapped" value={pd.other} icon={<HelpCircle className="h-4 w-4" />} tone="grey" compact onClick={() => toggleValue('prod_deployment', 'other')} />
            <KpiCard label="Success rate" value={d.kpis.production_success_rate} suffix="%" tone="green" compact />
            <KpiCard label="Work items needing prod" value={d.kpis.prod_required_yes} tone="blue" compact hint="Activity rows with 'Production Deployment Required? = Yes'" />
          </KpiGrid>
          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard title="Production deployment status">
              <DonutChart data={d.distribution} onSelect={(k) => toggleValue('prod_deployment', k)} selected={filters.prod_deployment} centerLabel="releases" />
            </ChartCard>
            <ChartCard title="Production vs non-production work" description="Work items by 'Production Deployment Required?'">
              <DonutChart data={d.prod_required} onSelect={(k) => toggleValue('prod_required', k)} selected={filters.prod_required} centerLabel="activities" />
            </ChartCard>
            <ChartCard title="Production deployment trend" description="Release records per release date.">
              <TrendBarChart data={d.trend} series={PROD_SERIES.map((s) => ({ key: s.key, label: s.label, color: hex(s.color) }))} />
            </ChartCard>
          </div>
          <div className={cn('grid gap-4', FEATURES.applications ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}>
            <ChartCard title="Production release activities by project">
              <StackedBarChart data={d.by_project} series={PROD_SERIES} onSelect={(n) => nav(`/projects/${encodeURIComponent(n)}${qs}`)} />
            </ChartCard>
            <ChartCard title="Production releases by employee">
              <StackedBarChart data={d.by_employee} series={PROD_SERIES} onSelect={(n) => nav(`/employees/${encodeURIComponent(n)}${qs}`)} />
            </ChartCard>
            {FEATURES.applications && (
              <ChartCard title="Application-wise production deployment">
                <StackedBarChart data={d.by_application} series={PROD_SERIES} onSelect={(n) => toggleValue('application', n)} />
              </ChartCard>
            )}
          </div>
          {(pd.blocked + pd.failed > 0) && (
            <ChartCard title="Blocked / failed production releases" description="Release records with Blocked or Failed status by project.">
              <StackedBarChart data={d.by_project.filter((p) => Number(p.blocked) + Number(p.failed) > 0)} series={PROD_SERIES.filter((s) => ['blocked', 'failed'].includes(s.key))} />
            </ChartCard>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Production deployment table ({d.items.length})</CardTitle>
              <CardDescription>In Production, release tickets, deployment status, responsible employee, project, application and release date.</CardDescription>
            </CardHeader>
            <CardContent>
              <ReleasesTable items={d.items} onTicket={setTicket} pageSize={50} />
            </CardContent>
          </Card>
        </>
      )}
      <TicketDialog ticketId={ticket} onClose={() => setTicket(null)} />
    </>
  )
}
