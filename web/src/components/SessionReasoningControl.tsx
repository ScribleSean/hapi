import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { SessionSummary } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { getSessionTitle } from '@/lib/sessionTitle'
import { applyReasoningTargets, loadReasoningTarget, reasoningLabel, type ReasoningTarget, type ReasoningResult } from '@/lib/sessionReasoning'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const DEFAULT = '__default__'
const effortOrder = ['__default__', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

export function SessionReasoningControl(props: { api: ApiClient | null; sessions: SessionSummary[]; bulk?: boolean }) {
    const [snapshot, setSnapshot] = useState<SessionSummary[] | null>(null)
    const single = !props.bulk
    if (!props.api || !props.sessions.length) return null
    const title = single ? `Reasoning for ${getSessionTitle(props.sessions[0])}` : 'Change reasoning for all sessions'
    return <>
        <button type="button" aria-label={title} title={title}
            className={single
                ? 'absolute right-1 top-1 z-10 flex h-8 w-8 items-center justify-center rounded-md bg-[var(--app-bg)] text-[var(--app-hint)] hover:text-[var(--app-link)] sm:opacity-0 sm:group-hover/reasoning-row:opacity-100 sm:group-focus-within/reasoning-row:opacity-100 [@media(hover:none)]:opacity-100'
                : 'rounded-md px-3 py-1.5 text-xs text-[var(--app-link)] hover:bg-[var(--app-secondary-bg)]'}
            onClick={event => { event.stopPropagation(); setSnapshot([...props.sessions]) }}>
            {single ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M9 3a4 4 0 0 0-4 4 4 4 0 0 0-2 7 4 4 0 0 0 5 6 3 3 0 0 0 4-3V6a3 3 0 0 0-3-3Zm6 0a4 4 0 0 1 4 4 4 4 0 0 1 2 7 4 4 0 0 1-5 6 3 3 0 0 1-4-3V6a3 3 0 0 1 3-3Z"/><path d="M5 7c2 0 3 1 3 3m11-3c-2 0-3 1-3 3M3 14h4m14 0h-4"/></svg> : `Reasoning · all ${props.sessions.length}`}
        </button>
        {snapshot ? <ReasoningDialog api={props.api} sessions={snapshot} bulk={Boolean(props.bulk)} onClose={() => setSnapshot(null)} /> : null}
    </>
}

function ReasoningDialog({ api, sessions, bulk, onClose }: { api: ApiClient; sessions: SessionSummary[]; bulk: boolean; onClose: () => void }) {
    const queryClient = useQueryClient()
    const [targets, setTargets] = useState<ReasoningTarget[]>([])
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [value, setValue] = useState(DEFAULT)
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [revision, setRevision] = useState(0)
    const [results, setResults] = useState<ReasoningResult[] | null>(null)
    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setResults(null)
        void (async () => {
            const loaded: ReasoningTarget[] = []
            // Bounded read-only discovery; no model inference or resume.
            for (let start = 0; start < sessions.length; start += 4) {
                if (cancelled) return
                loaded.push(...await Promise.all(sessions.slice(start, start + 4).map(session => loadReasoningTarget(api, session))))
            }
            if (cancelled) return
            setTargets(loaded)
            setSelected(new Set(loaded.map(target => target.id)))
            setValue(!bulk ? loaded[0]?.current ?? DEFAULT : DEFAULT)
            setLoading(false)
        })()
        return () => { cancelled = true }
    }, [api, sessions, bulk, revision])
    const options = new Map(targets.flatMap(target => target.options.map(option => [option.value ?? DEFAULT, option.label] as const)))
    const chosen = value === DEFAULT ? null : value
    const eligible = targets.filter(target => selected.has(target.id) && !target.unavailable && target.options.some(option => option.value === chosen))
    const apply = async () => {
        setBusy(true)
        try {
            setResults(await applyReasoningTargets(api, targets.filter(target => selected.has(target.id)), chosen))
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            await Promise.all(targets.filter(target => selected.has(target.id)).map(target => queryClient.invalidateQueries({ queryKey: queryKeys.session(target.id) })))
        } finally { setBusy(false) }
    }
    return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto" onPointerDownOutside={event => { if (busy) event.preventDefault() }}>
            <DialogHeader>
                <DialogTitle>{bulk ? 'Reasoning across sessions' : `Reasoning: ${getSessionTitle(sessions[0])}`}</DialogTitle>
                <DialogDescription>Applies to subsequent model requests. Offline and unsupported sessions stay unchanged. Levels with the same name may behave differently across providers.</DialogDescription>
            </DialogHeader>
            {loading ? <p role="status" className="py-4 text-sm">Checking available reasoning levels…</p> : <>
                {!results ? <>
                    <label className="mt-4 block text-sm">Reasoning level
                        <select aria-label="Reasoning level" value={options.has(value) ? value : ''} disabled={busy || !options.size} onChange={event => setValue(event.target.value)} className="mt-1 w-full rounded border border-[var(--app-divider)] bg-[var(--app-bg)] p-2">
                            {!options.has(value) ? <option value="" disabled>Choose a supported level</option> : null}
                            {[...options].sort(([a], [b]) => {
                                const ai = effortOrder.indexOf(a), bi = effortOrder.indexOf(b)
                                return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b)
                            }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                        </select>
                    </label>
                    <p className="my-2 text-xs text-[var(--app-hint)]">{eligible.length} can accept {reasoningLabel(chosen)}. {targets.filter(target => selected.has(target.id)).length - eligible.length} will be skipped.</p>
                    {bulk ? <button type="button" disabled={busy} className="mb-2 text-xs text-[var(--app-link)]" onClick={() => setSelected(selected.size ? new Set() : new Set(targets.map(target => target.id)))}>{selected.size ? 'Deselect all' : 'Select all'}</button> : null}
                </> : <p role="status" className="my-3 text-sm">{results.filter(result => result.status === 'applied').length} applied · {results.filter(result => result.status === 'unchanged').length} already selected · {results.filter(result => result.status === 'skipped').length} skipped · {results.filter(result => result.status === 'failed').length} not confirmed</p>}
                <ul className="max-h-[38dvh] space-y-2 overflow-y-auto py-2">
                    {targets.map(target => {
                        const outcome = results?.find(result => result.id === target.id)
                        return <li key={target.id} className="rounded border border-[var(--app-divider)] p-2 text-sm">
                            <label className="flex items-center gap-2">
                                {bulk && !results ? <input type="checkbox" aria-label={`Include ${target.title}`} checked={selected.has(target.id)} disabled={busy} onChange={event => setSelected(previous => {
                                    const next = new Set(previous)
                                    if (event.target.checked) next.add(target.id); else next.delete(target.id)
                                    return next
                                })} /> : null}
                                <span className="min-w-0 break-words font-medium">{target.title}</span>
                            </label>
                            <p className="text-xs text-[var(--app-hint)] break-words">{target.flavor} · {target.model ?? 'Default model'} · {reasoningLabel(target.current)}</p>
                            <p className="mt-1 text-xs break-words">{outcome ? `${outcome.status}: ${outcome.detail}` : results ? 'Not selected; unchanged.' : target.unavailable ?? (target.options.some(option => option.value === chosen) ? `${reasoningLabel(chosen)} supported` : `${reasoningLabel(chosen)} unsupported; will skip`)}</p>
                        </li>
                    })}
                </ul>
                <div className="mt-3 flex justify-end gap-2">
                    <button type="button" disabled={busy} className="rounded border border-[var(--app-divider)] px-3 py-2 text-sm" onClick={() => setRevision(revision + 1)}>Refresh</button>
                    {!results ? <button type="button" disabled={busy || !eligible.length || !options.has(value)} onClick={() => void apply()} className="rounded bg-[var(--app-link)] px-3 py-2 text-sm text-white disabled:opacity-40">{busy ? 'Applying…' : `Apply to ${eligible.length} session${eligible.length === 1 ? '' : 's'}`}</button> : null}
                </div>
            </>}
        </DialogContent>
    </Dialog>
}
