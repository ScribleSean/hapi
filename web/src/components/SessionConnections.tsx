import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Machine, SessionSummary } from '@/types/api'
import { getFlavorLabel } from '@hapi/protocol'
import { getSessionTitle } from '@/lib/sessionTitle'
import { reasoningLabel } from '@/lib/sessionReasoning'
import { latestReportedAuthIssue } from '@/lib/sessionConnectionHealth'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'

export function SessionConnections(props: {
    api: ApiClient | null
    sessions: SessionSummary[]
    machines: Record<string, Machine>
    machineLabels: Record<string, string>
    onSelect: (id: string) => void
}) {
    const [open, setOpen] = useState(false)
    const [filter, setFilter] = useState('')
    const machineIds = [...new Set([
        ...Object.keys(props.machines),
        ...props.sessions.flatMap(session => session.metadata?.machineId ? [session.metadata.machineId] : []),
    ])].sort()
    const availability = useQuery({
        queryKey: ['connection-agent-availability', machineIds],
        enabled: open && Boolean(props.api),
        staleTime: 30_000,
        retry: false,
        queryFn: async () => {
            const entries = []
            for (const id of machineIds) {
                if (!props.machines[id]?.active) { entries.push({ id, agents: [], error: 'Runner offline or unknown' }); continue }
                try { entries.push({ id, ...(await props.api!.getMachineAgentAvailability(id)), error: null }) }
                catch { entries.push({ id, agents: [], error: 'Could not check installed agents' }) }
            }
            return entries
        },
    })
    const activeIds = props.sessions.filter(session => session.active).map(session => session.id).sort()
    const reportedIssues = useQuery({
        queryKey: ['connection-reported-auth-issues', activeIds],
        enabled: open && Boolean(props.api), staleTime: 30_000, retry: false,
        queryFn: async () => {
            const issues: Record<string, string | null> = {}
            for (let start = 0; start < activeIds.length; start += 4) {
                await Promise.all(activeIds.slice(start, start + 4).map(async id => {
                    try { issues[id] = latestReportedAuthIssue((await props.api!.getMessages(id, { limit: 12 })).messages) }
                    catch { issues[id] = 'Recent reply status unavailable.' }
                }))
            }
            return issues
        },
    })
    return <>
        <button type="button" className="rounded-md px-3 py-1.5 text-xs text-[var(--app-link)] hover:bg-[var(--app-secondary-bg)]" onClick={() => setOpen(true)}>Models &amp; connections</button>
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="max-h-[85dvh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Models &amp; connections</DialogTitle>
                    <DialogDescription>Runner connectivity and installed agents are shown separately from provider sign-in. An online session does not verify login, remaining allowance, or a successful model reply.</DialogDescription>
                </DialogHeader>
                <div className="mt-3 flex items-center justify-between text-xs">
                    <span>{props.sessions.filter(session => session.active).length} connected · {props.sessions.filter(session => !session.active).length} offline</span>
                    <button type="button" className="text-[var(--app-link)]" disabled={availability.isFetching || reportedIssues.isFetching} onClick={() => { void availability.refetch(); void reportedIssues.refetch() }}>Refresh connections</button>
                </div>
                <div className="my-3 space-y-2">
                    {machineIds.map(id => {
                        const machine = props.machines[id]
                        const entry = availability.data?.find(entry => entry.id === id)
                        return <div key={id} className="rounded border border-[var(--app-divider)] p-2 text-xs">
                            <p className="font-medium">{props.machineLabels[id] ?? machine?.metadata?.host ?? id.slice(0, 8)} · {machine?.active ? 'Runner online' : 'Runner offline or unknown'}</p>
                            <p className="text-[var(--app-hint)]">{entry?.error ?? (entry ? `Installed: ${entry.agents.filter(agent => agent.available).map(agent => getFlavorLabel(agent.agent)).join(', ') || 'None detected'}` : 'Checking installed agents…')}</p>
                            <p className="text-[var(--app-hint)]">Provider sign-in: not verified by this check</p>
                        </div>
                    })}
                </div>
                <input aria-label="Filter models and connections" placeholder="Find a bot, model, or harness" value={filter} onChange={event => setFilter(event.target.value)} className="mb-2 w-full rounded border border-[var(--app-divider)] bg-[var(--app-bg)] p-2 text-sm" />
                <ul className="max-h-[40dvh] space-y-2 overflow-y-auto">
                    {props.sessions.filter(session => [getSessionTitle(session), session.model, session.metadata?.flavor].join(' ').toLowerCase().includes(filter.toLowerCase())).map(session => <li key={session.id}>
                        <button type="button" className="w-full rounded border border-[var(--app-divider)] p-2 text-left text-sm hover:bg-[var(--app-secondary-bg)]" onClick={() => { setOpen(false); props.onSelect(session.id) }}>
                            <p className="font-medium break-words">{getSessionTitle(session)}</p>
                            <p className="text-xs break-words">{getFlavorLabel(session.metadata?.flavor ?? 'claude')} · {session.model ?? 'Default model'} · {reasoningLabel(['codex', 'opencode'].includes(session.metadata?.flavor ?? '') ? session.modelReasoningEffort ?? null : session.effort)}</p>
                            <p className="text-xs text-[var(--app-hint)]">{session.active ? session.thinking ? 'Connected · processing' : 'Connected · idle' : 'Offline'} · {props.machineLabels[session.metadata?.machineId ?? ''] ?? 'Host not named'}</p>
                            {reportedIssues.data?.[session.id] ? <p className="mt-1 text-xs text-[var(--app-badge-warning-text)]">{reportedIssues.data[session.id]}</p> : null}
                        </button>
                    </li>)}
                </ul>
            </DialogContent>
        </Dialog>
    </>
}
