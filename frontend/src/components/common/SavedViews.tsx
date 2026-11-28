import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, BookmarkPlus, Check, Globe, Link2, Lock, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { useFilters } from '@/hooks/useFilters'
import { useSession } from '@/hooks/useSession'
import { errorMessage, viewsApi, type SavedView } from '@/services/api'
import { cn } from '@/lib/utils'

/** Save the current page + filters as a named view; reopen or share it (shared views are visible to every viewer, data stays role-scoped). */
export function SavedViews() {
  const nav = useNavigate()
  const loc = useLocation()
  const qc = useQueryClient()
  const { toast } = useToast()
  const confirm = useConfirm()
  const { user } = useSession()
  const { queryString, activeChips } = useFilters()
  const q = useQuery({ queryKey: ['views'], queryFn: viewsApi.list, staleTime: 60_000 })
  const [saveOpen, setSaveOpen] = useState(false)
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['views'] })
  const onErr = (e: unknown) => toast({ title: 'Could not save view', description: errorMessage(e), variant: 'destructive' })

  const create = useMutation({ mutationFn: viewsApi.create, onSuccess: () => { refresh(); setSaveOpen(false); setName(''); toast({ title: 'View saved', variant: 'success' }) }, onError: onErr })
  const toggleShare = useMutation({ mutationFn: (v: SavedView) => viewsApi.update(v.id, { shared: !v.shared }), onSuccess: refresh, onError: onErr })
  const remove = useMutation({ mutationFn: viewsApi.remove, onSuccess: refresh, onError: onErr })

  const copyLink = async (v: SavedView) => {
    try {
      await navigator.clipboard.writeText(window.location.origin + v.url)
      setCopied(v.id)
      setTimeout(() => setCopied(null), 1500)
    } catch { /* clipboard blocked */ }
  }

  const mine = (q.data ?? []).filter((v) => v.mine)
  const others = (q.data ?? []).filter((v) => !v.mine)
  const currentUrl = loc.pathname + (queryString ? `?${queryString}` : '')
  const isCurrent = (v: SavedView) => v.url === currentUrl
  const canShare = user?.role !== 'guest'

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5" aria-label="Saved views"><Bookmark className="h-4 w-4" /> Views{q.data?.length ? <span className="rounded-full bg-primary/10 px-1.5 text-[10px] text-primary">{q.data.length}</span> : null}</Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-2">
          <Button size="sm" className="mb-2 w-full justify-start" variant="secondary" onClick={() => { setName(''); setShared(false); setSaveOpen(true) }}>
            <BookmarkPlus /> Save current view{activeChips.length ? ` (${activeChips.length} filter${activeChips.length === 1 ? '' : 's'})` : ''}
          </Button>
          {q.isLoading && <p className="px-2 py-1 text-xs text-muted-foreground">Loading...</p>}
          {q.data && q.data.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">No saved views yet. Set the filters you want, then save them here to reopen or share.</p>}
          {mine.length > 0 && <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">My views</p>}
          {mine.map((v) => <ViewRow key={v.id} v={v} current={isCurrent(v)} copied={copied === v.id} onOpen={() => nav(v.url)} onCopy={() => copyLink(v)} onShare={canShare ? () => toggleShare.mutate(v) : undefined}
            onDelete={async () => { if (await confirm({ title: `Delete view "${v.name}"?`, description: v.shared ? 'Others who use this shared view will lose it.' : undefined, confirmLabel: 'Delete', destructive: true })) remove.mutate(v.id) }} />)}
          {others.length > 0 && <p className="px-2 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Shared with me</p>}
          {others.map((v) => <ViewRow key={v.id} v={v} current={isCurrent(v)} copied={copied === v.id} onOpen={() => nav(v.url)} onCopy={() => copyLink(v)} />)}
        </PopoverContent>
      </Popover>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>
            <DialogDescription>{currentUrl}</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate({ name: name.trim(), path: loc.pathname, query: queryString, shared }) }}>
            <div><Label htmlFor="view-name">Name</Label><Input id="view-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Blocked tickets - OCS - last 30 days" required autoFocus className="mt-1" /></div>
            {canShare && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with every signed-in user <span className="text-xs text-muted-foreground">(they still only see data they are allowed to see)</span></label>}
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setSaveOpen(false)}>Cancel</Button><Button type="submit" disabled={create.isPending || !name.trim()}><Bookmark /> Save</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ViewRow({ v, current, copied, onOpen, onCopy, onShare, onDelete }: { v: SavedView; current: boolean; copied: boolean; onOpen: () => void; onCopy: () => void; onShare?: () => void; onDelete?: () => void }) {
  return (
    <div className={cn('group flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-muted', current && 'bg-primary/5')}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1 text-left text-sm" onClick={onOpen} title={v.url}>
        {v.shared ? <Globe className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-label="Shared" /> : <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Private" />}
        <span className="truncate">{v.name}</span>
        {!v.mine && v.owner && <span className="truncate text-[10px] text-muted-foreground">by {v.owner.name}</span>}
      </button>
      <button type="button" className="rounded p-1 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100 focus:opacity-100" title="Copy link" aria-label="Copy link" onClick={onCopy}>{copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Link2 className="h-3.5 w-3.5" />}</button>
      {onShare && <button type="button" className="rounded p-1 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100 focus:opacity-100" title={v.shared ? 'Make private' : 'Share with everyone'} aria-label={v.shared ? 'Make private' : 'Share'} onClick={onShare}>{v.shared ? <Lock className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}</button>}
      {onDelete && <button type="button" className="rounded p-1 text-muted-foreground opacity-0 hover:text-red-600 group-hover:opacity-100 focus:opacity-100" title="Delete" aria-label="Delete view" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></button>}
    </div>
  )
}
