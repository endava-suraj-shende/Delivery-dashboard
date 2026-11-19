import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Link2, Loader2, Plus, Plug, RefreshCw, Search, Trash2, Users, XCircle, KeyRound } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { ErrorState, LoadingState, EmptyState } from '@/components/common/States'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, Label, NativeSelect } from '@/components/ui/input'
import { Switch } from '@/components/ui/primitives'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
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
  const add = useMutation({
    mutationFn: () => jiraLiveApi.addBoard({ url, label: label || undefined, ...creds }),
    onSuccess: (b) => { qc.invalidateQueries(); setUrl(''); setLabel(''); setEmail(''); setToken(''); setTestResult(null); toast({ title: 'Board added', description: `${b.label} (${b.project_key ?? '?'} · board ${b.board_id}) — saved; it will be loaded automatically from now on`, variant: 'success' }) },
    onError: (e) => toast({ title: 'Could not add board', description: errorMessage(e), variant: 'destructive' }),
  })
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: Parameters<typeof jiraLiveApi.updateBoard>[1] }) => jiraLiveApi.updateBoard(id, body), onSuccess: invalidate, onError: (e) => toast({ title: 'Update failed', description: errorMessage(e), variant: 'destructive' }) })
  const retest = useMutation({ mutationFn: jiraLiveApi.testBoard, onSuccess: (r) => { invalidate(); toast({ title: r.ok ? 'Connection OK' : 'Connection failed', description: r.board.board_name ?? r.board.last_error ?? '', variant: r.ok ? 'success' : 'destructive' }) }, onError: (e) => { invalidate(); toast({ title: 'Connection failed', description: errorMessage(e), variant: 'destructive' }) } })
  const remove = useMutation({ mutationFn: jiraLiveApi.deleteBoard, onSuccess: () => { invalidate(); setConfirmDelete(null); toast({ title: 'Board removed' }) } })
  const sync = useMutation({ mutationFn: ({ force, board_id }: { force?: boolean; board_id?: string }) => jiraLiveApi.sync(force ?? true, board_id), onSuccess: (s) => { qc.invalidateQueries(); toast({ title: 'Jira synced', description: `${s.fetched_issues} issues fetched${s.errors.length ? ` · ${s.errors.length} error(s)` : ''}`, variant: s.errors.length ? 'destructive' : 'success' }) }, onError: (e) => toast({ title: 'Sync failed', description: errorMessage(e), variant: 'destructive' }) })
  const me = useMutation({ mutationFn: (site?: string) => jiraLiveApi.me(site), onSuccess: (m) => toast({ title: 'Credentials OK', description: `${m.display_name} (${m.email ?? 'email hidden'}) on ${m.site}`, variant: 'success' }), onError: (e) => toast({ title: 'Credential check failed', description: errorMessage(e), variant: 'destructive' }) })
  const discover = useQuery({ queryKey: ['jira', 'discover', discoverSite], queryFn: () => jiraLiveApi.discover(discoverSite || undefined), enabled: false })
  const addDiscovered = useMutation({ mutationFn: (u: string) => jiraLiveApi.addBoard({ url: u }), onSuccess: () => { invalidate(); discover.refetch() }, onError: (e) => toast({ title: 'Could not add board', description: errorMessage(e), variant: 'destructive' }) })

  const s = status.data
  const sites = useMemo(() => Array.from(new Set((s?.boards ?? []).map((b) => b.base_url))), [s])

  return (
    <>
      <PageHeader
        title="Jira Connections"
        description="Connect the dashboards to live Jira. Paste board links — site, project and board id are detected automatically. Enter the Atlassian email and API token here (stored encrypted) or keep them in .env."
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
          <DataSourceCard />
          <CredentialsCard status={s} />

          <Tabs defaultValue="boards">
            <TabsList>
              <TabsTrigger value="boards">Boards ({s.boards.length})</TabsTrigger>
              <TabsTrigger value="discover">Discover boards</TabsTrigger>
              <TabsTrigger value="users">People mapping</TabsTrigger>
            </TabsList>

            <TabsContent value="boards" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4" /> Add a board</CardTitle>
                  <CardDescription>Paste the board link from your browser, e.g. https://annalect.atlassian.net/jira/software/c/projects/OCS/boards/921. Test first, then add.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
                    <div>
                      <Label>Board link *</Label>
                      <Input value={url} onChange={(e) => { setUrl(e.target.value); setTestResult(null) }} placeholder="https://<site>.atlassian.net/jira/software/c/projects/KEY/boards/123" className="mt-1" />
                    </div>
                    <div>
                      <Label>Label (optional)</Label>
                      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Defaults to the Jira board name" className="mt-1" />
                    </div>
                  </div>
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
                  <p className="text-xs text-muted-foreground">
                    The board and its credentials are saved (token encrypted) and loaded automatically on every start — you only enter them once per board.
                  </p>
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Use credentials from environment variables instead</summary>
                    <div className="mt-2 grid gap-3 md:grid-cols-2">
                      <div>
                        <Label>Env var holding the email</Label>
                        <Input value={emailEnv} onChange={(e) => setEmailEnv(e.target.value)} placeholder="EDD_JIRA_EMAIL_FLYWHEEL" className="mt-1 h-8" />
                      </div>
                      <div>
                        <Label>Env var holding the API token</Label>
                        <Input value={tokenEnv} onChange={(e) => setTokenEnv(e.target.value)} placeholder="EDD_JIRA_TOKEN_FLYWHEEL" className="mt-1 h-8" />
                      </div>
                    </div>
                  </details>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" onClick={() => test.mutate()} disabled={!url || test.isPending || !credsReady}>{test.isPending ? <Loader2 className="animate-spin" /> : <Link2 />} Test link</Button>
                    <Button onClick={() => add.mutate()} disabled={!url || add.isPending || !credsReady}>{add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add board</Button>
                    {testResult && (
                      <span className={cn('flex items-center gap-1 text-sm', testResult.ok ? 'text-green-600' : 'text-red-600')}>
                        {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                        {testResult.ok ? <>Found <b>{testResult.board.board_name}</b> ({testResult.board.board_type}, project {testResult.board.project_key}){testResult.active_sprints?.length ? ` · active sprint: ${testResult.active_sprints.join(', ')}` : ''}</> : testResult.error}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Configured boards</CardTitle>
                  <CardDescription>Tickets are routed to a board by their project key (e.g. OCS-5777 → OCS). Optionally list the exact "Jira Board:" names used in the Excel sheets so unusual keys can still be matched.</CardDescription>
                </CardHeader>
                <CardContent>
                  {s.boards.length === 0 ? (
                    <EmptyState title="No boards configured" description="Add your first board link above or use Discover boards." />
                  ) : (
                    <div className="space-y-3">
                      {s.boards.map((b) => (
                        <BoardRow key={b.id} board={b} excelBoardNames={s.excel_board_names} onToggle={(enabled) => update.mutate({ id: b.id, body: { enabled } })} onLabel={(l) => update.mutate({ id: b.id, body: { label: l } })} onAliases={(names) => update.mutate({ id: b.id, body: { excel_board_names: names } })} onTest={() => retest.mutate(b.id)} onSync={() => sync.mutate({ force: true, board_id: b.id })} onDelete={() => setConfirmDelete(b)} busy={retest.isPending || sync.isPending} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="discover">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Search className="h-4 w-4" /> Boards you can access</CardTitle>
                  <CardDescription>Lists boards for the project keys found in your Excel files ({s.excel_projects.join(', ') || 'none yet'}) on the selected site.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label>Site</Label>
                    {sites.length > 0 ? (
                      <NativeSelect className="w-auto" value={discoverSite} onChange={(e) => setDiscoverSite(e.target.value)}>
                        <option value="">All configured sites</option>
                        {sites.map((x) => <option key={x} value={x}>{x}</option>)}
                      </NativeSelect>
                    ) : (
                      <Input value={discoverSite} onChange={(e) => setDiscoverSite(e.target.value)} placeholder="https://annalect.atlassian.net" className="w-80" />
                    )}
                    <Button variant="outline" size="sm" onClick={() => discover.refetch()} disabled={discover.isFetching || !s.configured || (!sites.length && !discoverSite)}>{discover.isFetching ? <Loader2 className="animate-spin" /> : <Search />} Discover</Button>
                  </div>
                  {discover.data?.errors.map((e) => <p key={e.site} className="text-xs text-red-600">{e.site}: {e.error}</p>)}
                  {discover.data && discover.data.items.length === 0 && <EmptyState title="No boards found" description="Your account may not have access, or the project keys differ." />}
                  {discover.data && discover.data.items.length > 0 && (
                    <table className="w-full text-sm">
                      <thead className="bg-muted/60 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Board</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Project</th><th className="px-3 py-2 text-left">Site</th><th className="px-3 py-2" /></tr></thead>
                      <tbody>
                        {discover.data.items.map((b) => (
                          <tr key={`${b.base_url}-${b.board_id}`} className="border-b">
                            <td className="px-3 py-1.5 font-medium">{b.name} <span className="text-xs text-muted-foreground">#{b.board_id}</span></td>
                            <td className="px-3 py-1.5">{b.type}</td>
                            <td className="px-3 py-1.5">{b.project_key} <span className="text-xs text-muted-foreground">{b.project_name}</span></td>
                            <td className="px-3 py-1.5 text-xs text-muted-foreground">{b.base_url}</td>
                            <td className="px-3 py-1.5 text-right">{b.configured ? <Badge variant="success">configured</Badge> : <Button size="xs" variant="outline" onClick={() => addDiscovered.mutate(b.url)} disabled={addDiscovered.isPending}><Plus /> Add</Button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
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
    <Card className={cn(!s.configured && 'border-orange-300')}>
      <CardContent className="space-y-3 p-4 text-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="flex items-center gap-2">
            <Plug className={cn('h-4 w-4', s.configured ? 'text-green-600' : 'text-orange-500')} />
            {c?.configured ? <>Default credentials: <b>{c.email}</b> <span className="text-muted-foreground">({c.token_masked}, {c.source === 'ui' ? 'saved in app, encrypted' : 'from .env'})</span></> : <>No default credentials — add them below or give each board its own token.</>}
          </span>
          <span className="text-muted-foreground">{s.boards.length} board(s) · {s.fetched_issues} issues fetched · last sync {s.last_sync ? new Date(s.last_sync).toLocaleString() : 'never'}</span>
          {s.uncovered_projects.length > 0 && <Badge variant="warning" title="Jira project keys found in the data that no configured board covers">No board for: {s.uncovered_projects.join(', ')}</Badge>}
          {s.errors.map((e) => <Badge key={e.scope} variant="danger" title={e.error}>{e.scope}: {e.error.slice(0, 80)}</Badge>)}
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}><KeyRound /> {c?.configured ? 'Change credentials' : 'Add credentials'}</Button>
            {c?.source === 'ui' && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => clear.mutate()}><Trash2 /></Button>}
          </div>
        </div>
        {open && (
          <form className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
            <div>
              <Label>Atlassian account email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="mt-1" autoComplete="off" required />
            </div>
            <div>
              <Label>API token</Label>
              <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Create at id.atlassian.com → Security → API tokens" className="mt-1" autoComplete="new-password" required />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={save.isPending || !email || !token}>{save.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Save</Button>
            </div>
            <p className="text-xs text-muted-foreground md:col-span-3">The token is encrypted with a key kept only on this server (backend/config/.secret.key) and is never returned to the browser or written to logs.</p>
          </form>
        )}
      </CardContent>
    </Card>
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
    <div className={cn('rounded-md border p-3', !b.enabled && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-3">
        <Switch checked={b.enabled} onCheckedChange={onToggle} aria-label="Enabled" />
        <Input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => label !== b.label && onLabel(label)} className="h-8 w-56 font-medium" />
        <Badge variant="info">{b.project_key ?? '?'}</Badge>
        <span className="text-xs text-muted-foreground">board #{b.board_id} · {b.board_type ?? '?'} · {b.base_url.replace('https://', '')}</span>
        {b.has_custom_credentials && <Badge variant="secondary" title={b.credential_source === 'ui' ? `Own credentials (${b.email ?? 'email n/a'}), token encrypted` : `Uses ${b.token_env}`}>own credentials{b.email ? `: ${b.email}` : ''}</Badge>}
        {b.people.length > 0 && <Badge variant="info" title={b.people.join(', ')}><Users className="mr-1 h-3 w-3" /> {b.people.length} people</Badge>}
        {b.last_test_ok === true && <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> reachable</Badge>}
        {b.last_test_ok === false && <Badge variant="danger" className="gap-1" title={b.last_error ?? ''}><AlertTriangle className="h-3 w-3" /> {b.last_error?.slice(0, 60) ?? 'error'}</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">{b.last_sync ? `synced ${new Date(b.last_sync).toLocaleString()} · ${b.last_sync_issues} issues` : 'not synced yet'}</span>
        <Button size="xs" variant="outline" onClick={onTest} disabled={busy}><Link2 /> Test</Button>
        <Button size="xs" variant="outline" onClick={onSync} disabled={busy || !b.enabled}><RefreshCw /> Sync</Button>
        <Button size="xs" variant={showPeople ? 'default' : 'outline'} onClick={() => setShowPeople((v) => !v)}><Users /> People</Button>
        <Button size="xs" variant="ghost" className="text-red-600" onClick={onDelete}><Trash2 /></Button>
      </div>
      {showPeople && (
        <div className="mt-3 rounded-md border bg-muted/30 p-3 text-xs">
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
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Excel "Jira Board" names for this board:</span>
        {b.excel_board_names.map((n) => (
          <Badge key={n} variant="secondary" className="gap-1 pr-1">{n}<button onClick={() => onAliases(b.excel_board_names.filter((x) => x !== n))} className="rounded-sm p-0.5 hover:bg-background"><XCircle className="h-3 w-3" /></button></Badge>
        ))}
        <NativeSelect className="h-7 w-auto text-xs" value="" onChange={(e) => e.target.value && onAliases([...b.excel_board_names, e.target.value])}>
          <option value="">+ add from Excel…</option>
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
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" /> Excel employee ↔ Jira user</CardTitle>
        <CardDescription>Auto-matched by display name / email. Override where the match is wrong or missing; this drives assignee checks and "missing from Excel" detection.</CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading && <LoadingState rows={1} />}
        {q.isError && <ErrorState error={q.error} />}
        {q.data && (
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Excel employee</th><th className="px-3 py-2 text-left">Jira user</th><th className="px-3 py-2 text-left">Match</th><th className="px-3 py-2 text-left">Override</th></tr></thead>
            <tbody>
              {q.data.mapping.map((m) => (
                <tr key={m.employee} className="border-b">
                  <td className="px-3 py-1.5 font-medium">{m.employee}</td>
                  <td className="px-3 py-1.5">{m.display_name ? <>{m.display_name} <span className="text-xs text-muted-foreground">{m.email}</span></> : <span className="italic text-muted-foreground">no match</span>}</td>
                  <td className="px-3 py-1.5"><Badge variant={m.match === 'manual' ? 'info' : m.match === 'exact' ? 'success' : m.match === 'fuzzy' ? 'warning' : 'danger'}>{m.match}{m.match === 'fuzzy' ? ` ${Math.round(m.score * 100)}%` : ''}</Badge></td>
                  <td className="px-3 py-1.5">
                    <NativeSelect className="h-8 w-64 text-xs" value={m.match === 'manual' ? (m.account_id ?? '') : ''} onChange={(e) => {
                      const u = q.data!.jira_users.find((x) => x.account_id === e.target.value)
                      set.mutate(u ? { employee: m.employee, account_id: u.account_id, display_name: u.display_name, email: u.email } : { employee: m.employee, account_id: null, display_name: null, email: null })
                    }}>
                      <option value="">{m.match === 'manual' ? '— clear override —' : 'Keep automatic'}</option>
                      {q.data!.jira_users.map((u) => <option key={u.account_id} value={u.account_id}>{u.display_name}{u.email ? ` (${u.email})` : ''}</option>)}
                    </NativeSelect>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
