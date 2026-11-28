import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertTriangle, CheckCircle2, Kanban, Link2, Loader2, Plus, Plug, RefreshCw, Search, Ticket, Trash2, Users, XCircle, KeyRound } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/common/DataTable'
import { KeyValueList, Notice, SettingsCard, StatStrip, StatTile } from '@/components/common/Settings'
import { PageHeader } from '@/components/common/PageHeader'
import { ErrorState, LoadingState, EmptyState } from '@/components/common/States'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, Label, NativeSelect } from '@/components/ui/input'
import { Switch } from '@/components/ui/primitives'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { useSession } from '@/hooks/useSession'
import { errorMessage } from '@/services/api'
import { jiraLiveApi, type JiraBoard } from '@/services/jiraApi'
import { DataSourceCard } from '@/components/common/DataSourceCard'
import { cn } from '@/lib/utils'

export default function JiraConnectionsPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const status = useQuery({ queryKey: ['jira', 'status'], queryFn: jiraLiveApi.status })
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [tokenEnv, setTokenEnv] = useState('')
  const [emailEnv, setEmailEnv] = useState('')
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [testResult, setTestResult] = useState<Awaited<ReturnType<typeof jiraLiveApi.testUrl>> | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<JiraBoard | null>(null)
  const [discoverSite, setDiscoverSite] = useState('')
  const useEnvCreds = Boolean(emailEnv && tokenEnv)
  const credsReady = useEnvCreds || Boolean(email.trim() && token.trim())

  const invalidate = () => qc.invalidateQueries({ queryKey: ['jira'] })
  const creds = { email_env: emailEnv || undefined, token_env: tokenEnv || undefined, email: email.trim() || undefined, token: token.trim() || undefined }
  const test = useMutation({ mutationFn: () => jiraLiveApi.testUrl({ url, ...creds }), onSuccess: setTestResult, onError: (e) => toast({ title: 'Test failed', description: errorMessage(e), variant: 'destructive' }) })
  const { refresh: refreshSession } = useSession()
  const add = useMutation({
    mutationFn: () => jiraLiveApi.addBoard({ url, label: label || undefined, ...creds }),
    onSuccess: (b) => { qc.invalidateQueries(); void refreshSession(); setUrl(''); setLabel(''); setEmail(''); setToken(''); setTestResult(null); toast({ title: 'Board added', description: `${b.label} (${b.project_key ?? '?'} | board ${b.board_id}) - saved; it will be loaded automatically from now on`, variant: 'success' }) },
    onError: (e) => toast({ title: 'Could not add board', description: errorMessage(e), variant: 'destructive' }),
  })
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: Parameters<typeof jiraLiveApi.updateBoard>[1] }) => jiraLiveApi.updateBoard(id, body), onSuccess: invalidate, onError: (e) => toast({ title: 'Update failed', description: errorMessage(e), variant: 'destructive' }) })
  const retest = useMutation({ mutationFn: jiraLiveApi.testBoard, onSuccess: (r) => { invalidate(); toast({ title: r.ok ? 'Connection OK' : 'Connection failed', description: r.board.board_name ?? r.board.last_error ?? '', variant: r.ok ? 'success' : 'destructive' }) }, onError: (e) => { invalidate(); toast({ title: 'Connection failed', description: errorMessage(e), variant: 'destructive' }) } })
  const remove = useMutation({ mutationFn: jiraLiveApi.deleteBoard, onSuccess: () => { invalidate(); setConfirmDelete(null); toast({ title: 'Board removed' }) } })
  const sync = useMutation({ mutationFn: ({ force, board_id }: { force?: boolean; board_id?: string }) => jiraLiveApi.sync(force ?? true, board_id), onSuccess: (s) => { qc.invalidateQueries(); toast({ title: 'Jira synced', description: `${s.fetched_issues} issues fetched${s.errors.length ? ` | ${s.errors.length} error(s)` : ''}`, variant: s.errors.length ? 'destructive' : 'success' }) }, onError: (e) => toast({ title: 'Sync failed', description: errorMessage(e), variant: 'destructive' }) })
  const me = useMutation({ mutationFn: (site?: string) => jiraLiveApi.me(site), onSuccess: (m) => toast({ title: 'Credentials OK', description: `${m.display_name} (${m.email ?? 'email hidden'}) on ${m.site}`, variant: 'success' }), onError: (e) => toast({ title: 'Credential check failed', description: errorMessage(e), variant: 'destructive' }) })
  const discover = useQuery({ queryKey: ['jira', 'discover', discoverSite], queryFn: () => jiraLiveApi.discover(discoverSite || undefined), enabled: false })
  const addDiscovered = useMutation({ mutationFn: (u: string) => jiraLiveApi.addBoard({ url: u }), onSuccess: () => { invalidate(); discover.refetch() }, onError: (e) => toast({ title: 'Could not add board', description: errorMessage(e), variant: 'destructive' }) })

  const s = status.data
  const sites = useMemo(() => Array.from(new Set((s?.boards ?? []).map((b) => b.base_url))), [s])
  const reachable = (s?.boards ?? []).filter((b) => b.last_test_ok === true).length
  const issuesLoaded = (s?.boards ?? []).reduce((t, b) => t + (b.last_sync_issues ?? 0), 0) || (s?.fetched_issues ?? 0)
  const lastSync = [...(s?.boards ?? []).map((b) => b.last_sync), s?.last_sync].filter((x): x is string => !!x).sort().pop()
  const failing = (s?.boards ?? []).filter((b) => b.last_test_ok === false).length

  type Disc = NonNullable<typeof discover.data>['items'][number]
  const discoverCols = useMemo<ColumnDef<Disc, unknown>[]>(() => [
    { accessorKey: 'name', header: 'Board', cell: ({ row }) => <span className="font-medium">{row.original.name} <span className="text-xs text-muted-foreground">#{row.original.board_id}</span></span> },
    { accessorKey: 'type', header: 'Type', cell: ({ getValue }) => <Badge variant="outline">{String(getValue())}</Badge> },
    { accessorKey: 'project_key', header: 'Project', cell: ({ row }) => <span><Badge variant="info">{row.original.project_key}</Badge> <span className="ml-1 text-xs text-muted-foreground">{row.original.project_name}</span></span> },
    { accessorKey: 'base_url', header: 'Site', cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{String(getValue()).replace('https://', '')}</span> },
    { id: 'act', header: '', enableSorting: false, meta: { align: 'right' }, cell: ({ row }) => (row.original.configured ? <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> configured</Badge> : <Button size="xs" variant="outline" onClick={() => addDiscovered.mutate(row.original.url)} disabled={addDiscovered.isPending}><Plus /> Add</Button>) },
  ], [addDiscovered])

  return (
    <>
      <PageHeader
        title="Jira Connections"
        description="Connect the dashboards to live Jira boards. Paste a board link - site, project and board id are detected automatically. Credentials are stored encrypted on the server."
        breadcrumbs={[{ label: 'Jira Connections' }]}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => me.mutate(sites[0])} disabled={!s?.configured || me.isPending}><KeyRound /> Check credentials</Button>
            <Button size="sm" onClick={() => sync.mutate({ force: true })} disabled={!s?.configured || !s?.boards.length || sync.isPending}>
              <RefreshCw className={cn(sync.isPending && 'animate-spin')} /> Sync all boards
            </Button>
          </>
        }
      />
      {status.isLoading && <LoadingState />}
      {status.isError && <ErrorState error={status.error} onRetry={() => status.refetch()} />}
      {s && (
        <>
          <StatStrip cols={5}>
            <StatTile icon={KeyRound} label="Credentials" value={s.configured ? 'Ready' : 'Missing'} sub={s.configured ? 'default account set' : 'add below'} tone={s.configured ? 'green' : 'orange'} />
            <StatTile icon={Kanban} label="Boards" value={s.boards.length} sub={`${s.boards.filter((b) => b.enabled).length} enabled`} tone="blue" />
            <StatTile icon={Activity} label="Connection health" value={failing ? `${failing} failing` : `${reachable} reachable`} sub={`${s.boards.length - reachable - failing} untested`} tone={failing ? 'red' : reachable ? 'green' : 'grey'} />
            <StatTile icon={Ticket} label="Issues loaded" value={issuesLoaded} sub={lastSync ? `last sync ${new Date(lastSync).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : 'never synced'} tone="default" />
            <StatTile icon={AlertTriangle} label="Attention" value={s.errors.length + s.uncovered_projects.length} sub={s.uncovered_projects.length ? `no board for ${s.uncovered_projects.join(', ')}` : s.errors.length ? 'see errors below' : 'nothing to fix'} tone={s.errors.length + s.uncovered_projects.length ? 'orange' : 'green'} />
          </StatStrip>
          {s.errors.length > 0 && (
            <Notice tone="warning" icon={AlertTriangle}>
              <span className="flex flex-wrap gap-2">{s.errors.map((e) => <Badge key={e.scope} variant="danger" title={e.error}>{e.scope}: {e.error.slice(0, 90)}</Badge>)}</span>
            </Notice>
          )}
          {s.is_admin && <DataSourceCard compact />}
          {s.is_admin ? <CredentialsCard status={s} /> : s.read_only ? (
            <Notice tone="info" icon={KeyRound}>You can view every configured board and its data. Only the board owner or a superuser can add, change or remove boards.</Notice>
          ) : (
            <RedeemBoardCode />
          )}

          <Tabs defaultValue="boards">
            <TabsList>
              <TabsTrigger value="boards">Boards ({s.boards.length})</TabsTrigger>
              <TabsTrigger value="discover">Discover boards</TabsTrigger>
              {s.is_admin && <TabsTrigger value="users">People mapping</TabsTrigger>}
            </TabsList>

            <TabsContent value="boards" className="space-y-4">
              <SettingsCard icon={Plus} title="Add a board" description="Three quick steps: paste the board link, enter the account that can read it, then test and add. The board is saved and loaded automatically from then on.">
                <div className="space-y-4">
                  <div>
                    <StepLabel n={1} title="Board link" done={!!url} />
                    <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
                      <div>
                        <Label>Board link *</Label>
                        <Input value={url} onChange={(e) => { setUrl(e.target.value); setTestResult(null) }} placeholder="https://<site>.atlassian.net/jira/software/c/projects/KEY/boards/123" className="mt-1" />
                      </div>
                      <div>
                        <Label>Display name (optional)</Label>
                        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Defaults to the Jira board name" className="mt-1" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <StepLabel n={2} title="Account that can read the board" done={credsReady} />
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <Label>Atlassian email *</Label>
                        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="mt-1" autoComplete="off" required />
                      </div>
                      <div>
                        <Label>Jira API token (stored encrypted) *</Label>
                        <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste the API token" className="mt-1" autoComplete="new-password" required />
                      </div>
                    </div>
                    <details className="mt-2 text-xs text-muted-foreground">
                      <summary className="cursor-pointer">Use credentials from environment variables instead</summary>
                      <div className="mt-2 grid gap-3 md:grid-cols-2">
                        <div>
                          <Label>Environment variable holding the email</Label>
                          <Input value={emailEnv} onChange={(e) => setEmailEnv(e.target.value)} placeholder="EDD_JIRA_EMAIL_<SITE>" className="mt-1 h-8" />
                        </div>
                        <div>
                          <Label>Environment variable holding the API token</Label>
                          <Input value={tokenEnv} onChange={(e) => setTokenEnv(e.target.value)} placeholder="EDD_JIRA_TOKEN_<SITE>" className="mt-1 h-8" />
                        </div>
                      </div>
                    </details>
                  </div>
                  <div>
                    <StepLabel n={3} title="Test and add" done={!!testResult?.ok} />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" onClick={() => test.mutate()} disabled={!url || test.isPending || !credsReady}>{test.isPending ? <Loader2 className="animate-spin" /> : <Link2 />} Test link</Button>
                      <Button onClick={() => add.mutate()} disabled={!url || add.isPending || !credsReady}>{add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add board</Button>
                      {testResult && (
                        <span className={cn('flex items-center gap-1 text-sm', testResult.ok ? 'text-green-600' : 'text-red-600')}>
                          {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                          {testResult.ok ? <>Found <b>{testResult.board.board_name}</b> ({testResult.board.board_type}, project {testResult.board.project_key}){testResult.active_sprints?.length ? ` | active sprint: ${testResult.active_sprints.join(', ')}` : ''}</> : testResult.error}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </SettingsCard>

              <SettingsCard icon={Kanban} title={`Configured boards (${s.boards.length})`} description="Tickets are routed to a board by their project key (for example OCS-5777 to OCS). Use the People button to limit a board to specific team members.">
                {s.boards.length === 0 ? (
                  <EmptyState title="No boards configured" description="Add your first board link above or use Discover boards." />
                ) : (
                  <div className="space-y-3">
                    {s.boards.map((b) => (
                      <BoardRow key={b.id} board={b} excelBoardNames={s.excel_board_names} onToggle={(enabled) => update.mutate({ id: b.id, body: { enabled } })} onLabel={(l) => update.mutate({ id: b.id, body: { label: l } })} onAliases={(names) => update.mutate({ id: b.id, body: { excel_board_names: names } })} onTest={() => retest.mutate(b.id)} onSync={() => sync.mutate({ force: true, board_id: b.id })} onDelete={() => setConfirmDelete(b)} busy={retest.isPending || sync.isPending} />
                    ))}
                  </div>
                )}
              </SettingsCard>
            </TabsContent>

            <TabsContent value="discover">
              <SettingsCard icon={Search} title="Boards you can access" description={`Lists boards for the project keys found in your data (${s.excel_projects.join(', ') || 'none yet'}) on the selected site.`}>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label>Site</Label>
                    {sites.length > 0 ? (
                      <NativeSelect className="h-8 w-auto text-xs" value={discoverSite} onChange={(e) => setDiscoverSite(e.target.value)}>
                        <option value="">All configured sites</option>
                        {sites.map((x) => <option key={x} value={x}>{x}</option>)}
                      </NativeSelect>
                    ) : (
                      <Input value={discoverSite} onChange={(e) => setDiscoverSite(e.target.value)} placeholder="https://annalect.atlassian.net" className="h-8 w-80" />
                    )}
                    <Button variant="outline" size="sm" onClick={() => discover.refetch()} disabled={discover.isFetching || !s.configured || (!sites.length && !discoverSite)}>{discover.isFetching ? <Loader2 className="animate-spin" /> : <Search />} Discover</Button>
                  </div>
                  {discover.data?.errors.map((e) => <p key={e.site} className="text-xs text-red-600">{e.site}: {e.error}</p>)}
                  {!discover.data && !discover.isFetching && <EmptyState title="Nothing searched yet" description="Choose a site and click Discover to list the boards your account can see." />}
                  {discover.data && discover.data.items.length === 0 && <EmptyState title="No boards found" description="Your account may not have access, or the project keys differ." />}
                  {discover.data && discover.data.items.length > 0 && <DataTable data={discover.data.items} columns={discoverCols} dense pageSize={15} searchPlaceholder="Search boards" exportName="jira-boards" />}
                </div>
              </SettingsCard>
            </TabsContent>

            <TabsContent value="users">
              <UserMappingCard />
            </TabsContent>
          </Tabs>
        </>
      )}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove board "{confirmDelete?.label}"?</DialogTitle>
            <DialogDescription>Tickets from project {confirmDelete?.project_key} will no longer be compared with Jira until another board covers them.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function lastSyncOf(s: import('@/services/jiraApi').JiraStatus): string {
  const t = [...s.boards.map((b) => b.last_sync), s.last_sync].filter((x): x is string => !!x).sort().pop()
  return t ? new Date(t).toLocaleString() : 'never'
}

function StepLabel({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold', done ? 'bg-green-500 text-white' : 'bg-primary text-primary-foreground')}>{done ? <CheckCircle2 className="h-3 w-3" /> : n}</span>
      <span className="text-sm font-medium">{title}</span>
    </div>
  )
}

function RedeemBoardCode() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { refresh: refreshSession } = useSession()
  const [code, setCode] = useState('')
  const redeem = useMutation({
    mutationFn: () => jiraLiveApi.redeemBoardCode(code.trim()),
    onSuccess: (r) => { qc.invalidateQueries(); void refreshSession(); setCode(''); toast({ title: 'Board linked', description: r.label ?? 'You now see this board\'s data', variant: 'success' }) },
    onError: (e) => toast({ title: 'Could not link board', description: errorMessage(e), variant: 'destructive' }),
  })
  return (
    <Notice tone="info" icon={KeyRound} action={
      <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) redeem.mutate() }}>
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="BOARD-XXXX-XXXX" className="h-9 w-[200px] font-mono uppercase tracking-wider" />
        <Button type="submit" size="sm" className="h-9" disabled={redeem.isPending || !code.trim()}>Link board</Button>
      </form>
    }>
      You see the boards you configured plus any unlocked with a board code. Have a board code from the superuser? Enter it here to see that board's data too.
    </Notice>
  )
}

function CredentialsCard({ status: s }: { status: import('@/services/jiraApi').JiraStatus }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const creds = useQuery({ queryKey: ['jira', 'credentials'], queryFn: jiraLiveApi.credentials })
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [open, setOpen] = useState(false)
  const save = useMutation({
    mutationFn: () => jiraLiveApi.setCredentials(email.trim(), token.trim()),
    onSuccess: () => { qc.invalidateQueries(); setToken(''); setOpen(false); toast({ title: 'Credentials saved', description: 'Token stored encrypted on the server.', variant: 'success' }) },
    onError: (e) => toast({ title: 'Could not save credentials', description: errorMessage(e), variant: 'destructive' }),
  })
  const clear = useMutation({ mutationFn: jiraLiveApi.clearCredentials, onSuccess: () => { qc.invalidateQueries(); toast({ title: 'Credentials removed' }) } })
  const c = creds.data
  return (
    <SettingsCard
      icon={KeyRound}
      tone={s.configured ? 'default' : 'warning'}
      title="Default Jira account"
      description={c?.configured ? <>Used by every board that has no credentials of its own. <b>{c.email}</b> <span className="text-muted-foreground">({c.token_masked}, {c.source === 'ui' ? 'saved in the app, encrypted' : 'from .env'})</span></> : 'No default account yet. Add one here, or give each board its own token when adding it.'}
      action={
        <>
          <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}><KeyRound /> {c?.configured ? 'Change' : 'Add credentials'}</Button>
          {c?.source === 'ui' && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => clear.mutate()} title="Remove saved credentials"><Trash2 /></Button>}
        </>
      }
    >
      {open ? (
        <form className="grid gap-3 rounded-lg border bg-muted/30 p-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <div>
            <Label>Atlassian account email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="mt-1" autoComplete="off" required />
          </div>
          <div>
            <Label>API token</Label>
            <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Create at id.atlassian.com under Security, API tokens" className="mt-1" autoComplete="new-password" required />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={save.isPending || !email || !token}>{save.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Save</Button>
          </div>
          <p className="text-xs text-muted-foreground md:col-span-3">The token is encrypted with a key kept only on this server and is never returned to the browser or written to logs.</p>
        </form>
      ) : (
        <KeyValueList items={[
          { label: 'Status', value: s.configured ? <Badge variant="success" className="gap-1"><Plug className="h-3 w-3" /> connected</Badge> : <Badge variant="warning">not configured</Badge> },
          { label: 'Boards using it', value: `${s.boards.filter((b) => !b.has_custom_credentials).length} of ${s.boards.length}` },
          { label: 'Last sync', value: lastSyncOf(s) },
        ]} />
      )}
    </SettingsCard>
  )
}

function BoardRow({ board: b, excelBoardNames, onToggle, onLabel, onAliases, onTest, onSync, onDelete, busy }: { board: JiraBoard; excelBoardNames: string[]; onToggle: (v: boolean) => void; onLabel: (l: string) => void; onAliases: (n: string[]) => void; onTest: () => void; onSync: () => void; onDelete: () => void; busy: boolean }) {
  const [label, setLabel] = useState(b.label)
  const [showPeople, setShowPeople] = useState(false)
  const qc = useQueryClient()
  const { toast } = useToast()
  const assignees = useQuery({ queryKey: ['jira', 'assignees', b.id], queryFn: () => jiraLiveApi.boardAssignees(b.id), enabled: showPeople })
  const savePeople = useMutation({ mutationFn: (people: string[]) => jiraLiveApi.updateBoard(b.id, { people }), onSuccess: () => { qc.invalidateQueries(); toast({ title: 'People mapping saved', description: 'Dashboards reload with the selected people only.', variant: 'success' }) }, onError: (e) => toast({ title: 'Failed', description: errorMessage(e), variant: 'destructive' }) })
  const [draft, setDraft] = useState<string[] | null>(null)
  const selected = draft ?? b.people
  const togglePerson = (name: string) => setDraft(selected.includes(name) ? selected.filter((x) => x !== name) : [...selected, name])
  return (
    <div className={cn('rounded-lg border', !b.enabled && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-3 border-b bg-muted/30 px-3 py-2">
        <Switch checked={b.enabled} onCheckedChange={onToggle} aria-label="Enabled" />
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', b.last_test_ok === false ? 'bg-red-500/10 text-red-600' : b.last_test_ok ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground')}><Kanban className="h-4 w-4" /></span>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => label !== b.label && onLabel(label)} className="h-8 w-56 font-medium" title="Display name (click to edit)" />
        <Badge variant="info">{b.project_key ?? '?'}</Badge>
        <span className="text-xs text-muted-foreground">board #{b.board_id} | {b.board_type ?? '?'} | {b.base_url.replace('https://', '')}</span>
        {b.has_custom_credentials && <Badge variant="secondary" title={b.credential_source === 'ui' ? `Own credentials (${b.email ?? 'email n/a'}), token encrypted` : `Uses ${b.token_env}`}>own credentials{b.email ? `: ${b.email}` : ''}</Badge>}
        {b.people.length > 0 && <Badge variant="info" title={b.people.join(', ')}><Users className="mr-1 h-3 w-3" /> {b.people.length} people</Badge>}
        {b.owner_name && <Badge variant="outline" title="Configured by">owner: {b.owner_name}</Badge>}
        {b.board_code && <Badge variant="secondary" className="font-mono" title="Board code (share with other delivery managers)">{b.board_code}</Badge>}
        {b.last_test_ok === true && <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> reachable</Badge>}
        {b.last_test_ok === false && <Badge variant="danger" className="gap-1" title={b.last_error ?? ''}><AlertTriangle className="h-3 w-3" /> {b.last_error?.slice(0, 60) ?? 'error'}</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">{b.last_sync ? `synced ${new Date(b.last_sync).toLocaleString()} | ${b.last_sync_issues} issues` : 'not synced yet'}</span>
        <Button size="xs" variant="outline" onClick={onTest} disabled={busy}><Link2 /> Test</Button>
        <Button size="xs" variant="outline" onClick={onSync} disabled={busy || !b.enabled}><RefreshCw /> Sync</Button>
        <Button size="xs" variant={showPeople ? 'default' : 'outline'} onClick={() => setShowPeople((v) => !v)}><Users /> People</Button>
        <Button size="xs" variant="ghost" className="text-red-600" onClick={onDelete}><Trash2 /></Button>
      </div>
      {showPeople && (
        <div className="m-3 rounded-md border bg-muted/30 p-3 text-xs">
          <p className="mb-2 text-muted-foreground">
            Select the people whose work should be visible from this board. <b>Nobody selected = everyone on the board.</b>
            {assignees.data?.error && <span className="ml-2 text-red-600">{assignees.data.error}</span>}
          </p>
          {assignees.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          {assignees.data && (
            <div className="flex flex-wrap gap-1.5">
              {Array.from(new Set([...assignees.data.assignees, ...selected])).sort().map((name) => {
                const on = selected.includes(name)
                return (
                  <button key={name} onClick={() => togglePerson(name)} className={cn('rounded-full border px-2.5 py-1 transition', on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:border-primary/50')}>
                    {name}
                  </button>
                )
              })}
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <Button size="xs" onClick={() => savePeople.mutate(selected)} disabled={savePeople.isPending || draft === null}>{savePeople.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Save ({selected.length} selected)</Button>
            <Button size="xs" variant="ghost" onClick={() => setDraft([])} disabled={selected.length === 0}>Clear (show everyone)</Button>
            <Button size="xs" variant="ghost" onClick={() => setDraft(assignees.data?.assignees ?? [])}>Select all</Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
        <span className="text-muted-foreground">Source "Jira Board" names mapped to this board:</span>
        {b.excel_board_names.map((n) => (
          <Badge key={n} variant="secondary" className="gap-1 pr-1">{n}<button onClick={() => onAliases(b.excel_board_names.filter((x) => x !== n))} className="rounded-sm p-0.5 hover:bg-background"><XCircle className="h-3 w-3" /></button></Badge>
        ))}
        <NativeSelect className="h-7 w-auto text-xs" value="" onChange={(e) => e.target.value && onAliases([...b.excel_board_names, e.target.value])}>
          <option value="">+ add from Excel</option>
          {excelBoardNames.filter((n) => !b.excel_board_names.includes(n)).map((n) => <option key={n} value={n}>{n}</option>)}
        </NativeSelect>
      </div>
    </div>
  )
}

function UserMappingCard() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const q = useQuery({ queryKey: ['jira', 'users'], queryFn: jiraLiveApi.users })
  const set = useMutation({ mutationFn: jiraLiveApi.setUserMap, onSuccess: () => { qc.invalidateQueries({ queryKey: ['jira'] }); toast({ title: 'Mapping saved' }) }, onError: (e) => toast({ title: 'Failed', description: errorMessage(e), variant: 'destructive' }) })
  type Row = NonNullable<typeof q.data>['mapping'][number]
  const cols = useMemo<ColumnDef<Row, unknown>[]>(() => [
    { accessorKey: 'employee', header: 'Employee (source)', cell: ({ getValue }) => <span className="font-medium">{String(getValue())}</span> },
    { accessorKey: 'display_name', header: 'Jira user', cell: ({ row }) => (row.original.display_name ? <span>{row.original.display_name} <span className="text-xs text-muted-foreground">{row.original.email}</span></span> : <span className="italic text-muted-foreground">no match</span>) },
    { accessorKey: 'match', header: 'Match', cell: ({ row }) => { const m = row.original; return <Badge variant={m.match === 'manual' ? 'info' : m.match === 'exact' ? 'success' : m.match === 'fuzzy' ? 'warning' : 'danger'}>{m.match}{m.match === 'fuzzy' ? ` ${Math.round(m.score * 100)}%` : ''}</Badge> } },
    {
      id: 'override', header: 'Override', enableSorting: false,
      cell: ({ row }) => {
        const m = row.original
        return (
          <NativeSelect className="h-8 w-64 text-xs" value={m.match === 'manual' ? (m.account_id ?? '') : ''} onChange={(e) => {
            const u = q.data!.jira_users.find((x) => x.account_id === e.target.value)
            set.mutate(u ? { employee: m.employee, account_id: u.account_id, display_name: u.display_name, email: u.email } : { employee: m.employee, account_id: null, display_name: null, email: null })
          }}>
            <option value="">{m.match === 'manual' ? '- clear override -' : 'Keep automatic match'}</option>
            {q.data!.jira_users.map((u) => <option key={u.account_id} value={u.account_id}>{u.display_name}{u.email ? ` (${u.email})` : ''}</option>)}
          </NativeSelect>
        )
      },
    },
  ], [q.data, set])
  const counts = useMemo(() => { const c = { exact: 0, fuzzy: 0, manual: 0, none: 0 } as Record<string, number>; for (const m of q.data?.mapping ?? []) c[m.match] = (c[m.match] ?? 0) + 1; return c }, [q.data])
  return (
    <SettingsCard icon={Users} title="Employee and Jira user mapping" description="People are matched to Jira accounts by display name or email. Override a row where the match is wrong or missing; this drives assignee checks and missing-from-source detection." action={q.data && <span className="flex gap-1 text-xs"><Badge variant="success">{counts.exact} exact</Badge><Badge variant="warning">{counts.fuzzy} fuzzy</Badge><Badge variant="info">{counts.manual} manual</Badge><Badge variant="danger">{counts.none ?? 0} unmatched</Badge></span>}>
      {q.isLoading && <LoadingState rows={1} />}
      {q.isError && <ErrorState error={q.error} />}
      {q.data && <DataTable data={q.data.mapping} columns={cols} dense pageSize={15} searchPlaceholder="Search people" exportName="jira-user-mapping" columnFilters={[{ id: 'match', label: 'Match', options: ['exact', 'fuzzy', 'manual', 'none'].map((v) => ({ value: v, label: v })) }]} />}
    </SettingsCard>
  )
}
